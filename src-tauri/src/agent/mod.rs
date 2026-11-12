mod locate;

use crate::protocol::{AgentInfo, AgentKind, EditKind, EditRecord};
use std::{
    path::{Path, PathBuf},
    process::Command,
};

#[tauri::command]
pub async fn detect_agents() -> Vec<AgentInfo> {
    tauri::async_runtime::spawn_blocking(detect).await.unwrap_or_default()
}

fn detect() -> Vec<AgentInfo> {
    [AgentKind::Claude, AgentKind::Codex, AgentKind::Opencode]
        .into_iter()
        .filter_map(|kind| {
            let binary = binary_name(kind);
            let path = find_binary(binary)?;
            let version = output(&path, version_args(kind)).ok()?;
            let logged_in = match kind {
                AgentKind::Claude => output(&path, &["auth", "status", "--json"])
                    .ok()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                    .and_then(|v| v.get("loggedIn")?.as_bool())
                    .unwrap_or(false),
                // codex prints its login status on stderr.
                AgentKind::Codex => Command::new(&path)
                    .args(["login", "status"])
                    .output()
                    .is_ok_and(|o| o.status.success() && [&o.stdout, &o.stderr].iter().any(|b| String::from_utf8_lossy(b).contains("Logged in"))),
                // Stored credentials don't prove the default model works (e.g. an expired key
                // answers 401), so probe with one tiny run.
                // ponytail: costs one short model call per detection; cache per launch if it gets slow.
                AgentKind::Opencode => output(&path, &["run", "--format", "json", "Reply with: ok"])
                    .map(|s| !s.lines().any(|l| l.contains(r#""type":"error""#)))
                    .unwrap_or(false),
            };
            Some(AgentInfo {
                kind,
                path: path.to_string_lossy().into(),
                logged_in,
                version: version.trim().to_owned(),
            })
        })
        .collect()
}

/// The brief an interactive agent session gets for the pending edits; empty when there are none.
#[tauri::command]
pub fn agent_prompt(root: String, edits: Vec<EditRecord>) -> String {
    build_prompt(Path::new(&root), &edits)
}

pub(crate) fn build_prompt(root: &Path, edits: &[EditRecord]) -> String {
    if edits.is_empty() {
        return String::new();
    }
    let json = serde_json::to_string_pretty(edits).unwrap_or_else(|_| "[]".into());
    let mut out = format!(
        "Divina pending edits: implement these changes in the code.\n\nEdits (JSON, with source locations, owner chains, viewport size, and scope):\n{json}\n\nUse the source usage sites and owner-component chain to locate the right code; preserve the existing project patterns and change only what is needed. Scope \"all\" applies at every size; \"tablet-down\" means below 1024px (Tailwind `max-lg:`) and \"mobile-down\" below 768px (`max-md:`), so use those max-width variants for scoped changes. Do not use absolute positioning or rewrite unrelated code. After editing, verify the result using the divina MCP screenshot_frame tool at the requested viewport before finishing, and correct any visual mismatch."
    );
    for edit in edits {
        if edit.target.file.is_empty() {
            if let Some(dom) = &edit.dom {
                out.push_str(&untagged_section(root, edit, dom));
            }
        }
        if let EditKind::Insert(p) = &edit.edit {
            if let Some(align) = p.align {
                let class = match align {
                    crate::protocol::InsertAlignment::Start => "self-start",
                    crate::protocol::InsertAlignment::Center => "self-center",
                    crate::protocol::InsertAlignment::End => "self-end",
                };
                let scoped = match edit.scope {
                    crate::protocol::Scope::All => class.to_owned(),
                    crate::protocol::Scope::TabletDown => format!("max-lg:{class}"),
                    crate::protocol::Scope::MobileDown => format!("max-md:{class}"),
                };
                out.push_str(&format!("\n\nEdit {}: align the inserted component with the Tailwind class `{scoped}`.", edit.id));
            }
            if let Some(place) = p.place {
                use crate::protocol::InsertAlignment::{Center, End, Start};
                let y = match place.y { Start => "top", Center => "middle", End => "bottom" };
                let x = match place.x { Start => "left", Center => "centre", End => "right" };
                let scope = match edit.scope {
                    crate::protocol::Scope::All => "",
                    crate::protocol::Scope::TabletDown => " Scope the classes with `max-lg:`.",
                    crate::protocol::Scope::MobileDown => " Scope the classes with `max-md:`.",
                };
                out.push_str(&format!(
                    "\n\nEdit {}: the user dropped <{}> on empty space, in the {y} {x} of its container (a 3×3 grid over the container's content box). Make it render there using layout: for example `self-*`, `justify-*`/`items-*`, `m*-auto`, or a flex/grid wrapper that fills the free space. Never use absolute or fixed positioning.{scope} The purple placeholder shows the spot.",
                    edit.id, p.component
                ));
            }
            if let Some(sibling) = &p.sibling {
                out.push_str(&format!(
                    "\n\nEdit {}: <{}> was dropped next to the component that edit {sibling} inserts, which is not in the code yet. Its anchor is that edit's; place it immediately {} that component.",
                    edit.id,
                    p.component,
                    if p.position == crate::protocol::Position::Before { "before" } else { "after" },
                ));
            }
            if let Some(lib) = &p.library {
                out.push_str(&format!(
                    "\n\nEdit {id}: <{c}> comes from the component library \"{name}\". If it is not already a dependency of this project, add it with: `{install}`. Usage: {usage}",
                    id = edit.id,
                    c = p.component,
                    name = lib.name,
                    install = lib.install,
                    usage = lib.usage,
                ));
            }
        }
    }
    for edit in edits {
        let (beside, position, free) = match &edit.edit {
            EditKind::Insert(p) => (p.beside, p.position, p.free),
            EditKind::Move(p) => (p.beside, p.position, p.free),
            _ => continue,
        };
        if let Some(f) = free {
            let snapped = f.snap_step.map(|step| format!(" The free offsets were grid-snapped to {step}px increments; they are on the Tailwind spacing scale (4px = 1 unit), so map them exactly to spacing classes.")).unwrap_or_default();
            let scope = match edit.scope {
                crate::protocol::Scope::All => "",
                crate::protocol::Scope::TabletDown => " Scope the classes with `max-lg:`.",
                crate::protocol::Scope::MobileDown => " Scope the classes with `max-md:`.",
            };
            out.push_str(&format!(
                "\n\nEdit {}: the user placed this freely. Its box ({}×{}px) sits {}px from the left and {}px from the top of the content box ({}×{}px) of the container it was dropped on, at a {}px wide viewport; its anchor and position only name the nearest sibling there. Make it render at that spot using layout only: its place among the siblings, margins, padding, `gap`, and flex or grid alignment (`justify-*`, `items-*`, `self-*`, `m*-auto`), with values on the Tailwind scale. Never use absolute or fixed positioning or transforms.{scope}{snapped} Then screenshot and compare with these numbers.",
                edit.id, f.width, f.height, f.x, f.y, f.container_width, f.container_height, edit.viewport.width, snapped = snapped
            ));
        }
        if beside == Some(true) {
            let side = if position == crate::protocol::Position::Before { "left" } else { "right" };
            out.push_str(&format!(
                "\n\nEdit {}: the user put this on the {side} side of its anchor, so the two sit side by side on one row. If the anchor's parent doesn't already lay them out in a row, wrap just those elements in a flex row (for example `flex flex-row items-center gap-2`), or join the row an earlier edit creates for the same anchor. Never use absolute or fixed positioning.",
                edit.id
            ));
        }
    }
    out.push_str("\n\nWhen you have implemented and verified the edits, call the divina MCP edits_applied tool with a one-line summary, so Divina shows the user the diff.");
    out
}

fn untagged_section(root: &Path, edit: &EditRecord, dom: &crate::protocol::DomAnchor) -> String {
    let found = locate::candidates(root, dom);
    let found = if found.is_empty() {
        "  (no text match)".to_owned()
    } else {
        found.iter().map(|c| format!("  - {c}")).collect::<Vec<_>>().join("\n")
    };
    let marker = match &edit.edit {
        EditKind::Insert(p) => format!(
            "The preview of <{}> in the frame (the rendered component, or a dashed purple box labelled with its name) marks the exact drop position.",
            p.component
        ),
        _ => "The element is the one matching the selector in the preview.".to_owned(),
    };
    format!(
        "\n\nEdit {id} targets an element with no source location. Find it in the source yourself.\nDOM selector: {sel}\nTag: {tag}\nText: {text:?}\nCandidate locations from a text search:\n{found}\n{marker} Call the divina MCP screenshot_frame tool first to see it, decide the right file and spot, implement, then screenshot again and confirm the result appears where expected; fix it if not.",
        id = edit.id,
        sel = dom.selector,
        tag = dom.tag,
        text = dom.text,
    )
}

fn output(path: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new(path)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into())
}
fn binary_name(kind: AgentKind) -> &'static str {
    match kind {
        AgentKind::Claude => "claude",
        AgentKind::Codex => "codex",
        AgentKind::Opencode => "opencode",
    }
}
fn version_args(kind: AgentKind) -> &'static [&'static str] {
    match kind {
        AgentKind::Claude | AgentKind::Opencode => &["--version"],
        AgentKind::Codex => &["--version"],
    }
}
fn find_binary(name: &str) -> Option<PathBuf> {
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        paths.extend([
            home.join(".local/bin"),
            home.join(".npm-global/bin"),
            home.join(".cargo/bin"),
        ]);
    }
    paths.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        PathBuf::from("/usr/bin"),
        PathBuf::from("/bin"),
    ]);
    paths
        .into_iter()
        .map(|p| p.join(name))
        .find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    fn records(v: serde_json::Value) -> Vec<EditRecord> {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn tagged_edits_get_no_untagged_section() {
        let src = json!({"file": "src/Hero.tsx", "line": 4, "col": 1, "owners": []});
        let edits = records(json!([{"id": "e1", "kind": "style", "target": src,
            "viewport": {"preset": "desktop", "width": 1280, "height": 800}, "scope": "all",
            "payload": {"classes": "p-4", "props": {}}}]));
        let p = agent_prompt("/nonexistent".into(), edits);
        assert!(p.starts_with("Divina pending edits: implement these changes in the code."));
        assert!(p.contains(r#""classes": "p-4""#));
        assert!(p.contains("max-lg:") && p.contains("absolute positioning") && p.contains("screenshot_frame"));
        assert!(!p.contains("no source location"));
        assert!(p.trim_end().ends_with("call the divina MCP edits_applied tool with a one-line summary, so Divina shows the user the diff."));
    }

    #[test]
    fn no_edits_give_an_empty_brief() {
        assert_eq!(agent_prompt("/nonexistent".into(), vec![]), "");
    }

    #[test]
    fn aligned_insert_gets_scoped_alignment_instruction() {
        let src = json!({"file": "src/App.tsx", "line": 1, "col": 1, "owners": []});
        let edits = records(json!([{"id": "align-1", "kind": "insert", "target": src,
            "viewport": {"preset": "mobile", "width": 390, "height": 844}, "scope": "mobile-down",
            "payload": {"component": "Button", "importFrom": "@/button", "anchor": src,
                "position": "after", "align": "center"}}]));
        assert!(build_prompt(Path::new("/nonexistent"), &edits).contains("align the inserted component with the Tailwind class `max-md:self-center`"));
    }

    #[test]
    fn free_placement_gives_the_agent_the_position() {
        let src = json!({"file": "src/App.tsx", "line": 4, "col": 2, "owners": []});
        let edits = records(json!([{"id": "f1", "kind": "insert", "target": src,
            "viewport": {"preset": "mobile", "width": 390, "height": 844}, "scope": "mobile-down",
            "payload": {"component": "Button", "importFrom": "@/button", "anchor": src, "position": "after",
                "free": {"x": 120, "y": 48, "width": 76, "height": 36, "containerWidth": 358, "containerHeight": 300, "snapStep": 4}}}]));
        let p = build_prompt(Path::new("/nonexistent"), &edits);
        assert!(p.contains("Edit f1: the user placed this freely. Its box (76×36px) sits 120px from the left and 48px from the top of the content box (358×300px)"), "{p}");
        assert!(p.contains("Scope the classes with `max-md:`."), "{p}");
        assert!(p.contains("grid-snapped to 4px increments; they are on the Tailwind spacing scale (4px = 1 unit)"), "{p}");
    }

    #[test]
    fn side_drops_ask_for_a_shared_row() {
        let src = json!({"file": "src/App.tsx", "line": 4, "col": 2, "owners": []});
        let vp = json!({"preset": "desktop", "width": 1440, "height": 900});
        let edits = records(json!([
            {"id": "b1", "kind": "insert", "target": src, "viewport": vp, "scope": "all",
                "payload": {"component": "Button", "importFrom": "@/button", "anchor": src, "position": "after", "beside": true}},
            {"id": "b2", "kind": "insert", "target": src, "viewport": vp, "scope": "all",
                "payload": {"component": "Badge", "importFrom": "@/badge", "anchor": src, "position": "before", "beside": true, "sibling": "b1"}},
            {"id": "b3", "kind": "move", "target": src, "viewport": vp, "scope": "all",
                "payload": {"anchor": src, "position": "before", "beside": true}},
        ]));
        let p = build_prompt(Path::new("/nonexistent"), &edits);
        assert!(p.contains("Edit b1: the user put this on the right side of its anchor"), "{p}");
        assert!(p.contains("Edit b2: <Badge> was dropped next to the component that edit b1 inserts"), "{p}");
        assert!(p.contains("Edit b3: the user put this on the left side of its anchor"), "{p}");
    }

    #[test]
    fn placed_insert_gets_layout_placement_instruction() {
        let src = json!({"file": "src/App.tsx", "line": 1, "col": 1, "owners": []});
        let edits = records(json!([{"id": "place-1", "kind": "insert", "target": src,
            "viewport": {"preset": "tablet", "width": 800, "height": 1000}, "scope": "tablet-down",
            "payload": {"component": "Progress", "importFrom": "@/progress", "anchor": src,
                "position": "inside-end", "place": {"x": "center", "y": "center"}}}]));
        let prompt = build_prompt(Path::new("/nonexistent"), &edits);
        assert!(prompt.contains("dropped <Progress> on empty space, in the middle centre of its container"));
        assert!(prompt.contains("Scope the classes with `max-lg:`."));
    }

    #[test]
    fn untagged_drop_gets_locations_and_library_instructions() {
        let dir = std::env::temp_dir().join(format!("divina-prompt-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Home.svelte"), "<h2>Our Services</h2>\n").unwrap();
        let none = json!({"file": "", "line": 0, "col": 0, "owners": []});
        let edits = records(json!([{"id": "e4", "kind": "insert", "target": none,
            "dom": {"selector": "main > h2", "tag": "h2", "text": "Our Services"},
            "viewport": {"preset": "desktop", "width": 1280, "height": 800}, "scope": "all",
            "payload": {"component": "Button", "importFrom": "thaw", "anchor": none, "position": "after",
                "library": {"id": "thaw", "name": "Thaw", "install": "cargo add thaw", "usage": "<Button/>"}}}]));
        let p = build_prompt(&dir, &edits);
        assert!(p.contains("DOM selector: main > h2"));
        assert!(p.contains("- Home.svelte:1: <h2>Our Services</h2>"));
        assert!(p.contains("The preview of <Button> in the frame"));
        assert!(p.contains("screenshot_frame tool first"));
        assert!(p.contains("library \"Thaw\""));
        assert!(p.contains("add it with: `cargo add thaw`"));
        fs::remove_dir_all(dir).unwrap();
    }
}
