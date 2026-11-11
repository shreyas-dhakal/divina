mod agent;
mod checkpoint;
mod devserver;
mod library;
mod mcp;
mod project;
pub mod protocol;
mod proxy;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, event| {
            if let tauri::RunEvent::Exit = event {
                devserver::stop();
            }
        });
}
