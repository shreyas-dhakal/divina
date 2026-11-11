#![allow(unused_variables)] // stub: remove once implemented

use crate::protocol::LibraryComponent;

#[tauri::command]
pub fn list_components(root: String) -> Vec<LibraryComponent> {
    Vec::new()
}

/// Run a one-line install command (e.g. `pnpm dlx shadcn@latest add button`) in the project.
#[tauri::command]
pub fn run_installer(root: String, command: String) -> Result<(), String> {
    Err("unimplemented".into())
}
