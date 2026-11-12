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
export type InsertAlignment = "start" | "center" | "end";
/** Cell of a 3×3 grid over a container's free space: x is left/centre/right, y is top/middle/bottom. */
export interface InsertPlace { x: InsertAlignment; y: InsertAlignment }

export interface InsertPayload {
  component: string;
  importFrom: string;
  anchor: SourceRef;
  position: Position;
  align?: InsertAlignment;
  /** Set for a drop on empty space; the agent places it there with layout, not absolute positioning. */
  place?: InsertPlace;
  /** Set when the component comes from the catalog; the agent installs the library if missing. */
  library?: LibraryRef;
}

/** Catalog library a dropped component belongs to. */
export interface LibraryRef {
  id: string;
  name: string;
  /** Install command shown to the agent, never run by Divina. */
  install: string;
  /** Example usage of the dropped component, e.g. `<Button>Click</Button>`. */
  usage: string;
}

/**
 * Page-side description of an element with no source tag (non-React, or tagging off).
 * Divina searches the source for `text` to suggest locations; the agent decides.
 */
export interface DomAnchor {
  /** CSS path from body, e.g. `main > section:nth-of-type(2) > h2`. */
  selector: string;
  tag: string;
  /** Nearest visible text, trimmed to 80 chars; "" when none. */
  text: string;
  /** `file:line:col` from framework dev metadata (Svelte `__svelte_meta`, Vue component `__file`). */
  meta?: string;
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
  /** `file` is "" when the element has no source tag; `dom` then describes it. */
  target: SourceRef;
  dom?: DomAnchor;
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
  classes?: string;
  children: DomNode[];
}

export type OverlayMode = "select" | "insert" | "off";

export type OverlayToHost =
  | { type: "ready"; url: string }
  | { type: "hover"; ref: SourceRef | null; rect: Rect | null }
  | { type: "select"; ref: SourceRef; rect: Rect; computed: Record<string, string> }
  | { type: "edit"; record: EditRecord }
  /** The user deleted a dropped placeholder: drop its queued insert edit. */
  | { type: "discard-edit"; id: string }
  /** Canvas drag of a selected element; the host shows the trash zone unless idle. */
  | { type: "drag"; state: "idle" | "moving" | "over-trash" }
  /** Pinch or ⌘/Ctrl+scroll inside the page: zoom the canvas by `factor` around frame point x/y. */
  | { type: "zoom"; factor: number; x: number; y: number }
  /** A canvas shortcut key (CANVAS_KEYS) pressed or released while the page has focus; `meta` is ⌘ or Ctrl. */
  | { type: "canvas-key"; code: string; down: boolean; meta: boolean; shift: boolean }
  | { type: "dom-snapshot"; requestId: string; root: DomNode }
  | { type: "console-error"; message: string; stack?: string }
  | { type: "screenshot-request"; requestId: string }
  | { type: "screenshot-response"; requestId: string; dataUrl: string };

export type HostToOverlay =
  | { type: "set-mode"; mode: OverlayMode }
  /** x/y: drop point in frame (unscaled viewport) coordinates. */
  | { type: "preview-insert"; component: string; importFrom: string; x: number; y: number; library?: LibraryRef }
  /** Host drag in progress over the frame: show the drop indicator at x/y (frame coords). */
  | { type: "insert-hover"; x: number; y: number; component?: string }
  /** Optimistic preview of a Properties edit on the element at record.target; reverted by clear-optimistic. */
  | { type: "preview-edit"; record: EditRecord }
  | { type: "clear-optimistic" }
  /** The host's trash button in frame coords (outside the frame), for drag-to-delete hit-testing. */
  | { type: "trash-zone"; rect: Rect }
  | { type: "request-snapshot"; requestId: string }
  /** In-page fallback capture; answered with OverlayToHost screenshot-response. */
  | { type: "screenshot-request"; requestId: string };

export type AgentKind = "claude" | "codex" | "opencode";

/** A terminal tab: a login shell, or an agent CLI started with Divina's MCP server attached. */
export type TerminalKind = "shell" | AgentKind;

export interface TerminalInfo {
  id: string;
  kind: TerminalKind;
  title: string;
}

/** `terminal://data`: raw PTY output, base64-encoded bytes. */
export interface TerminalData {
  id: string;
  data: string;
}

/** `terminal://exit`. */
export interface TerminalExit {
  id: string;
  code: number | null;
}

/** A "Create new project" template. */
export interface ProjectTemplate {
  id: string;
  name: string;
  framework: string;
  description: string;
  /** False when a tool it needs isn't installed; `missing` says which and how to get it. */
  available: boolean;
  missing?: string;
}

export interface AgentInfo {
  kind: AgentKind;
  path: string;
  loggedIn: boolean;
  version: string;
}

/** What the project is built with, from package.json / Cargo.toml. */
export interface Stack {
  language: "javascript" | "rust" | "other";
  /** react, vue, svelte, leptos, yew, dioxus, or "unknown". */
  framework: string;
  /** Installed framework version, e.g. "19.1.0" or "0.7.2". */
  version?: string;
  /** Installed tailwindcss version, when present. */
  tailwind?: string;
}

export interface CatalogComponent {
  name: string;
  /** Example usage, e.g. `<Button>Click</Button>` or `view! { <Button>"Click"</Button> }`. */
  usage: string;
  /** App-relative URL of a pre-rendered image, e.g. `/catalog/shadcn/Button.webp`. */
  thumbnail?: string;
}

/** A component library Divina knows about (bundled catalog) or the user added. */
export interface CatalogLibrary {
  id: string;
  name: string;
  framework: string;
  /** Semver range of the framework this library supports, e.g. ">=0.7". */
  versions: string;
  install: string;
  /** Import path for the components, when the language has one. */
  importFrom?: string;
  docs?: string;
  custom: boolean;
  components: CatalogComponent[];
}

export interface LibraryComponent {
  name: string;
  importFrom: string;
  source: "shadcn" | "package" | "local";
  previewable: boolean;
}

export interface ProjectInfo {
  root: string;
  /** Descriptive only: React + Vite, React + Next.js, or anything else (Laravel, Rails, Django, PHP...). */
  framework: "vite" | "next" | "custom";
  packageManager: "pnpm" | "npm" | "yarn" | "bun";
  tailwind: boolean;
  react: boolean;
  /** Saved in .divina/run.json; null until the user writes how to run the project. */
  run: RunConfig | null;
  /** Placeholder hint only; never run unless the user types it. */
  suggestedRun: RunConfig;
}

/** How to serve a project, written by the user and run verbatim in their login shell. */
export interface RunConfig {
  command: string;
  /** Preview URL; when absent, the first local URL the command prints. */
  url?: string | null;
  /** Click-to-code source tagging via NODE_OPTIONS preloads (React + Vite/Next). */
  tagging: boolean;
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

/**
 * Dev-only JSX source tags the dev server injects on every element (Vite projects).
 * SRC_ATTR: "file:line:col" of the JSX that rendered the element, path relative to the
 * project root; a component forwarding props onto its root DOM node passes its usage
 * site through, so the usage site wins. OWNERS_ATTR: space-separated "file:line:col"
 * usage sites of the owning components, innermost first. Parse from the right (paths may hold ":").
 */
/** `KeyboardEvent.code`s the overlay forwards for canvas shortcuts (Space pans, zoom, V/H tools). */
export const CANVAS_KEYS = ["Space", "Equal", "Minus", "Digit0", "Digit1", "KeyV", "KeyH"];

export const SRC_ATTR = "data-divina-src";
export const OWNERS_ATTR = "data-divina-owners";
