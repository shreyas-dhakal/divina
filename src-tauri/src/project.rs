#![allow(unused_variables)] // stub: remove once implemented

use crate::protocol::ProjectInfo;

#[tauri::command]
pub fn open_project(path: String) -> Result<ProjectInfo, String> {
    Err("unimplemented".into())
}

/// Scaffold Vite + React + Tailwind + shadcn at `parent/name`.
#[tauri::command]
pub fn create_project(parent: String, name: String) -> Result<ProjectInfo, String> {
    Err("unimplemented".into())
}
