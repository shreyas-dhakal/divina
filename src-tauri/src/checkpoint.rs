#![allow(unused_variables)] // stub: remove once implemented

use crate::protocol::Checkpoint;

#[tauri::command]
pub fn create_checkpoint(root: String, label: String) -> Result<Checkpoint, String> {
    Err("unimplemented".into())
}

#[tauri::command]
pub fn list_checkpoints(root: String) -> Vec<Checkpoint> {
    Vec::new()
}

#[tauri::command]
pub fn restore_checkpoint(root: String, id: String) -> Result<(), String> {
    Err("unimplemented".into())
}

/// Unified diff of the working tree against checkpoint `id`.
#[tauri::command]
pub fn diff_since_checkpoint(root: String, id: String) -> Result<String, String> {
    Err("unimplemented".into())
}
