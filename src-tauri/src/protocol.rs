//! Shared contracts. Mirrors src/shared/protocol.ts exactly; change both together.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListRef {
    pub file: String,
    pub line: u32,
    pub index: u32,
}

/// Usage site of a rendered element, plus its owner-component chain.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRef {
    pub file: String,
    pub line: u32,
    pub col: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub component: Option<String>,
    #[serde(default)]
    pub owners: Vec<SourceRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub list: Option<ListRef>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ViewportPreset {
    Desktop,
    Tablet,
    Mobile,
    Custom,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub preset: ViewportPreset,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Scope {
    All,
    TabletDown,
    MobileDown,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Position {
    Before,
    After,
    InsideStart,
    InsideEnd,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InsertAlignment {
    Start,
    Center,
    End,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertPayload {
    pub component: String,
    pub import_from: String,
    pub anchor: SourceRef,
    pub position: Position,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<InsertAlignment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library: Option<LibraryRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRef {
    pub id: String,
    pub name: String,
    pub install: String,
    pub usage: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomAnchor {
    pub selector: String,
    pub tag: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovePayload {
    pub anchor: SourceRef,
    pub position: Position,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StylePayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub classes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub props: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextPayload {
    pub text: String,
}

/// `kind` + kind-specific `payload`, flattened into EditRecord.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "payload", rename_all = "lowercase")]
pub enum EditKind {
    Insert(InsertPayload),
    Move(MovePayload),
    Resize(StylePayload),
    Style(StylePayload),
    Text(TextPayload),
    Delete,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditRecord {
    pub id: String,
    /// `file` is empty when the element has no source tag; `dom` then describes it.
    pub target: SourceRef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dom: Option<DomAnchor>,
    pub viewport: Viewport,
    pub scope: Scope,
    #[serde(flatten)]
    pub edit: EditKind,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Element in a DOM snapshot, annotated with its source location when known.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DomNode {
    pub tag: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#ref: Option<SourceRef>,
    pub rect: Rect,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub classes: Option<String>,
    #[serde(default)]
    pub children: Vec<DomNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OverlayMode {
    Select,
    Insert,
    Off,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum OverlayToHost {
    Ready { url: String },
    Hover { r#ref: Option<SourceRef>, rect: Option<Rect> },
    Select { r#ref: SourceRef, rect: Rect, computed: BTreeMap<String, String> },
    Edit { record: EditRecord },
    DomSnapshot { request_id: String, root: DomNode },
    ConsoleError {
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        stack: Option<String>,
    },
    ScreenshotRequest { request_id: String },
    ScreenshotResponse { request_id: String, data_url: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum HostToOverlay {
    SetMode { mode: OverlayMode },
    PreviewInsert {
        component: String,
        import_from: String,
        x: f64,
        y: f64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        library: Option<LibraryRef>,
    },
    InsertHover { x: f64, y: f64 },
    PreviewEdit { record: EditRecord },
    ClearOptimistic,
    RequestSnapshot { request_id: String },
    ScreenshotRequest { request_id: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentKind {
    Claude,
    Codex,
    Opencode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TerminalKind {
    Shell,
    Claude,
    Codex,
    Opencode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfo {
    pub id: String,
    pub kind: TerminalKind,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalData {
    pub id: String,
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExit {
    pub id: String,
    pub code: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectTemplate {
    pub id: String,
    pub name: String,
    pub framework: String,
    pub description: String,
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missing: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub kind: AgentKind,
    pub path: String,
    pub logged_in: bool,
    #[serde(default)]
    pub version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ComponentSource {
    Shadcn,
    Package,
    Local,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryComponent {
    pub name: String,
    pub import_from: String,
    pub source: ComponentSource,
    pub previewable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Javascript,
    Rust,
    Other,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stack {
    pub language: Language,
    pub framework: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tailwind: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogComponent {
    pub name: String,
    pub usage: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogLibrary {
    pub id: String,
    pub name: String,
    pub framework: String,
    pub versions: String,
    pub install: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs: Option<String>,
    #[serde(default)]
    pub custom: bool,
    pub components: Vec<CatalogComponent>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Framework {
    Vite,
    Next,
    /// Anything else (Laravel, Rails, Django, PHP...).
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PackageManager {
    Pnpm,
    Npm,
    Yarn,
    Bun,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub root: String,
    pub framework: Framework,
    pub package_manager: PackageManager,
    pub tailwind: bool,
    /// Saved in `.divina/run.json`; None until the user confirms how to run the project.
    pub run: Option<RunConfig>,
    /// Placeholder hint for the setup dialog; never run unless the user types it.
    pub suggested_run: RunConfig,
    pub react: bool,
}

/// How to serve a project for the preview, written by the user. `command` runs verbatim in the
/// login shell.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunConfig {
    pub command: String,
    /// Preview URL; when absent, the first local URL the command prints is used.
    #[serde(default)]
    pub url: Option<String>,
    /// Add Divina's click-to-code source tagging via NODE_OPTIONS preloads (React + Vite/Next).
    #[serde(default)]
    pub tagging: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum DevServerStatus {
    Stopped,
    Starting,
    Running {
        url: String,
    },
    Crashed {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        code: Option<i32>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevServerLog {
    pub stream: LogStream,
    pub line: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Checkpoint {
    pub id: String,
    pub created_at: u64,
    pub label: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointDiff {
    pub files: Vec<String>,
    pub diff: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub url: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn roundtrip<T: Serialize + for<'de> Deserialize<'de>>(v: Value) {
        let parsed: T = serde_json::from_value(v.clone()).expect("deserialize");
        assert_eq!(serde_json::to_value(parsed).unwrap(), v);
    }

    #[test]
    fn wire_format_matches_ts() {
        let src = json!({"file": "src/Hero.tsx", "line": 42, "col": 5, "component": "Button",
            "owners": [{"file": "src/App.tsx", "line": 10, "col": 3, "owners": []}],
            "list": {"file": "src/Hero.tsx", "line": 40, "index": 2}});
        let vp = json!({"preset": "mobile", "width": 390, "height": 844});
        roundtrip::<EditRecord>(json!({"id": "e1", "kind": "insert", "target": src, "viewport": vp,
            "scope": "mobile-down", "payload": {"component": "Button", "importFrom": "@/components/ui/button",
            "anchor": src, "position": "inside-end"}}));
        roundtrip::<EditRecord>(json!({"id": "e5", "kind": "insert", "target": src, "viewport": vp,
            "scope": "all", "payload": {"component": "Button", "importFrom": "x", "anchor": src,
            "position": "after", "align": "center"}}));
        roundtrip::<EditRecord>(json!({"id": "e4", "kind": "insert",
            "target": {"file": "", "line": 0, "col": 0, "owners": []},
            "dom": {"selector": "main > h2", "tag": "h2", "text": "Our Services", "meta": "src/Home.svelte:4:1"},
            "viewport": vp, "scope": "all", "payload": {"component": "Button", "importFrom": "thaw",
            "anchor": {"file": "", "line": 0, "col": 0, "owners": []}, "position": "after",
            "library": {"id": "thaw", "name": "Thaw", "install": "cargo add thaw", "usage": "<Button>\"Hi\"</Button>"}}}));
        roundtrip::<Stack>(json!({"language": "rust", "framework": "leptos", "version": "0.7.2"}));
        roundtrip::<CatalogLibrary>(json!({"id": "thaw", "name": "Thaw", "framework": "leptos", "versions": ">=0.7",
            "install": "cargo add thaw", "custom": false,
            "components": [{"name": "Button", "usage": "<Button/>", "thumbnail": "/catalog/thaw/Button.webp"}]}));
        roundtrip::<EditRecord>(json!({"id": "e2", "kind": "style", "target": src, "viewport": vp,
            "scope": "tablet-down", "payload": {"classes": "p-4", "props": {"variant": "ghost"}}}));
        // delete carries no payload; TS allows it to be absent
        let del: EditRecord = serde_json::from_value(json!({"id": "e3", "kind": "delete", "target": src,
            "viewport": vp, "scope": "all"})).unwrap();
        assert_eq!(del.edit, EditKind::Delete);
        roundtrip::<OverlayToHost>(json!({"type": "screenshot-response", "requestId": "r1", "dataUrl": "data:"}));
        roundtrip::<OverlayToHost>(json!({"type": "hover", "ref": null, "rect": null}));
        roundtrip::<HostToOverlay>(json!({"type": "preview-insert", "component": "Card", "importFrom": "x", "x": 10.5, "y": 20.0}));
        roundtrip::<HostToOverlay>(json!({"type": "preview-insert", "component": "Button", "importFrom": "thaw", "x": 1.0, "y": 2.0,
            "library": {"id": "thaw", "name": "Thaw", "install": "cargo add thaw", "usage": "<Button/>"}}));
        roundtrip::<HostToOverlay>(json!({"type": "clear-optimistic"}));
        roundtrip::<TerminalInfo>(json!({"id": "t1", "kind": "claude", "title": "Claude Code"}));
        roundtrip::<TerminalExit>(json!({"id": "t1", "code": null}));
        roundtrip::<ProjectTemplate>(json!({"id": "leptos", "name": "Leptos", "framework": "leptos",
            "description": "Rust CSR with Thaw", "available": false, "missing": "trunk: cargo install trunk"}));
        roundtrip::<HostToOverlay>(json!({"type": "insert-hover", "x": 1.0, "y": 2.0}));
        roundtrip::<HostToOverlay>(json!({"type": "preview-edit", "record": {"id": "e4", "kind": "text", "target": src,
            "viewport": vp, "scope": "all", "payload": {"text": "Hi"}}}));
        roundtrip::<DevServerStatus>(json!({"state": "running", "url": "http://localhost:5173"}));
    }
}
