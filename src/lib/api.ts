// Typed wrappers around the Tauri commands in src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentInfo,
  AgentKind,
  CatalogLibrary,
  Checkpoint,
  CheckpointDiff,
  DevServerLog,
  DevServerStatus,
  EditRecord,
  LibraryComponent,
  McpServerInfo,
  ProjectInfo,
  RunConfig,
  Stack,
  TerminalData,
  TerminalExit,
  TerminalInfo,
  TerminalKind,
} from "@/shared/protocol";

export const api = {
  openProject: (path: string) => invoke<ProjectInfo>("open_project", { path }),
  createProject: (parent: string, name: string) =>
    invoke<ProjectInfo>("create_project", { parent, name }),
  saveRunConfig: (root: string, run: RunConfig) => invoke<ProjectInfo>("save_run_config", { root, run }),

  startDevServer: (root: string) => invoke<DevServerStatus>("start_dev_server", { root }),
  stopDevServer: () => invoke<void>("stop_dev_server"),
  devServerStatus: () => invoke<DevServerStatus>("dev_server_status"),
  onDevServerLog: (cb: (log: DevServerLog) => void): Promise<UnlistenFn> =>
    listen<DevServerLog>("devserver://log", (e) => cb(e.payload)),

  proxyUrl: () => invoke<string>("proxy_url"),

  detectAgents: () => invoke<AgentInfo[]>("detect_agents"),
  /** The brief for the pending edits, for an interactive agent session; "" when there are none. */
  agentPrompt: (root: string, edits: EditRecord[]) => invoke<string>("agent_prompt", { root, edits }),

  terminalOpen: (root: string, kind: TerminalKind, cols: number, rows: number) =>
    invoke<TerminalInfo>("terminal_open", { root, kind, cols, rows }),
  /** UTF-8 written to the PTY as-is. */
  terminalWrite: (id: string, data: string) => invoke<void>("terminal_write", { id, data }),
  terminalResize: (id: string, cols: number, rows: number) => invoke<void>("terminal_resize", { id, cols, rows }),
  terminalClose: (id: string) => invoke<void>("terminal_close", { id }),
  terminalCloseAll: () => invoke<void>("terminal_close_all"),
  onTerminalData: (cb: (data: TerminalData) => void): Promise<UnlistenFn> =>
    listen<TerminalData>("terminal://data", (e) => cb(e.payload)),
  onTerminalExit: (cb: (exit: TerminalExit) => void): Promise<UnlistenFn> =>
    listen<TerminalExit>("terminal://exit", (e) => cb(e.payload)),

  startMcpServer: () => invoke<McpServerInfo>("start_mcp_server"),
  mcpConfigFor: (agent: AgentKind) => invoke<string>("mcp_config_for", { agent }),
  mcpRespond: (id: string, payload: unknown) => invoke<void>("mcp_respond", { id, payload }),

  listComponents: (root: string) => invoke<LibraryComponent[]>("list_components", { root }),
  runInstaller: (root: string, command: string) =>
    invoke<LibraryComponent[]>("run_installer", { root, command }),
  onInstallerLog: (cb: (log: DevServerLog) => void): Promise<UnlistenFn> =>
    listen<DevServerLog>("library://log", (e) => cb(e.payload)),
  detectStack: (root: string) => invoke<Stack>("detect_stack", { root }),
  listCatalog: (root: string) => invoke<CatalogLibrary[]>("list_catalog", { root }),
  /** `global` saves it for every project instead of this one; resolves with the updated catalog. */
  saveLibrary: (root: string, library: CatalogLibrary, global: boolean) =>
    invoke<CatalogLibrary[]>("save_library", { root, library, global }),

  createCheckpoint: (root: string, label: string) =>
    invoke<Checkpoint>("create_checkpoint", { root, label }),
  listCheckpoints: (root: string) => invoke<Checkpoint[]>("list_checkpoints", { root }),
  restoreCheckpoint: (root: string, id: string) =>
    invoke<void>("restore_checkpoint", { root, id }),
  diffSinceCheckpoint: (root: string, id: string) =>
    invoke<CheckpointDiff>("diff_since_checkpoint", { root, id }),
  initGit: (root: string) => invoke<void>("init_git", { root }),

  userName: () => invoke<string>("user_name"),

  /** Native PNG data URL of a host-window region (CSS px), resampled to outWidth. */
  snapshotFrame: (rect: { x: number; y: number; width: number; height: number }, outWidth: number) =>
    // Fields copied explicitly: DOMRect's are prototype getters, so spreading one yields {}.
    invoke<string>("snapshot_frame", { x: rect.x, y: rect.y, width: rect.width, height: rect.height, outWidth }),
};
