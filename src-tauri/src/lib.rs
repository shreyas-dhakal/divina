mod agent;
mod catalog;
mod checkpoint;
mod devserver;
mod library;
mod mcp;
mod project;
pub mod protocol;
mod proxy;
mod snapshot;
mod terminal;

/// A Finder-launched app gets a bare PATH; adopt the login shell's so pnpm/node/agent CLIs resolve
/// for every child process (dev server, installer, agents, git).
fn use_login_shell_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let Ok(out) = std::process::Command::new(shell)
        .args(["-lc", "printf %s \"$PATH\""])
        .output()
    else {
        return;
    };
    let path = String::from_utf8_lossy(&out.stdout);
    if out.status.success() && !path.is_empty() {
        // SAFETY: called once at startup before any other thread exists.
        unsafe { std::env::set_var("PATH", path.as_ref()) };
    }
}

/// The macOS account's full name for the settings button, falling back to the login name.
#[tauri::command]
fn user_name() -> String {
    std::process::Command::new("id")
        .arg("-F")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("USER").ok())
        .unwrap_or_default()
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
            project::list_templates,
            project::save_run_config,
            devserver::start_dev_server,
            devserver::stop_dev_server,
            devserver::dev_server_status,
            proxy::proxy_url,
            agent::detect_agents,
            agent::agent_prompt,
            mcp::start_mcp_server,
            mcp::mcp_respond,
            mcp::mcp_config_for,
            library::list_components,
            library::run_installer,
            catalog::detect_stack,
            catalog::list_catalog,
            catalog::save_library,
            checkpoint::create_checkpoint,
            checkpoint::list_checkpoints,
            checkpoint::restore_checkpoint,
            checkpoint::diff_since_checkpoint,
            checkpoint::init_git,
            snapshot::snapshot_frame,
            terminal::terminal_open,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
            terminal::terminal_close_all,
            user_name,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                devserver::stop();
                terminal::terminal_close_all();
            }
        });
}
