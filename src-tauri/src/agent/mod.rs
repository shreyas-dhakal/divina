#![allow(unused_variables, dead_code)] // stub: remove once implemented

use crate::protocol::{AgentInfo, AgentKind, EditRecord};

/// Emitted with an `AgentEvent` payload while an agent runs.
pub const EVENT: &str = "agent://event";

#[tauri::command]
pub fn detect_agents() -> Vec<AgentInfo> {
    Vec::new()
}

#[tauri::command]
pub fn run_agent(agent: AgentKind, prompt: String, edits: Vec<EditRecord>) -> Result<(), String> {
    Err("unimplemented".into())
}

#[tauri::command]
pub fn cancel_agent() -> Result<(), String> {
    Err("unimplemented".into())
}
