#![allow(unused_variables)] // stub: remove once implemented

use crate::protocol::{AgentKind, McpServerInfo};

#[tauri::command]
pub fn start_mcp_server() -> Result<McpServerInfo, String> {
    Err("unimplemented".into())
}

/// Config the given agent CLI needs to reach our MCP server.
#[tauri::command]
pub fn mcp_config_for(agent: AgentKind) -> Result<String, String> {
    Err("unimplemented".into())
}
