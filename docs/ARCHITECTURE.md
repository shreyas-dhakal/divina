# Divina: architecture

How the product in `docs/PRODUCT.md` is built. Read that first. This file maps behaviour to code, so changes land in the right place.

## Stack

- **Shell:** Tauri v2 (Rust), using the system webview (WKWebView on macOS), not Chromium. Identifier `dev.divina.app`, product name `Divina`.
- **Host UI:** React + TypeScript + Vite, with Tailwind v4 and shadcn/ui (preset `b0`, Base UI primitives). The package manager is pnpm, which is pinned to 12.16.1 in CI.
- **Overlay:** a framework-free TypeScript IIFE (`overlay/`, a pnpm workspace package), injected into the user's running app.
- **Agents:** the user's installed `claude`, `codex` or `opencode` CLIs, run headless.

## The big picture

```
 Divina window (Tauri webview, host UI: src/)
 ├─ Library ─ drag ──────────────┐
 ├─ Frame: <iframe src=proxy> ◄──┼── postMessage (HostToOverlay / OverlayToHost) ──► overlay (in user's page)
 ├─ Properties / Agent / Edits   │
 └─ api.ts ── invoke/listen ─────┴──► Rust backend (src-tauri/src)
                                        ├─ project.rs     open/inspect project, run config
                                        ├─ devserver.rs   runs user's command, finds preview URL
                                        ├─ proxy.rs       HTTP+WS reverse proxy, injects overlay into HTML
                                        ├─ agent/         detect + run CLIs, stream events, sessions
                                        ├─ mcp/           local MCP server the agent calls
                                        ├─ checkpoint.rs  git-object snapshots, restore, diff
                                        ├─ library.rs     component discovery, installer
                                        └─ snapshot.rs    native WKWebView screenshot

 user's command ($SHELL -lc) ─► user's dev server ◄─ proxy ◄─ iframe
 agent CLI ─► edits source ─► dev server hot reload ─► iframe updates
 agent CLI ─► MCP (HTTP, bearer) ─► Rust ─► "mcp://request" ─► host UI ─► overlay or native snapshot ─► mcp_respond
```

## Shared contracts

`src/shared/protocol.ts` and `src-tauri/src/protocol.rs` are mirrored exactly (serde, camelCase). Change them together; the `wire_format_matches_ts` test round-trips samples. The key types:

| Type | What it is |
| --- | --- |
| `SourceRef` | `{file, line, col, component?, owners[], list?}`, a usage site plus its owner chain |
| `Viewport` | the preset and size |
| `Scope` | `all`, `tablet-down` or `mobile-down` |
| `Position` | `before`, `after`, `inside-start` or `inside-end` |
| `EditRecord` | `{id, kind, target, viewport, scope, payload}`, where `kind` is `insert`, `move`, `resize`, `style`, `text` or `delete` |
| `OverlayToHost` / `HostToOverlay` | the postMessage protocol between the host UI and the overlay |
| `AgentInfo`, `AgentEvent` | detected agents, and the agent stream as `text`, `tool`, `done{ok}` or `error` |
| `ProjectInfo` | `{root, framework, packageManager, tailwind, react, run, suggestedRun}`, where `framework` is only descriptive (`vite`, `next` or `custom`) |
| `RunConfig` | `{command, url?, tagging}`, written by the user and saved in `.divina/run.json` |
| `SRC_ATTR` / `OWNERS_ATTR` | the tag attributes `data-divina-src` and `data-divina-owners` |

## Tauri commands and events

All are registered in `src-tauri/src/lib.rs`, and the typed wrappers are in `src/lib/api.ts`. The UI calls the backend only through `api.ts`.

| Command | Module | Notes |
| --- | --- | --- |
| `open_project(path)` | project | stops any dev server, then inspects. Any folder opens. |
| `create_project(parent, name)` | project | shadcn Vite template. Saves no run config. |
| `save_run_config(root, run)` | project | writes `.divina/run.json`, returns `ProjectInfo` |
| `start_dev_server(root)` | devserver | `NEEDS_RUN_CONFIG` if no command is saved |
| `stop_dev_server`, `dev_server_status` | devserver | |
| `proxy_url` | proxy | |
| `detect_agents` | agent | returns installed CLIs only, with login state |
| `run_agent(agent, projectDir, prompt, edits)` | agent | checkpoints first and returns the `Checkpoint`. Errors with `NO_GIT_REPO`. |
| `cancel_agent` | agent | |
| `start_mcp_server`, `mcp_config_for(agent)`, `mcp_respond(id, payload)` | mcp | |
| `list_components(root)`, `run_installer(root, command)` | library | |
| `create_checkpoint`, `list_checkpoints`, `restore_checkpoint`, `diff_since_checkpoint`, `init_git` | checkpoint | |
| `snapshot_frame(x, y, width, height, outWidth)` | snapshot | |
| `user_name` | lib.rs | the macOS full name, for the settings row |

| Event | Payload |
| --- | --- |
| `devserver://log` | `DevServerLog` |
| `library://log` | `DevServerLog`, for installer output |
| `agent://event` | `AgentEvent` |
| `mcp://request` | `McpRequest {id, tool, arguments}`, answered with `mcp_respond` |

## Key flows

### Project open and run

1. **Welcome** calls `open_project` and opens the **Workspace**. If `project.run` is null, Workspace shows **RunSetup** (`src/components/RunSetup.tsx`) and does not start anything.
2. Saving calls `save_run_config`, then `start_dev_server`.
3. `devserver.rs` runs `$SHELL -lc <command>` in the project root, in its own process group, with `BROWSER=none` and `NO_COLOR=1`.
   - With `tagging`, it first writes the preloads into `.divina/` and sets `NODE_OPTIONS` (see PRODUCT.md, Source tagging).
4. **Finding the preview URL:** a saved `url` is polled until it accepts TCP connections. Otherwise the first line matching `parse_local_url` (the Vite or Next format) or `parse_any_local_url` (any loopback URL) wins.
5. `proxy::start(url)` points the proxy at the dev server. The proxy:
   - injects `<script src="/__divina/overlay.js">` before `</head>`
   - serves the overlay bundle
   - passes everything else, including HMR websockets, straight through

   Debug builds read `overlay/dist/divina-overlay.js` at request time; release builds embed it.
6. **Lifecycle:** if the process exits on its own, it is restarted once. `stop()` kills the process group. A pid file in `.divina/` cleans up a server left behind by a crashed app. The app's exit hook calls `devserver::stop()`.
7. **PATH at startup:** `lib.rs` adopts the login shell's PATH, because Finder-launched apps get a bare one.

### Editing

1. The overlay (`overlay/src/main.ts`, with pure helpers in `overlay/src/overlay.ts` and vitest tests):
   - reads the tags
   - resolves the user-code target with `getUserCodeTarget`, which skips `components/ui/` and `node_modules/`
   - computes drop positions from the parent's flex or grid direction
   - applies optimistic DOM changes with a revert log
   - sends `edit` records
2. The host stamps each record with the current viewport and `scopeFor` (`src/lib/viewport.ts`).
3. **Library drags** don't send pointer events into the iframe (`dragDropEnabled=false` in `tauri.conf.json` keeps HTML5 drag in the webview). The host sends `insert-hover` and `preview-insert` with frame coordinates from `toFrameCoords`.
4. **Properties edits** send `preview-edit`. `clear-optimistic` reverts everything.

### Agent run

1. `Workspace.run()` calls `run_agent`, which does the following in `agent/mod.rs`:
   1. `checkpoint::create_checkpoint`
   2. `mcp::start_mcp_server`, which is idempotent
   3. builds the prompt with `build_prompt`, then spawns the CLI in its own process group
2. The CLI is started like this:
   - **Claude:** `claude -p <prompt> --output-format stream-json --verbose --restricted --permission-mode acceptEdits --allowedTools mcp__divina --strict-mcp-config --mcp-config <json>`, plus `--resume <id>` for later runs
   - **Codex:** `codex exec --json --sandbox workspace-write --cd <root> <prompt>`, or `codex exec resume --json -c sandbox_mode="workspace-write" <id> <prompt>` for later runs, plus `-c mcp_servers.divina.*` settings
   - **opencode:** `opencode run --format json --dir <root> <prompt>`, plus `--session <id>` for later runs, with `OPENCODE_CONFIG_CONTENT=<json>`
3. `agent/streams.rs` parses each CLI's JSON stream into `AgentEvent`s, and the session ids are saved in `.divina/session.json`.
4. On `done`, the host clears the optimistic previews, removes the applied edits and shows `diff_since_checkpoint`, flagging files outside the edited ones (`changedFiles` in Workspace).

### MCP bridge

`mcp/mod.rs` is a minimal Streamable-HTTP JSON-RPC MCP server on `127.0.0.1` with a random port and a bearer token. `mcp_config_for` returns the matching config for each CLI. Each tool call emits `mcp://request`. `src/lib/mcpBridge.ts` relays it to the Workspace, which answers:

- `get_pending_edits` from host state
- `get_console_errors` from errors the overlay forwarded
- `get_dom_snapshot` from the overlay
- `screenshot_frame` with `api.snapshotFrame` (the native WKWebView `takeSnapshot` of the frame rect, resampled to the viewport width), falling back to the overlay's in-page capture

The 10 s timeout returns an error to the agent.

### Checkpoints

`checkpoint.rs` takes snapshots as commits under `refs/divina/checkpoints/<n>`:
- It builds them with a throwaway `GIT_INDEX_FILE`, so it covers tracked, modified and untracked non-ignored files without touching HEAD, the index, branches or the stash.
- Restore runs `git restore --worktree` from the snapshot. It takes an automatic checkpoint first, and HEAD doesn't move.

## Where to change what

| Change | Files |
| --- | --- |
| Run command or URL behaviour | `src-tauri/src/devserver.rs`, `src-tauri/src/project.rs`, `src/components/RunSetup.tsx` |
| Tagging | `VITE_PRELOAD`, `VITE_WRAPPER`, `NEXT_*` in `devserver.rs`; the attribute names are in the protocol files |
| Canvas interactions | `overlay/src/*` (rebuild with `pnpm -C overlay build`) |
| Agent prompt or CLI flags | `src-tauri/src/agent/mod.rs` (`build_prompt`, `configure`); stream parsing in `agent/streams.rs` |
| MCP tools | `src-tauri/src/mcp/mod.rs` and the relay in `Workspace.tsx` |
| Settings | `src/components/Settings.tsx` |
| Scope rules | `src/lib/viewport.ts`, the overlay's `scope()` in `overlay/src/main.ts`, and the scope sentence in `build_prompt`. Keep all three consistent. |

## Checks

```sh
pnpm install
pnpm build                    # tsc + vite (host UI)
pnpm test                     # vitest (host UI)
pnpm -C overlay build && pnpm -C overlay test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri dev                # run the app
```

On this machine Homebrew's `rust` comes first on PATH and has no x86_64 target. For universal builds, put rustup's toolchain first: `PATH="$HOME/.cargo/bin:$PATH" pnpm tauri build --target universal-apple-darwin --bundles app`.
