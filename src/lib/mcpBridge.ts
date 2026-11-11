import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api } from "@/lib/api";

export interface McpRequest {
  id: string;
  tool: "get_pending_edits" | "screenshot_frame" | "get_dom_snapshot" | "get_console_errors";
  arguments: Record<string, unknown>;
}

/** Install the host-side MCP relay; T3 supplies relayToOverlay to handle the request in the preview iframe. */
export async function installMcpBridge(
  relayToOverlay: (request: McpRequest) => Promise<unknown>,
): Promise<UnlistenFn> {
  return listen<McpRequest>("mcp://request", ({ payload }) => {
    void relayToOverlay(payload)
      .then((result) => api.mcpRespond(payload.id, result))
      .catch((error: unknown) => api.mcpRespond(payload.id, { error: String(error) }));
  });
}
