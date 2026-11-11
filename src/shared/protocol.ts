// Shared contracts between host UI, overlay and Rust backend.
// Mirrored exactly in src-tauri/src/protocol.rs (serde, camelCase). Change both together.

export interface ListRef {
  file: string;
  line: number;
  index: number;
}

/** Usage site of a rendered element, plus its owner-component chain. */
export interface SourceRef {
  file: string;
  line: number;
  col: number;
  component?: string;
  owners: SourceRef[];
  list?: ListRef;
}

export type ViewportPreset = "desktop" | "tablet" | "mobile" | "custom";

export interface Viewport {
  preset: ViewportPreset;
  width: number;
  height: number;
}

export type Scope = "all" | "tablet-down" | "mobile-down";

export type Position = "before" | "after" | "inside-start" | "inside-end";

export interface InsertPayload {
  component: string;
  importFrom: string;
  anchor: SourceRef;
  position: Position;
}

export interface MovePayload {
  anchor: SourceRef;
  position: Position;
}

export interface StylePayload {
  classes?: string;
  props?: Record<string, string>;
}

export interface TextPayload {
  text: string;
}

interface EditBase {
  id: string;
  target: SourceRef;
  viewport: Viewport;
  scope: Scope;
}

export type EditRecord = EditBase &
  (
    | { kind: "insert"; payload: InsertPayload }
    | { kind: "move"; payload: MovePayload }
    | { kind: "resize"; payload: StylePayload }
    | { kind: "style"; payload: StylePayload }
    | { kind: "text"; payload: TextPayload }
    | { kind: "delete"; payload?: null }
  );

export type EditKind = EditRecord["kind"];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Element in a DOM snapshot, annotated with its source location when known. */
export interface DomNode {
  tag: string;
  ref?: SourceRef;
  rect: Rect;
  text?: string;
  children: DomNode[];
}

export type OverlayMode = "select" | "insert" | "off";

export type OverlayToHost =
  | { type: "ready"; url: string }
  | { type: "hover"; ref: SourceRef | null; rect: Rect | null }
  | { type: "select"; ref: SourceRef; rect: Rect; computed: Record<string, string> }
  | { type: "edit"; record: EditRecord }
  | { type: "dom-snapshot"; requestId: string; root: DomNode }
  | { type: "console-error"; message: string; stack?: string }
  | { type: "screenshot-request"; requestId: string }
  | { type: "screenshot-response"; requestId: string; dataUrl: string };

export type HostToOverlay =
  | { type: "set-mode"; mode: OverlayMode }
  | { type: "preview-insert"; component: string; importFrom: string }
  | { type: "clear-optimistic" }
  | { type: "request-snapshot"; requestId: string };

export type AgentKind = "claude" | "codex" | "opencode";

export interface AgentInfo {
  kind: AgentKind;
  path: string;
  loggedIn: boolean;
}

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "done"; ok: boolean }
  | { type: "error"; message: string };

export interface LibraryComponent {
  name: string;
  importFrom: string;
  source: "shadcn" | "package" | "local";
  previewable: boolean;
}

export interface ProjectInfo {
  root: string;
  framework: "vite" | "next";
  packageManager: "pnpm" | "npm" | "yarn" | "bun";
}

export type DevServerStatus =
  | { state: "stopped" }
  | { state: "starting" }
  | { state: "running"; url: string }
  | { state: "crashed"; code?: number };

export interface DevServerLog {
  stream: "stdout" | "stderr";
  line: string;
}

export interface Checkpoint {
  id: string;
  createdAt: number;
  label: string;
}

export interface CheckpointDiff {
  files: string[];
  diff: string;
}

export interface McpServerInfo {
  url: string;
}
