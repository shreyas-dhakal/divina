use crate::protocol::{DevServerLog, DevServerStatus, Framework, LogStream, PackageManager};
use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::{mpsc, oneshot};

/// Emitted per output line with a `DevServerLog` payload.
pub const LOG_EVENT: &str = "devserver://log";

/// Wrapper Vite config written to `<root>/.divina/` and passed with `--config`, so the user's
/// own config is loaded unchanged. It swaps `react/jsx-dev-runtime` for a shim that tags every
/// element with SRC_ATTR / OWNERS_ATTR (see src/shared/protocol.ts). Dev-only by construction.
const VITE_WRAPPER: &str = r#"import { loadConfigFromFile, mergeConfig } from "vite";
const ROOT = process.cwd();
const ID = "\0divina-jsx-dev-runtime";
const runtime = `
import * as R from "react/jsx-dev-runtime";
import * as React from "react";
export const Fragment = R.Fragment;
const ROOT = ${JSON.stringify(ROOT + "/")};
const I = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE || React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
const owner = () => I?.A?.getOwner?.() ?? I?.ReactCurrentOwner?.current ?? null;
export function jsxDEV(type, props, key, isStatic, source, self) {
  if (source?.fileName && typeof type !== "symbol" && props && !("data-divina-src" in props)) {
    const file = source.fileName.startsWith(ROOT) ? source.fileName.slice(ROOT.length) : source.fileName;
    const src = file + ":" + source.lineNumber + ":" + source.columnNumber;
    const owners = [];
    for (let f = owner(); f; f = f._debugOwner) {
      const s = f.pendingProps?.["data-divina-src"];
      if (s && s !== src && owners[owners.length - 1] !== s) owners.push(s);
    }
    props = { ...props, "data-divina-src": src };
    if (owners.length) props["data-divina-owners"] = owners.join(" ");
  }
  return R.jsxDEV(type, props, key, isStatic, source, self);
}`;
export default async (env) => {
  const user = (await loadConfigFromFile(env, undefined, ROOT))?.config ?? {};
  return mergeConfig(user, {
    plugins: [{
      name: "divina-source-tags",
      enforce: "pre",
      resolveId: (id, importer) => (id === "react/jsx-dev-runtime" && importer !== ID ? ID : null),
      load: (id) => (id === ID ? runtime : null),
    }],
  });
};
"#;

/// Next.js tagging, also dev-only and outside the user's config: NEXT_PRELOAD is loaded with
/// `NODE_OPTIONS=--require` and wraps Next's in-memory config so the project's own .tsx/.jsx get a
/// `@jsxImportSource divina-jsx` pragma (NEXT_LOADER), resolved to NEXT_RUNTIME (Turbopack and webpack).
const NEXT_PRELOAD: &str = r#"// Divina dev-only hook (NODE_OPTIONS --require): adds source tagging to the loaded Next config in memory.
const Module = require("module");
const path = require("path");
const DIR = __dirname;
const load = Module._load;
let wrapped;
Module._load = function (request, parent, isMain) {
  const mod = load.apply(this, arguments);
  if (!/[\\/]next[\\/]dist[\\/]server[\\/]config(\.js)?$/.test(Module._resolveFilename(request, parent))) return mod;
  if (!wrapped) {
    const loadConfig = mod.default;
    wrapped = Object.create(mod, {
      default: {
        enumerable: true,
        value: async (...args) => {
          const config = await loadConfig(...args);
          const tp = (config.turbopack ??= {});
          tp.rules = { ...tp.rules };
          for (const glob of ["*.tsx", "*.jsx"]) {
            const prev = tp.rules[glob];
            const loaders = [...((prev && prev.loaders) || []), path.join(DIR, "pragma-loader.cjs")];
            tp.rules[glob] = { ...(prev || {}), loaders };
          }
          tp.resolveAlias = { ...tp.resolveAlias, "divina-jsx/jsx-dev-runtime": "./.divina/jsx-dev-runtime.mjs" };
          const webpack = config.webpack;
          config.webpack = (cfg, ctx) => {
            cfg = webpack ? webpack(cfg, ctx) : cfg;
            cfg.module.rules.push({ test: /\.[jt]sx$/, exclude: /node_modules/, use: path.join(DIR, "pragma-loader.cjs") });
            cfg.resolve.alias = { ...cfg.resolve.alias, "divina-jsx/jsx-dev-runtime": path.join(DIR, "jsx-dev-runtime.mjs") };
            return cfg;
          };
          return config;
        },
      },
    });
  }
  return wrapped;
};
"#;
const NEXT_LOADER: &str = r#"// Points the JSX of the project's own files at Divina's tagging runtime. Same line, so line numbers hold.
module.exports = function (source) {
  if (/[\\/]node_modules[\\/]|[\\/]\.divina[\\/]/.test(this.resourcePath)) return source;
  return "/** @jsxImportSource divina-jsx */" + source;
};
"#;
const NEXT_RUNTIME: &str = r#"import * as R from "react/jsx-dev-runtime";
export const Fragment = R.Fragment;
const ROOT = __ROOT__;
// ponytail: file:line:col only; owner chains are skipped on Next (RSC/SSR owners would break hydration).
export function jsxDEV(type, props, key, isStatic, source, self) {
  if (source?.fileName && typeof type !== "symbol" && props && !("data-divina-src" in props)) {
    let file = source.fileName.replace(/^\[project\]\//, "");
    if (file.startsWith(ROOT)) file = file.slice(ROOT.length);
    props = { ...props, "data-divina-src": file + ":" + source.lineNumber + ":" + source.columnNumber };
  }
  return R.jsxDEV(type, props, key, isStatic, source, self);
}
"#;

/// Process-group id of the running dev server, under the project root.
const PID_FILE: &str = ".divina/devserver.pid";

struct State {
    status: DevServerStatus,
    /// Bumped on every start/stop; a supervisor from an older generation must not touch state.
    generation: u64,
    pid: Option<u32>,
}

static STATE: Mutex<State> = Mutex::new(State { status: DevServerStatus::Stopped, generation: 0, pid: None });

#[tauri::command]
pub async fn start_dev_server(app: AppHandle, root: String) -> Result<DevServerStatus, String> {
    let info = crate::project::open_project(root)?; // also stops any running server
    let run = info.run.clone().unwrap_or_default();
    if info.framework == Framework::Custom || !run.command.trim().is_empty() {
        if run.command.trim().is_empty() {
            return Err("NEEDS_RUN_CONFIG".into());
        }
        // The user's own command, through the login shell so php/composer/python/rbenv resolve.
        // ponytail: no source tagging here; selection still works, edits fall back to DOM + screenshots.
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        let mut cmd = tokio::process::Command::new(shell);
        cmd.args(["-lc", &run.command]).current_dir(&info.root);
        return launch(app, cmd, &info.root, run.url.filter(|u| !u.trim().is_empty())).await;
    }
    let pkg: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(Path::new(&info.root).join("package.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let dev = pkg["scripts"]["dev"].as_str().ok_or("package.json has no \"dev\" script")?;

    let mut args: Vec<&str> = vec!["run", "dev"];
    if info.package_manager == PackageManager::Npm {
        args.push("--");
    }
    if info.framework == Framework::Vite {
        let dir = Path::new(&info.root).join(".divina");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(".gitignore"), "*\n").map_err(|e| e.to_string())?;
        std::fs::write(dir.join("vite.config.mjs"), VITE_WRAPPER).map_err(|e| e.to_string())?;
        // A custom `dev` script can't take --config, so run Vite itself; the wrapper still loads the user's config.
        // ponytail: drops whatever else that script did (env setup, parallel tasks).
        if !(dev == "vite" || dev.starts_with("vite ")) {
            args = match info.package_manager {
                PackageManager::Npm => vec!["exec", "--", "vite"],
                PackageManager::Bun => vec!["x", "vite"],
                _ => vec!["exec", "vite"],
            };
        }
        args.extend(["--config", ".divina/vite.config.mjs"]);
    }
    let mut node_options = std::env::var("NODE_OPTIONS").unwrap_or_default();
    if info.framework == Framework::Next {
        let dir = Path::new(&info.root).join(".divina");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let root_js = serde_json::to_string(&format!("{}/", info.root)).map_err(|e| e.to_string())?;
        for (name, body) in [
            (".gitignore", "*\n".to_string()),
            ("next-preload.cjs", NEXT_PRELOAD.to_string()),
            ("pragma-loader.cjs", NEXT_LOADER.to_string()),
            ("jsx-dev-runtime.mjs", NEXT_RUNTIME.replace("__ROOT__", &root_js)),
        ] {
            std::fs::write(dir.join(name), body).map_err(|e| e.to_string())?;
        }
        node_options = format!("{node_options} --require {}", serde_json::to_string(&dir.join("next-preload.cjs")).map_err(|e| e.to_string())?);
    }
    let pm = match info.package_manager {
        PackageManager::Pnpm => "pnpm",
        PackageManager::Npm => "npm",
        PackageManager::Yarn => "yarn",
        PackageManager::Bun => "bun",
    };
    let mut cmd = tokio::process::Command::new(pm);
    cmd.args(&args).current_dir(&info.root).env("NODE_OPTIONS", node_options.trim());
    launch(app, cmd, &info.root, None).await
}

/// Starts `cmd` as the project's dev server. The preview URL is `fixed_url` once it accepts
/// connections, or else the first local URL the command prints.
async fn launch(app: AppHandle, mut cmd: tokio::process::Command, root: &str, fixed_url: Option<String>) -> Result<DevServerStatus, String> {
    cmd.env("BROWSER", "none")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    cmd.process_group(0); // so stop() can kill the whole tree (pm -> node -> esbuild...)

    // A server left behind by a crashed/killed app (no exit hook) would hold the port, and
    // Next.js refuses a second dev server for the same dir.
    // ponytail: trusts the recorded pid; a reused pid's group could be hit, check the command line if that bites.
    let _ = std::fs::create_dir_all(Path::new(root).join(".divina"));
    if let Ok(pid) = std::fs::read_to_string(Path::new(root).join(PID_FILE)) {
        kill_tree(pid.trim().parse().ok());
    }
    let generation = {
        let mut s = STATE.lock().unwrap();
        s.generation += 1;
        s.status = DevServerStatus::Starting;
        s.generation
    };
    let (ready_tx, ready_rx) = oneshot::channel();
    tauri::async_runtime::spawn(supervise(app, cmd, generation, ready_tx, fixed_url));
    let _ = tokio::time::timeout(Duration::from_secs(60), ready_rx).await;
    Ok(dev_server_status())
}

/// Runs the dev server, restarting it once if it exits on its own.
async fn supervise(app: AppHandle, mut cmd: tokio::process::Command, generation: u64, ready: oneshot::Sender<()>, fixed_url: Option<String>) {
    let mut ready = Some(ready);
    for attempt in 0..2 {
        let log = |stream, line: String| {
            let _ = app.emit(LOG_EVENT, DevServerLog { stream, line });
        };
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                log(LogStream::Stderr, format!("could not start dev server: {e}"));
                break;
            }
        };
        {
            let mut s = STATE.lock().unwrap();
            if s.generation != generation {
                kill_tree(child.id());
                return;
            }
            s.pid = child.id();
        }
        if let (Some(dir), Some(pid)) = (cmd.as_std().get_current_dir(), child.id()) {
            let _ = std::fs::write(dir.join(PID_FILE), pid.to_string());
        }
        let (tx, mut rx) = mpsc::unbounded_channel();
        pipe(child.stdout.take(), LogStream::Stdout, tx.clone());
        pipe(child.stderr.take(), LogStream::Stderr, tx);
        let (url_tx, mut url_rx) = mpsc::unbounded_channel::<String>();
        if let Some(url) = fixed_url.clone() {
            tauri::async_runtime::spawn(async move {
                let Some(addr) = host_port(&url) else { return };
                for _ in 0..240 {
                    if tokio::net::TcpStream::connect(&addr).await.is_ok() {
                        let _ = url_tx.send(url);
                        return;
                    }
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
            });
        }
        let mut running = false;
        loop {
            let (line, url) = tokio::select! {
                Some(url) = url_rx.recv() => (None, Some(url)),
                next = rx.recv() => match next {
                    Some((stream, line)) => {
                        let url = if fixed_url.is_none() { parse_local_url(&line).or_else(|| parse_any_local_url(&line)) } else { None };
                        (Some((stream, line)), url)
                    }
                    None => break,
                },
            };
            if !running && let Some(url) = url {
                running = true;
                match crate::proxy::start(&url).await {
                    Ok(_) => {
                        let mut s = STATE.lock().unwrap();
                        if s.generation == generation {
                            s.status = DevServerStatus::Running { url };
                        }
                    }
                    Err(e) => log(LogStream::Stderr, format!("proxy failed: {e}")),
                }
                if let Some(r) = ready.take() {
                    let _ = r.send(());
                }
            }
            if let Some((stream, line)) = line {
                log(stream, line);
            }
        }
        let code = child.wait().await.ok().and_then(|s| s.code());
        let mut s = STATE.lock().unwrap();
        if s.generation != generation {
            return; // stopped on purpose
        }
        s.pid = None;
        s.status = DevServerStatus::Crashed { code };
        if attempt == 0 {
            s.status = DevServerStatus::Starting;
            drop(s);
            log(LogStream::Stderr, format!("dev server exited ({code:?}), restarting once"));
        }
    }
    crate::proxy::clear();
}

fn pipe(out: Option<impl AsyncRead + Unpin + Send + 'static>, stream: LogStream, tx: mpsc::UnboundedSender<(LogStream, String)>) {
    let Some(out) = out else { return };
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(out).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = tx.send((stream, line));
        }
    });
}

/// Stops the dev server (if any) and its whole process tree. Safe to call from the exit hook.
pub fn stop() {
    let mut s = STATE.lock().unwrap();
    s.generation += 1;
    s.status = DevServerStatus::Stopped;
    kill_tree(s.pid.take());
    crate::proxy::clear();
}

fn kill_tree(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    #[cfg(unix)]
    let _ = std::process::Command::new("kill").args(["-TERM", &format!("-{pid}")]).status();
    #[cfg(windows)]
    let _ = std::process::Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).status();
}

#[tauri::command]
pub fn stop_dev_server() -> Result<(), String> {
    stop();
    Ok(())
}

#[tauri::command]
pub fn dev_server_status() -> DevServerStatus {
    STATE.lock().unwrap().status.clone()
}

/// Local URL from a Vite (`➜  Local:   http://localhost:5173/`) or Next.js
/// (`- Local:        http://localhost:3000`, older `... url: http://localhost:3000`) line.
fn parse_local_url(line: &str) -> Option<String> {
    let line = strip_ansi(line);
    let rest = &line[line.find("Local:").or_else(|| line.find("url:"))?..];
    let start = rest.find("http://")?;
    let url = rest[start..].split_whitespace().next()?;
    Some(url.trim_end_matches(['/', ',']).to_string())
}

/// Any loopback URL in a line, for custom servers: `Server running on [http://127.0.0.1:8000]`,
/// `Starting development server at http://127.0.0.1:8000/`, `Listening on http://127.0.0.1:3000`.
fn parse_any_local_url(line: &str) -> Option<String> {
    let line = strip_ansi(line);
    let start = line.find("http://")?;
    let url = line[start..].split(|c: char| c.is_whitespace() || "[]()<>\"'".contains(c)).next()?;
    let url = url.trim_end_matches(['/', ',', '.']);
    let host = url["http://".len()..].split(['/', ':']).next()?;
    ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]
        .contains(&host)
        .then(|| url.replacen("0.0.0.0", "127.0.0.1", 1))
}

/// `host:port` of an http URL, for the readiness probe.
fn host_port(url: &str) -> Option<String> {
    let authority = url.strip_prefix("http://")?.split('/').next()?;
    Some(if authority.contains(':') { authority.to_string() } else { format!("{authority}:80") })
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // CSI: ESC [ params... final byte in @..~
            if chars.next() == Some('[') {
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::parse_local_url as p;

    #[test]
    fn parses_custom_server_urls() {
        use super::parse_any_local_url as a;
        assert_eq!(a("   INFO  Server running on [http://127.0.0.1:8000].").as_deref(), Some("http://127.0.0.1:8000"));
        assert_eq!(a("Starting development server at http://127.0.0.1:8000/").as_deref(), Some("http://127.0.0.1:8000"));
        assert_eq!(a("* Listening on http://0.0.0.0:3000").as_deref(), Some("http://127.0.0.1:3000"));
        assert_eq!(
            a("[Wed Nov 11 17:41:25 2026] PHP 8.5.9 Development Server (http://127.0.0.1:8765) started").as_deref(),
            Some("http://127.0.0.1:8765")
        );
        assert_eq!(a("see http://example.com/docs"), None);
        assert_eq!(super::host_port("http://127.0.0.1:8000/x").as_deref(), Some("127.0.0.1:8000"));
    }

    #[test]
    fn parses_dev_server_urls() {
        assert_eq!(p("  ➜  Local:   http://localhost:5173/").as_deref(), Some("http://localhost:5173"));
        assert_eq!(
            p("  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5174\x1b[22m/app/\x1b[39m").as_deref(),
            Some("http://localhost:5174/app")
        );
        assert_eq!(p("   - Local:        http://localhost:3000").as_deref(), Some("http://localhost:3000"));
        assert_eq!(
            p("ready - started server on 0.0.0.0:3000, url: http://localhost:3000").as_deref(),
            Some("http://localhost:3000")
        );
        assert_eq!(p("  ➜  Network: use --host to expose"), None);
        assert_eq!(p("   - Network:      http://192.168.1.4:3000"), None);
    }
}
