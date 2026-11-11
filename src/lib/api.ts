// Typed wrappers around the Tauri commands in src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  AgentEvent,
  AgentInfo,
  AgentKind,
  Checkpoint,
  DevServerLog,
  DevServerStatus,
  EditRecord,
  LibraryComponent,
  McpServerInfo,
  ProjectInfo,
} from "@/shared/protocol";

export const api = {
  openProject: (path: string) => invoke<ProjectInfo>("open_project", { path }),
  createProject: (parent: string, name: string) =>
    invoke<ProjectInfo>("create_project", { parent, name }),

  startDevServer: (root: string) => invoke<DevServerStatus>("start_dev_server", { root }),
  stopDevServer: () => invoke<void>("stop_dev_server"),
  devServerStatus: () => invoke<DevServerStatus>("dev_server_status"),
  onDevServerLog: (cb: (log: DevServerLog) => void): Promise<UnlistenFn> =>
    listen<DevServerLog>("devserver://log", (e) => cb(e.payload)),

  proxyUrl: () => invoke<string>("proxy_url"),

  detectAgents: () => invoke<AgentInfo[]>("detect_agents"),
  runAgent: (agent: AgentKind, prompt: string, edits: EditRecord[]) =>
    invoke<void>("run_agent", { agent, prompt, edits }),
  cancelAgent: () => invoke<void>("cancel_agent"),
  onAgentEvent: (cb: (event: AgentEvent) => void): Promise<UnlistenFn> =>
    listen<AgentEvent>("agent://event", (e) => cb(e.payload)),

  startMcpServer: () => invoke<McpServerInfo>("start_mcp_server"),
  mcpConfigFor: (agent: AgentKind) => invoke<string>("mcp_config_for", { agent }),

  listComponents: (root: string) => invoke<LibraryComponent[]>("list_components", { root }),
  runInstaller: (root: string, command: string) =>
    invoke<void>("run_installer", { root, command }),
  onInstallerLog: (cb: (log: DevServerLog) => void): Promise<UnlistenFn> =>
    listen<DevServerLog>("installer://log", (e) => cb(e.payload)),

  createCheckpoint: (root: string, label: string) =>
    invoke<Checkpoint>("create_checkpoint", { root, label }),
  listCheckpoints: (root: string) => invoke<Checkpoint[]>("list_checkpoints", { root }),
  restoreCheckpoint: (root: string, id: string) =>
    invoke<void>("restore_checkpoint", { root, id }),
  diffSinceCheckpoint: (root: string, id: string) =>
    invoke<string>("diff_since_checkpoint", { root, id }),
};
