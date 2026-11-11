mod streams;

use crate::{
    mcp,
    protocol::{AgentEvent, AgentInfo, AgentKind, Checkpoint, EditRecord},
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
};
use tauri::Emitter;

pub const EVENT: &str = "agent://event";
static ACTIVE_PID: Mutex<Option<u32>> = Mutex::new(None);

#[derive(Default, Serialize, Deserialize)]
struct Session {
    #[serde(default)]
    claude: Option<String>,
    #[serde(default)]
    codex: Option<String>,
    #[serde(default)]
    opencode: Option<String>,
}

impl Session {
    fn get(&self, kind: AgentKind) -> Option<&str> {
        match kind {
            AgentKind::Claude => self.claude.as_deref(),
            AgentKind::Codex => self.codex.as_deref(),
            AgentKind::Opencode => self.opencode.as_deref(),
        }
    }
    fn set(&mut self, kind: AgentKind, id: String) {
        match kind {
            AgentKind::Claude => self.claude = Some(id),
            AgentKind::Codex => self.codex = Some(id),
            AgentKind::Opencode => self.opencode = Some(id),
        }
    }
}

#[tauri::command]
pub async fn detect_agents() -> Vec<AgentInfo> {
    tauri::async_runtime::spawn_blocking(detect).await.unwrap_or_default()
}

fn detect() -> Vec<AgentInfo> {
    [AgentKind::Claude, AgentKind::Codex, AgentKind::Opencode]
        .into_iter()
        .filter_map(|kind| {
            let binary = binary_name(kind);
            let path = find_binary(binary)?;
            let version = output(&path, version_args(kind)).ok()?;
            let logged_in = match kind {
                AgentKind::Claude => output(&path, &["auth", "status", "--json"])
                    .ok()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                    .and_then(|v| v.get("loggedIn")?.as_bool())
                    .unwrap_or(false),
                // codex prints its login status on stderr.
                AgentKind::Codex => Command::new(&path)
                    .args(["login", "status"])
                    .output()
                    .is_ok_and(|o| o.status.success() && [&o.stdout, &o.stderr].iter().any(|b| String::from_utf8_lossy(b).contains("Logged in"))),
                // Stored credentials don't prove the default model works (e.g. an expired key
                // answers 401), so probe with one tiny run.
                // ponytail: costs one short model call per detection; cache per launch if it gets slow.
                AgentKind::Opencode => output(&path, &["run", "--format", "json", "Reply with: ok"])
                    .map(|s| !s.lines().any(|l| l.contains(r#""type":"error""#)))
                    .unwrap_or(false),
            };
            Some(AgentInfo {
                kind,
                path: path.to_string_lossy().into(),
                logged_in,
                version: version.trim().to_owned(),
            })
        })
        .collect()
}

/// Checkpoints the project, starts the agent and returns the checkpoint at once; output streams
/// on EVENT and ends with exactly one `done`. Errors with NO_GIT_REPO when the project has no repo.
#[tauri::command]
pub async fn run_agent(
    app: tauri::AppHandle,
    agent: AgentKind,
    project_dir: String,
    prompt: String,
    edits: Vec<EditRecord>,
) -> Result<Checkpoint, String> {
    let root = PathBuf::from(&project_dir)
        .canonicalize()
        .map_err(|e| format!("Invalid project directory: {e}"))?;
    if !root.is_dir() {
        return Err("Project path is not a directory".into());
    }
    if ACTIVE_PID.lock().map_err(|e| e.to_string())?.is_some() {
        return Err("An agent run is already in progress".into());
    }
    let path = find_binary(binary_name(agent))
        .ok_or_else(|| format!("{} was not found on PATH", binary_name(agent)))?;
    let label = match prompt.trim() {
        "" => format!("Apply {} edit(s)", edits.len()),
        p => p.chars().take(80).collect(),
    };
    let checkpoint = crate::checkpoint::create_checkpoint(root.to_string_lossy().into(), label)?;
    mcp::start_mcp_server(app.clone())?;
    let config = mcp::mcp_config_for(agent)?;
    let session = read_session(&root);
    let full_prompt = build_prompt(&prompt, &edits);
    let mut cmd = Command::new(path);
    cmd.current_dir(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure(
        &mut cmd,
        agent,
        &root,
        &full_prompt,
        session.get(agent),
        &config,
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start agent: {e}"))?;
    *ACTIVE_PID.lock().map_err(|e| e.to_string())? = Some(child.id());
    std::thread::spawn(move || {
        let ok = pump(&app, agent, child, &root, session).unwrap_or_else(|e| {
            let _ = app.emit(EVENT, AgentEvent::Error { message: e });
            false
        });
        *ACTIVE_PID.lock().unwrap_or_else(|e| e.into_inner()) = None;
        let _ = app.emit(EVENT, AgentEvent::Done { ok });
    });
    Ok(checkpoint)
}

fn pump(
    app: &tauri::AppHandle,
    agent: AgentKind,
    mut child: std::process::Child,
    root: &Path,
    mut session: Session,
) -> Result<bool, String> {
    let output = child.stdout.take().ok_or("Agent stdout unavailable")?;
    let mut stderr = child.stderr.take().ok_or("Agent stderr unavailable")?;
    let stderr = std::thread::spawn(move || {
        use std::io::Read;
        let mut sink = String::new();
        let _ = stderr.read_to_string(&mut sink);
        sink
    });
    let mut session_id = None;
    for line in BufReader::new(output).lines() {
        let line = line.map_err(|e| format!("Failed reading agent output: {e}"))?;
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
            session_id = session_id.or_else(|| extract_session_id(agent, &v));
        }
        match streams::parse_event(agent, &line) {
            // run_agent emits the single authoritative `done` once the process exits.
            Some(AgentEvent::Done { .. }) | None => {}
            Some(event) => {
                let _ = app.emit(EVENT, event);
            }
        }
    }
    let status = child
        .wait()
        .map_err(|e| format!("Failed waiting for agent: {e}"))?;
    if let Some(id) = session_id {
        session.set(agent, id);
        write_session(root, &session)?;
    }
    if !status.success() {
        let err = stderr.join().unwrap_or_default();
        let tail: Vec<&str> = err.lines().rev().take(20).collect();
        let tail: Vec<&str> = tail.into_iter().rev().collect();
        return Err(format!("Agent exited with {status}\n{}", tail.join("\n")));
    }
    Ok(true)
}

#[tauri::command]
pub fn cancel_agent() -> Result<(), String> {
    let pid = *ACTIVE_PID.lock().map_err(|e| e.to_string())?;
    if let Some(pid) = pid {
        #[cfg(unix)]
        {
            let status = Command::new("kill")
                .args(["-TERM", "--", &format!("-{pid}")])
                .status()
                .map_err(|e| e.to_string())?;
            if !status.success() {
                return Err(format!("Unable to stop agent process group {pid}"));
            }
        }
        #[cfg(not(unix))]
        {
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .status();
        }
    }
    Ok(())
}

fn configure(
    cmd: &mut Command,
    kind: AgentKind,
    root: &Path,
    prompt: &str,
    session: Option<&str>,
    config: &str,
) -> Result<(), String> {
    match kind {
        AgentKind::Claude => {
            cmd.arg("-p")
                .arg(prompt)
                .args([
                    "--output-format",
                    "stream-json",
                    "--verbose",
                    "--restricted",
                    "--permission-mode",
                    "acceptEdits",
                    "--allowedTools",
                    "mcp__divina",
                    "--strict-mcp-config",
                    "--mcp-config",
                ])
                .arg(config);
            if let Some(id) = session {
                cmd.args(["--resume", id]);
            }
        }
        AgentKind::Codex => {
            cmd.arg("exec");
            if let Some(id) = session {
                cmd.args(["resume", "--json", "-c", "sandbox_mode=\"workspace-write\"", id, prompt]);
            } else {
                cmd.args(["--json", "--sandbox", "workspace-write", "--cd"])
                    .arg(root)
                    .arg(prompt);
            }
            // Codex reads MCP configuration from config.toml; pass the server setting returned by mcp_config_for.
            for setting in config.lines().filter(|s| s.contains('=')) {
                cmd.args(["-c", setting]);
            }
        }
        AgentKind::Opencode => {
            cmd.args(["run", "--format", "json", "--dir"])
                .arg(root)
                .arg(prompt);
            if let Some(id) = session {
                cmd.args(["--session", id]);
            }
            cmd.env("OPENCODE_CONFIG_CONTENT", config);
        }
    }
    Ok(())
}

fn build_prompt(prompt: &str, edits: &[EditRecord]) -> String {
    let edits = serde_json::to_string_pretty(edits).unwrap_or_else(|_| "[]".into());
    format!(
        "{prompt}\n\nDivina pending edits (JSON, with source locations, owner chains, viewport size, and scope):\n{edits}\n\nImplement only the requested changes. Use the source usage sites and owner-component chain to locate the right code; preserve the existing project patterns and change only what is needed. Scope \"all\" applies at every size; \"tablet-down\" means below 1024px (Tailwind `max-lg:`) and \"mobile-down\" below 768px (`max-md:`), so use those max-width variants for scoped changes. Do not use absolute positioning or rewrite unrelated code. After editing, verify the result using the divina MCP screenshot_frame tool at the requested viewport before finishing, and correct any visual mismatch."
    )
}

fn read_session(root: &Path) -> Session {
    fs::read(root.join(".divina/session.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}
fn write_session(root: &Path, session: &Session) -> Result<(), String> {
    let dir = root.join(".divina");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ignore = dir.join(".gitignore");
    if !ignore.exists() {
        fs::write(ignore, "/session.json\n").map_err(|e| e.to_string())?;
    }
    fs::write(
        dir.join("session.json"),
        serde_json::to_vec_pretty(session).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
fn extract_session_id(kind: AgentKind, v: &serde_json::Value) -> Option<String> {
    let path = match kind {
        AgentKind::Claude => "/session_id",
        AgentKind::Codex => "/thread_id",
        AgentKind::Opencode => "/sessionID",
    };
    v.pointer(path).and_then(|v| v.as_str()).map(str::to_owned)
}
fn output(path: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new(path)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into())
}
fn binary_name(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Claude => "claude",
        AgentKind::Codex => "codex",
        AgentKind::Opencode => "opencode",
    }
}
fn version_args(kind: AgentKind) -> &'static [&'static str] {
    match kind {
        AgentKind::Claude | AgentKind::Opencode => &["--version"],
        AgentKind::Codex => &["--version"],
    }
}
fn find_binary(name: &str) -> Option<PathBuf> {
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        paths.extend([
            home.join(".local/bin"),
            home.join(".npm-global/bin"),
            home.join(".cargo/bin"),
        ]);
    }
    paths.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ]);
    paths
        .into_iter()
        .map(|p| p.join(name))
        .find(|p| p.is_file())
}
