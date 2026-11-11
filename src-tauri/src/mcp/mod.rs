use crate::protocol::{AgentKind, McpServerInfo};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{Arc, Condvar, Mutex, OnceLock},
    thread,
    time::Duration,
};
use tauri::Emitter;

const EVENT: &str = "mcp://request";
const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Default)]
struct Shared {
    waiting: Mutex<HashMap<String, Option<Value>>>,
    ready: Condvar,
}
struct Server {
    url: String,
    token: String,
    shared: Arc<Shared>,
}
static SERVER: OnceLock<Server> = OnceLock::new();

#[tauri::command]
pub fn start_mcp_server(app: tauri::AppHandle) -> Result<McpServerInfo, String> {
    if let Some(server) = SERVER.get() {
        return Ok(McpServerInfo {
            url: server.url.clone(),
        });
    }
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let url = format!(
        "http://{}/mcp",
        listener.local_addr().map_err(|e| e.to_string())?
    );
    let token = random_token()?;
    let shared = Arc::new(Shared::default());
    let server = Server {
        url: url.clone(),
        token: token.clone(),
        shared: shared.clone(),
    };
    SERVER
        .set(server)
        .map_err(|_| "MCP server already started".to_string())?;
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let shared = shared.clone();
            let app = app.clone();
            let token = token.clone();
            thread::spawn(move || {
                let _ = serve(stream, &token, &shared, |id, tool, args| {
                    app.emit(EVENT, json!({"id": id, "tool": tool, "arguments": args}))
                        .map_err(|e| e.to_string())
                });
            });
        }
    });
    Ok(McpServerInfo { url })
}

#[tauri::command]
pub fn mcp_respond(id: String, payload: Value) -> Result<(), String> {
    let server = SERVER.get().ok_or("MCP server is not running")?;
    let mut waiting = server.shared.waiting.lock().map_err(|e| e.to_string())?;
    if let Some(slot) = waiting.get_mut(&id) {
        *slot = Some(payload);
        server.shared.ready.notify_all();
    }
    Ok(())
}

#[tauri::command]
pub fn mcp_config_for(agent: AgentKind) -> Result<String, String> {
    let server = SERVER.get().ok_or("MCP server is not running")?;
    let auth = format!("Bearer {}", server.token);
    let value = match agent {
        AgentKind::Claude => {
            json!({"mcpServers":{"divina":{"type":"http","url":server.url,"headers":{"Authorization":auth}}}})
        }
        AgentKind::Codex => {
            return Ok(format!(
                // `codex exec` never prompts, so the preview tools must be pre-approved or every call fails.
                "mcp_servers.divina.url = {:?}\nmcp_servers.divina.http_headers.Authorization = {:?}\nmcp_servers.divina.default_tools_approval_mode = \"approve\"",
                server.url, auth
            ));
        }
        AgentKind::Opencode => {
            json!({"mcp":{"servers":{"divina":{"type":"remote","url":server.url,"oauth":false,"headers":{"Authorization":auth}}}}})
        }
    };
    serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
}

fn random_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .map_err(|e| format!("could not generate MCP token: {e}"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

fn serve(
    mut stream: TcpStream,
    token: &str,
    shared: &Arc<Shared>,
    request: impl Fn(String, String, Value) -> Result<(), String>,
) -> Result<(), String> {
    stream
        .set_read_timeout(Some(TIMEOUT))
        .map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    let mut buf = [0; 4096];
    loop {
        let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            return Ok(());
        }
        bytes.extend_from_slice(&buf[..n]);
        if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
            let header_end = end + 4;
            let headers = String::from_utf8_lossy(&bytes[..header_end]).into_owned();
            let len = headers
                .lines()
                .find_map(|l| {
                    l.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .and_then(|v| v.trim().parse::<usize>().ok())
                })
                .unwrap_or(0);
            while bytes.len() < header_end + len {
                let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
                if n == 0 {
                    break;
                }
                bytes.extend_from_slice(&buf[..n]);
            }
            if !headers
                .lines()
                .any(|line| line.eq_ignore_ascii_case(&format!("authorization: Bearer {token}")))
            {
                return respond(&mut stream, 401, json!({"error":"unauthorized"}));
            }
            if !headers.starts_with("POST ") {
                // No server-initiated SSE stream; streamable-HTTP clients accept 405 here.
                return respond(&mut stream, 405, json!({"error":"method not allowed"}));
            }
            let body: Value =
                serde_json::from_slice(&bytes[header_end..(header_end + len).min(bytes.len())])
                    .map_err(|e| e.to_string())?;
            if body.get("id").is_none() {
                return respond(&mut stream, 202, json!({})); // notification: accepted, no reply
            }
            let result = rpc(body, shared, request);
            return respond(&mut stream, 200, result);
        }
    }
}

fn respond(stream: &mut TcpStream, status: u16, body: Value) -> Result<(), String> {
    let body = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
    let label = match status {
        200 => "OK",
        202 => "Accepted",
        401 => "Unauthorized",
        _ => "Method Not Allowed",
    };
    write!(stream, "HTTP/1.1 {status} {label}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).and_then(|_| stream.write_all(&body)).map_err(|e| e.to_string())
}

fn rpc(
    message: Value,
    shared: &Arc<Shared>,
    request: impl Fn(String, String, Value) -> Result<(), String>,
) -> Value {
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    let result = match method {
        "initialize" => {
            json!({"protocolVersion":"2025-03-26","capabilities":{"tools":{}},"serverInfo":{"name":"divina","version":"0.1.0"}})
        }
        "notifications/initialized" => return json!({}),
        "ping" => json!({}),
        "tools/list" => json!({"tools":[
            {"name":"get_pending_edits","description":"Get queued preview edits awaiting Apply.","inputSchema":{"type":"object","properties":{}}},
            {"name":"screenshot_frame","description":"Capture the preview at its current viewport as PNG.","inputSchema":{"type":"object","properties":{}}},
            {"name":"get_dom_snapshot","description":"Get the preview DOM tree with source references.","inputSchema":{"type":"object","properties":{}}},
            {"name":"get_console_errors","description":"Get console errors from the preview.","inputSchema":{"type":"object","properties":{}}}
        ]}),
        "tools/call" => {
            let params = &message["params"];
            let name = params["name"].as_str().unwrap_or("");
            if ![
                "get_pending_edits",
                "screenshot_frame",
                "get_dom_snapshot",
                "get_console_errors",
            ]
            .contains(&name)
            {
                return error(id, -32602, "unknown tool");
            }
            let request_id = format!(
                "mcp-{}",
                NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            );
            if let Ok(mut waiting) = shared.waiting.lock() {
                waiting.insert(request_id.clone(), None);
            }
            if let Err(e) = request(
                request_id.clone(),
                name.into(),
                params.get("arguments").cloned().unwrap_or(json!({})),
            ) {
                if let Ok(mut waiting) = shared.waiting.lock() {
                    waiting.remove(&request_id);
                }
                return error(id, -32603, &e);
            }
            let deadline = std::time::Instant::now() + TIMEOUT;
            let mut waiting = match shared.waiting.lock() {
                Ok(g) => g,
                Err(e) => return error(id, -32603, &e.to_string()),
            };
            while waiting.get(&request_id).is_some_and(Option::is_none) {
                let now = std::time::Instant::now();
                if now >= deadline {
                    waiting.remove(&request_id);
                    return error(
                        id,
                        -32000,
                        "Timed out waiting 10 seconds for the preview UI to answer MCP request.",
                    );
                }
                let (next, _) = match shared.ready.wait_timeout(waiting, deadline - now) {
                    Ok(v) => v,
                    Err(e) => return error(id, -32603, &e.to_string()),
                };
                waiting = next;
            }
            let payload = waiting.remove(&request_id).flatten().unwrap_or(Value::Null);
            if name == "screenshot_frame" {
                let data_url = payload
                    .get("dataUrl")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let data = data_url
                    .strip_prefix("data:image/png;base64,")
                    .unwrap_or(data_url);
                json!({"content":[{"type":"image","data":data,"mimeType":"image/png"}],"isError":false})
            } else {
                json!({"content":[{"type":"text","text":payload.to_string()}],"structuredContent":payload,"isError":false})
            }
        }
        _ => return error(id, -32601, "method not found"),
    };
    json!({"jsonrpc":"2.0","id":id,"result":result})
}
static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
fn error(id: Value, code: i32, message: &str) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    #[test]
    fn serves_tools_and_pending_edits_over_http() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let shared = Arc::new(Shared::default());
        let worker_shared = shared.clone();
        thread::spawn(move || {
            for _ in 0..2 {
                let (stream, _) = listener.accept().unwrap();
                let response_shared = worker_shared.clone();
                serve(stream, "secret", &worker_shared, move |id, tool, _| {
                    assert_eq!(tool, "get_pending_edits");
                    let mut waiting = response_shared.waiting.lock().unwrap();
                    waiting.insert(id, Some(json!([])));
                    response_shared.ready.notify_all();
                    Ok(())
                })
                .unwrap();
            }
        });
        let call = |body: Value| {
            let mut s = TcpStream::connect(addr).unwrap();
            let body = body.to_string();
            write!(s,"POST /mcp HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer secret\r\nContent-Length: {}\r\n\r\n{}",body.len(),body).unwrap();
            let mut out = String::new();
            s.read_to_string(&mut out).unwrap();
            out.split_once("\r\n\r\n").unwrap().1.to_string()
        };
        let listed: Value =
            serde_json::from_str(&call(json!({"jsonrpc":"2.0","id":1,"method":"tools/list"})))
                .unwrap();
        assert_eq!(listed["result"]["tools"].as_array().unwrap().len(), 4);
        let called: Value = serde_json::from_str(&call(json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_pending_edits","arguments":{}}}))).unwrap();
        assert_eq!(called["result"]["structuredContent"], json!([]));
    }
}
