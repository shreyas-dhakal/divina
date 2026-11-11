mod agent;
mod checkpoint;
mod devserver;
mod library;
mod mcp;
mod project;
pub mod protocol;
mod proxy;
mod snapshot;

/// A Finder-launched app gets a bare PATH; adopt the login shell's so pnpm/node/agent CLIs resolve
/// for every child process (dev server, installer, agents, git).
fn use_login_shell_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let Ok(out) = std::process::Command::new(shell).args(["-lc", "printf %s \"$PATH\""]).output() else { return };
    let path = String::from_utf8_lossy(&out.stdout);
    if out.status.success() && !path.is_empty() {
        // SAFETY: called once at startup before any other thread exists.
        unsafe { std::env::set_var("PATH", path.as_ref()) };
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(unix)]
    use_login_shell_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            project::open_project,
            project::create_project,
            devserver::start_dev_server,
            devserver::stop_dev_server,
            devserver::dev_server_status,
            proxy::proxy_url,
            agent::detect_agents,
            agent::run_agent,
            agent::cancel_agent,
            mcp::start_mcp_server,
            mcp::mcp_respond,
            mcp::mcp_config_for,
            library::list_components,
            library::run_installer,
            checkpoint::create_checkpoint,
            checkpoint::list_checkpoints,
            checkpoint::restore_checkpoint,
            checkpoint::diff_since_checkpoint,
            checkpoint::init_git,
            snapshot::snapshot_frame,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                devserver::stop();
            }
        });
}
