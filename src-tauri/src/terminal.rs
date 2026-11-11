use crate::protocol::{AgentKind, TerminalData, TerminalExit, TerminalInfo, TerminalKind};
use base64::{Engine, engine::general_purpose::STANDARD};
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::Path,
    sync::{Arc, Mutex, OnceLock},
    thread,
};
use tauri::Emitter;

const DATA_EVENT: &str = "terminal://data";
const EXIT_EVENT: &str = "terminal://exit";

struct LiveTerminal {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    process_group: Option<i32>,
}

static TERMINALS: OnceLock<Mutex<HashMap<String, Arc<LiveTerminal>>>> = OnceLock::new();
fn terminals() -> &'static Mutex<HashMap<String, Arc<LiveTerminal>>> {
    TERMINALS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub fn terminal_open(
    app: tauri::AppHandle,
    root: String,
    kind: TerminalKind,
    cols: u16,
    rows: u16,
) -> Result<TerminalInfo, String> {
    let root = Path::new(&root)
        .canonicalize()
        .map_err(|e| format!("Invalid project directory: {e}"))?;
    let (mut command, title) = command_for(&app, kind, &root)?;
    command.cwd(&root);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    let system = native_pty_system();
    let pair = system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let process_group = pair.master.process_group_leader();
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| e.to_string())?;
    let id = unique_id();
    let terminal = Arc::new(LiveTerminal {
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        child: Arc::new(Mutex::new(child)),
        process_group,
    });
    terminals()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), terminal.clone());
    // Keep the master alive until the reader and child have completed.
    let reader_id = id.clone();
    thread::spawn(move || read_output(reader, reader_id, terminal, app));
    Ok(TerminalInfo {
        id,
        kind,
        title: title.into(),
    })
}

#[tauri::command]
pub fn terminal_write(id: String, data: String) -> Result<(), String> {
    let terminal = get_terminal(&id)?;
    terminal
        .writer
        .lock()
        .map_err(|e| e.to_string())?
        .write_all(data.as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_resize(id: String, cols: u16, rows: u16) -> Result<(), String> {
    let terminal = get_terminal(&id)?;
    terminal
        .master
        .lock()
        .map_err(|e| e.to_string())?
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn terminal_close(id: String) -> Result<(), String> {
    let terminal = terminals()
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id)
        .ok_or("Terminal not found")?;
    kill_process_group(terminal.process_group);
    terminal
        .child
        .lock()
        .map_err(|e| e.to_string())?
        .kill()
        .map_err(|e| e.to_string())
}

/// Also called on app exit; the host calls it when a project closes.
#[tauri::command]
pub fn terminal_close_all() {
    let Ok(mut live) = terminals().lock() else {
        return;
    };
    for (_, terminal) in live.drain() {
        kill_process_group(terminal.process_group);
        if let Ok(mut child) = terminal.child.lock() {
            let _ = child.kill();
        }
    }
}

fn get_terminal(id: &str) -> Result<Arc<LiveTerminal>, String> {
    terminals()
        .lock()
        .map_err(|e| e.to_string())?
        .get(id)
        .cloned()
        .ok_or_else(|| "Terminal not found".into())
}

fn read_output(
    mut reader: Box<dyn Read + Send>,
    id: String,
    terminal: Arc<LiveTerminal>,
    app: tauri::AppHandle,
) {
    let mut buffer = [0u8; 8192];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                let _ = app.emit(
                    DATA_EVENT,
                    TerminalData {
                        id: id.clone(),
                        data: STANDARD.encode(&buffer[..n]),
                    },
                );
            }
        }
    }
    let status = terminal
        .child
        .lock()
        .ok()
        .and_then(|mut child| child.wait().ok());
    let code = status.map(|s| s.exit_code() as i32);
    if let Ok(mut live) = terminals().lock() {
        live.remove(&id);
    }
    let _ = app.emit(EXIT_EVENT, TerminalExit { id, code });
}

fn command_for(
    app: &tauri::AppHandle,
    kind: TerminalKind,
    root: &Path,
) -> Result<(CommandBuilder, &'static str), String> {
    let command = match kind {
        TerminalKind::Shell => {
            let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
            let mut c = CommandBuilder::new(shell);
            c.arg("-l");
            (c, "Shell")
        }
        TerminalKind::Claude => {
            ensure_mcp(app)?;
            let config = crate::mcp::mcp_config_for(AgentKind::Claude)?;
            let mut c = agent_command("claude", "npm i -g @anthropic-ai/claude-code")?;
            c.args(["--mcp-config", &config]);
            (c, "Claude Code")
        }
        TerminalKind::Codex => {
            ensure_mcp(app)?;
            let config = crate::mcp::mcp_config_for(AgentKind::Codex)?;
            let mut c = agent_command("codex", "npm i -g @openai/codex")?;
            c.args(["--cd", root.to_string_lossy().as_ref()]);
            for setting in config.lines().map(str::trim).filter(|s| !s.is_empty()) {
                c.args(["-c", setting]);
            }
            (c, "Codex")
        }
        TerminalKind::Opencode => {
            ensure_mcp(app)?;
            let config = crate::mcp::mcp_config_for(AgentKind::Opencode)?;
            let mut c = agent_command("opencode", "npm i -g opencode-ai")?;
            c.arg(root.to_string_lossy().as_ref());
            c.env("OPENCODE_CONFIG_CONTENT", config);
            (c, "opencode")
        }
    };
    Ok(command)
}

fn ensure_mcp(app: &tauri::AppHandle) -> Result<(), String> {
    crate::mcp::start_mcp_server(app.clone()).map(|_| ())?;
    Ok(())
}

fn agent_command(binary: &str, install: &str) -> Result<CommandBuilder, String> {
    let path = find_binary(binary)
        .ok_or_else(|| format!("{binary} is not installed. Install it with: {install}"))?;
    Ok(CommandBuilder::new(path))
}

fn find_binary(name: &str) -> Option<std::path::PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|p| p.join(name))
        .find(|p| p.is_file())
}

fn unique_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);
    format!(
        "t{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

#[cfg(unix)]
fn kill_process_group(group: Option<i32>) {
    if let Some(group) = group {
        unsafe {
            libc::kill(-group, libc::SIGKILL);
        }
    }
}
#[cfg(not(unix))]
fn kill_process_group(_: Option<i32>) {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn test_pty(
        command: CommandBuilder,
        on_output: impl Fn(Vec<u8>) + Send + 'static,
    ) -> (
        Box<dyn Child + Send + Sync>,
        Box<dyn MasterPty + Send>,
        Box<dyn Write + Send>,
    ) {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut reader = pair.master.try_clone_reader().unwrap();
        let writer = pair.master.take_writer().unwrap();
        let child = pair.slave.spawn_command(command).unwrap();
        thread::spawn(move || {
            let mut buf = [0; 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => on_output(buf[..n].to_vec()),
                }
            }
        });
        (child, pair.master, writer)
    }

    #[test]
    fn reads_output_and_exit_status() {
        let (tx, rx) = mpsc::channel();
        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.args(["-c", "printf hi"]);
        let (mut child, _master, _writer) = test_pty(cmd, move |bytes| {
            let _ = tx.send(bytes);
        });
        let mut output = Vec::new();
        while let Ok(bytes) = rx.recv_timeout(std::time::Duration::from_secs(2)) {
            output.extend(bytes);
            if output.windows(2).any(|w| w == b"hi") {
                break;
            }
        }
        let status = child.wait().unwrap();
        assert!(String::from_utf8_lossy(&output).contains("hi"));
        assert_eq!(status.exit_code(), 0);
    }

    #[test]
    fn writes_to_cat_and_resizes() {
        let (tx, rx) = mpsc::channel();
        let (mut child, master, mut writer) =
            test_pty(CommandBuilder::new("/bin/cat"), move |bytes| {
                let _ = tx.send(bytes);
            });
        master
            .resize(PtySize {
                rows: 30,
                cols: 100,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        writer.write_all(b"hello\n").unwrap();
        let bytes = rx.recv_timeout(std::time::Duration::from_secs(2)).unwrap();
        assert!(String::from_utf8_lossy(&bytes).contains("hello"));
        let _ = child.kill();
    }
}
