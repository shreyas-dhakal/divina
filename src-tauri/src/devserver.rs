#![allow(unused_variables, dead_code)] // stub: remove once implemented

use crate::protocol::DevServerStatus;

/// Emitted per output line with a `DevServerLog` payload.
pub const LOG_EVENT: &str = "devserver://log";

#[tauri::command]
pub fn start_dev_server(root: String) -> Result<DevServerStatus, String> {
    Err("unimplemented".into())
}

#[tauri::command]
pub fn stop_dev_server() -> Result<(), String> {
    Err("unimplemented".into())
}

#[tauri::command]
pub fn dev_server_status() -> DevServerStatus {
    DevServerStatus::Stopped
}
