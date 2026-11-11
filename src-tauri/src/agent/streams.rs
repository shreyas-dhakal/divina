#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::AgentEvent;
    use serde_json::json;

    #[test]
    fn parses_claude_assistant_text_and_result() {
        assert_eq!(
            parse_event(
                AgentKind::Claude,
                r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Working"}]}}"#
            ),
            Some(AgentEvent::Text {
                text: "Working".into()
            })
        );
        assert_eq!(
            parse_event(
                AgentKind::Claude,
                r#"{"type":"result","subtype":"success"}"#
            ),
            Some(AgentEvent::Done { ok: true })
        );
    }

    #[test]
    fn parses_codex_and_opencode_jsonl_events() {
        assert_eq!(
            parse_event(
                AgentKind::Codex,
                r#"{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}"#
            ),
            Some(AgentEvent::Text {
                text: "Done".into()
            })
        );
        assert_eq!(
            parse_event(
                AgentKind::Opencode,
                r#"{"type":"text","part":{"text":"Hello"}}"#
            ),
            Some(AgentEvent::Text {
                text: "Hello".into()
            })
        );
        assert_eq!(
            parse_event(
                AgentKind::Opencode,
                r#"{"type":"session.status","properties":{"status":"idle"}}"#
            ),
            Some(AgentEvent::Done { ok: true })
        );
    }

    #[test]
    fn preserves_tool_calls_and_reports_malformed_terminal_errors() {
        assert_eq!(
            parse_event(
                AgentKind::Claude,
                r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"src/a.tsx"}}]}}"#
            ),
            Some(AgentEvent::Tool {
                name: "Read".into(),
                input: json!({"file_path":"src/a.tsx"})
            })
        );
        assert!(parse_event(AgentKind::Codex, "not json").is_none());
    }

    #[test]
    fn parses_recorded_cli_output_shapes() {
        let codex = r#"{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"OK"}}"#;
        assert_eq!(
            parse_event(AgentKind::Codex, codex),
            Some(AgentEvent::Text { text: "OK".into() })
        );

        let opencode = r#"{"type":"error","error":{"name":"APIError","data":{"message":"Access denied","statusCode":401}}}"#;
        assert_eq!(
            parse_event(AgentKind::Opencode, opencode),
            Some(AgentEvent::Error {
                message: "Access denied".into()
            })
        );

        let claude = r#"{"type":"result","subtype":"success","is_error":false,"result":"OK"}"#;
        assert_eq!(
            parse_event(AgentKind::Claude, claude),
            Some(AgentEvent::Done { ok: true })
        );
    }
}
use crate::protocol::{AgentEvent, AgentKind};
use serde_json::Value;

pub(super) fn parse_event(kind: AgentKind, line: &str) -> Option<AgentEvent> {
    let value: Value = serde_json::from_str(line).ok()?;
    let ty = value.get("type")?.as_str()?;
    let text = |v: &Value| v.get("text").and_then(Value::as_str).map(str::to_owned);
    match kind {
        AgentKind::Claude => match ty {
            "assistant" => {
                let blocks = value.pointer("/message/content")?.as_array()?;
                for block in blocks {
                    match block.get("type")?.as_str()? {
                        "text" => {
                            if let Some(text) = text(block) {
                                return Some(AgentEvent::Text { text });
                            }
                        }
                        "tool_use" => {
                            return Some(AgentEvent::Tool {
                                name: block.get("name")?.as_str()?.into(),
                                input: block.get("input")?.clone(),
                            });
                        }
                        _ => {}
                    }
                }
                None
            }
            "result" => Some(AgentEvent::Done {
                ok: value.get("is_error").and_then(Value::as_bool) != Some(true),
            }),
            "system" => None,
            _ => None,
        },
        AgentKind::Codex => match ty {
            "thread.started" => None,
            "item.completed" => {
                let item = value.get("item")?;
                match item.get("type")?.as_str()? {
                    "agent_message" => Some(AgentEvent::Text { text: text(item)? }),
                    "command_execution" | "file_change" | "mcp_tool_call" => {
                        Some(AgentEvent::Tool {
                            name: item.get("type")?.as_str()?.into(),
                            input: item.clone(),
                        })
                    }
                    _ => None,
                }
            }
            "turn.completed" => Some(AgentEvent::Done { ok: true }),
            "turn.failed" | "error" => Some(AgentEvent::Error {
                message: value
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("Codex run failed")
                    .into(),
            }),
            _ => None,
        },
        AgentKind::Opencode => match ty {
            "text" => Some(AgentEvent::Text {
                text: text(value.get("part")?)?,
            }),
            "tool" => Some(AgentEvent::Tool {
                name: value
                    .pointer("/part/tool")
                    .and_then(Value::as_str)
                    .unwrap_or("tool")
                    .into(),
                input: value
                    .pointer("/part/state/input")
                    .cloned()
                    .unwrap_or(Value::Null),
            }),
            "session.status"
                if value.pointer("/properties/status").and_then(Value::as_str) == Some("idle") =>
            {
                Some(AgentEvent::Done { ok: true })
            }
            "session.error" | "error" => Some(AgentEvent::Error {
                message: value
                    .pointer("/properties/error/message")
                    .or_else(|| value.pointer("/error/data/message"))
                    .or_else(|| value.pointer("/error/message"))
                    .and_then(Value::as_str)
                    .unwrap_or("OpenCode run failed")
                    .into(),
            }),
            _ => None,
        },
    }
}
