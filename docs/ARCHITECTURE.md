# Divina: architecture

How the product in `docs/PRODUCT.md` is built. Read that first. This file maps behaviour to code, so changes land in the right place.

## Stack

- **Shell:** Tauri v2 (Rust), using the system webview (WKWebView on macOS), not Chromium. Identifier `dev.divina.app`, product name `Divina`.
- **Host UI:** React + TypeScript + Vite, with Tailwind v4 and shadcn/ui (preset `b0`, Base UI primitives). The package manager is pnpm, which is pinned to 12.16.1 in CI.
- **Overlay:** a framework-free TypeScript IIFE (`overlay/`, a pnpm workspace package), injected into the user's running app.
- **Agents:** the user's installed `claude`, `codex` or `opencode` CLIs, run interactively in terminal tabs (PTYs).

## The big picture

```
 Divina window (Tauri webview, host UI: src/)
 ├─ Library ─ drag ──────────────┐
 ├─ Frame: <iframe src=proxy> ◄──┼── postMessage (HostToOverlay / OverlayToHost) ──► overlay (in user's page)
 ├─ Properties / Terminal / Edits│
 └─ api.ts ── invoke/listen ─────┴──► Rust backend (src-tauri/src)
                                        ├─ project.rs     open/inspect project, run config
                                        ├─ devserver.rs   runs user's command, finds preview URL
                                        ├─ proxy.rs       HTTP+WS reverse proxy, injects overlay into HTML
                                        ├─ agent/         detect CLIs, build the edit brief, locate untagged drops
                                        ├─ terminal.rs    PTYs for terminal tabs (shell, agent CLIs + MCP)
                                        ├─ mcp/           local MCP server the agent calls
                                        ├─ checkpoint.rs  git-object snapshots, restore, diff
                                        ├─ library.rs     component discovery, installer, thumbnail page
                                        ├─ catalog.rs     stack detection, bundled + custom component catalog
                                        └─ snapshot.rs    native WKWebView screenshot

 user's command ($SHELL -lc) ─► user's dev server ◄─ proxy ◄─ iframe
 terminal tab (PTY) ─► agent CLI ─► edits source ─► dev server hot reload ─► iframe updates
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
| `AgentInfo` | a detected agent CLI: `{kind, path, loggedIn, version}` |
| `ProjectInfo` | `{root, framework, packageManager, tailwind, react, run, suggestedRun}`, where `framework` is only descriptive (`vite`, `next` or `custom`) |
| `RunConfig` | `{command, url?, tagging}`, written by the user and saved in `.divina/run.json` |
| `SRC_ATTR` / `OWNERS_ATTR` | the tag attributes `data-divina-src` and `data-divina-owners` |

## Tauri commands and events

All are registered in `src-tauri/src/lib.rs`, and the typed wrappers are in `src/lib/api.ts`. The UI calls the backend only through `api.ts`.

| Command | Module | Notes |
| --- | --- | --- |
| `open_project(path)` | project | stops any dev server, then inspects. Any folder opens. |
| `list_templates()`, `create_project(parent, name, template)` | project | templates: react-vite, next, vue, svelte, leptos; tool probes set `available`/`missing`. Saves no run config. |
| `save_run_config(root, run)` | project | writes `.divina/run.json`, returns `ProjectInfo` |
| `start_dev_server(root)` | devserver | `NEEDS_RUN_CONFIG` if no command is saved |
| `stop_dev_server`, `dev_server_status` | devserver | |
| `proxy_url` | proxy | |
| `detect_agents` | agent | returns installed CLIs only, with login state |
| `agent_prompt(root, edits)` | agent | the brief Send to agent pastes; "" for no edits |
| `terminal_open(root, kind, cols, rows)`, `terminal_write(id, data)`, `terminal_resize(id, cols, rows)`, `terminal_close(id)`, `terminal_close_all` | terminal | agent kinds start the MCP server and attach it |
| `start_mcp_server`, `mcp_config_for(agent)`, `mcp_respond(id, payload)` | mcp | |
| `list_components(root)`, `run_installer(root, command)` | library | |
| `detect_stack(root)`, `list_catalog(root)`, `save_library(root, library, global)` | catalog | catalog data in `src-tauri/catalog/catalog.json`, thumbnails in `public/catalog/` |
| `create_checkpoint`, `list_checkpoints`, `restore_checkpoint`, `diff_since_checkpoint`, `init_git` | checkpoint | |
| `snapshot_frame(x, y, width, height, outWidth)` | snapshot | |
| `user_name` | lib.rs | the macOS full name, for the settings row |

| Event | Payload |
| --- | --- |
| `devserver://log` | `DevServerLog` |
| `library://log` | `DevServerLog`, for installer output |
| `terminal://data` | `TerminalData {id, data}`, base64 PTY output |
| `terminal://exit` | `TerminalExit {id, code}` |
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

1. The overlay (`overlay/src/main.ts`, with helpers in `overlay/src/overlay.ts`, slot selection in `overlay/src/slots.ts` and alignment snaps in `overlay/src/align.ts`, empty-space placement zones in `overlay/src/zones.ts`, covered by vitest tests):
   - reads the tags
   - resolves the user-code target with `getUserCodeTarget`, which skips `components/ui/` and `node_modules/`
   - `pickDropSlot` selects the innermost layout container and nearest child insertion slot from pointer coordinates; the same result drives the purple container highlight, guide, preview insertion, and canvas move edit
   - flex library drops detect a cross-axis alignment from the container geometry; the magenta guide and optional `InsertPayload.align` use that same result
   - for drops on untagged elements, builds a `DomAnchor` (`buildDomAnchor`) and sends the insert with an empty `target.file`
   - applies optimistic DOM changes with a revert log
   - sends `edit` records
2. The host stamps each record with the current viewport and `scopeFor` (`src/lib/viewport.ts`).
3. **Library drags** don't send pointer events into the iframe (`dragDropEnabled=false` in `tauri.conf.json` keeps HTML5 drag in the webview). The host sends `insert-hover` and `preview-insert` with frame coordinates from `toFrameCoords`. Catalog cards add `library` to the drag JSON, and `preview-insert` forwards it into `InsertPayload.library`.
   - On `insert-hover`, `showGhost` in `main.ts` places a `data-divina-ui` ghost at the slot (same `placeAt` mapping as `dropInsert`), so `usable` keeps it out of slot geometry and snapshots. `hoverSlot` returns the ghost's slot while the pointer is inside the ghost's rect, so the reflow it causes can't flip the slot. `dropInsert` uses the same hover, then turns the ghost into the placeholder.
   - `showSpacing` draws the red gap lines and labels from `measureGaps` and `spacingLabel` (pure helpers in `overlay/src/guides.ts`).
   - `makeBox` builds the ghost: with `live` it imports `/.divina/mount.tsx` from the page and renders the real component, else `image` (a catalog thumbnail cropped by `picture` in `Library.tsx`), else a pill. `dropInsert` keeps the ghost as the placeholder. Side drops (`DropSlot.beside`, `slots.ts`) are previewed by `placeAt` in a `data-divina-row` wrapper that `tidy` dissolves (`standIn` keeps the parent's `removeChild`/`insertBefore` working for the framework meanwhile); `build_prompt` turns `beside` and `sibling` into instructions.
   - **Free placement** is the default (`free` on the host messages, Shift turns it off): `hoverAt` returns the pointer with `freeSlot` naming the container, `float` keeps the ghost under the pointer, and `dropInsert` pins it (`pins`, `pin`) and records `InsertPayload.free` (`freeAt`). The host sends the app-wide snap step, and `snapGuide` plus `snapOffset` show and apply it during free drags; `moveFreely` records the same snapped offsets. Shift slot snapping is unchanged. `build_prompt` turns `free` into layout instructions, gives grid-snapped offsets as Tailwind spacing values, and asks the agent to check the result with MCP `measure_placement`. After clearing previews, the host stores a full page record and compares it with a fresh page record (`src/lib/placement.ts`: candidate identity, position and container width; identical moved elements are told apart by following their source lines through the checkpoint diff, `followLine` in `src/lib/diffLines.ts`). `measure_placement` and `edits_applied` both run this host-side check; `edits_applied` refuses twice while a free placement is off.
4. **Library thumbnails:** `list_components` writes `.divina/preview.html` + `preview.tsx` + `mount.tsx` (a lazy `import()` per module) for Vite projects. `Library` loads `<proxy>/.divina/preview.html?m=<importFrom>&n=<name>` in `pointer-events-none` iframes; the page posts `{divinaPreview: "importFrom#name", ok}` to the parent.
5. **Properties edits** send `preview-edit`. `clear-optimistic` reverts everything.

### Terminal tabs and Send to agent

1. `TerminalPanel` (`src/components/TerminalPanel.tsx`, `ghostty-web`) calls `terminal_open`. `terminal.rs` spawns the process in a PTY in the project folder (`TERM=xterm-256color`) and streams output on `terminal://data` from a reader thread:
   - **Shell:** `$SHELL -l`
   - **Claude:** `claude --mcp-config <json>`
   - **Codex:** `codex --cd <root>` plus `-c mcp_servers.divina.*` settings
   - **opencode:** `opencode <root>` with `OPENCODE_CONFIG_CONTENT=<json>`
   Agent kinds call `mcp::start_mcp_server` (idempotent) and `mcp::mcp_config_for` first. Tabs stay mounted while hidden; keystrokes go to `terminal_write`, resizes to `terminal_resize`.
2. **Send to agent** in `Workspace`: `create_checkpoint` (offering `init_git` on `NO_GIT_REPO`), then `agent_prompt(root, edits)`, which is `build_prompt` (untagged sections from `agent/locate.rs`, library notes for catalog inserts). The brief is written to the active agent tab as `ESC[200~ … ESC[201~` plus `\r`. Then the host clears the previews and the sent edits.
3. **Show diff** calls `diff_since_checkpoint` for the latest sent checkpoint (`changedFiles` flags files outside the edits); **Undo** calls `restore_checkpoint`.
4. `terminal_close_all` runs when the Workspace unmounts and on app exit.

### MCP bridge

`mcp/mod.rs` is a minimal Streamable-HTTP JSON-RPC MCP server on `127.0.0.1` with a random port and a bearer token. `mcp_config_for` returns the matching config for each CLI. Each tool call emits `mcp://request`. `src/lib/mcpBridge.ts` relays it to the Workspace, which answers:

- `get_pending_edits` from host state (`{root, edits}`); the Rust side adds the `build_prompt` brief
- `get_console_errors` from errors the overlay forwarded
- `edits_applied` by running `showDiff()` and showing the summary in the notice, only when a sent checkpoint exists (`{diffShown}`); the Rust side turns that into a short ack
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
| Component catalog | `src-tauri/catalog/catalog.json`, `src-tauri/src/catalog.rs`, `src/components/Library.tsx`, `src/components/AddLibrary.tsx`; regenerate thumbnails with `scripts/catalog-thumbnails/` |
| Locating untagged drops | `buildDomAnchor` in `overlay/src/overlay.ts`, `src-tauri/src/agent/locate.rs` |
| Agent brief | `build_prompt` in `src-tauri/src/agent/mod.rs` |
| Terminal tabs, agent CLI flags | `src-tauri/src/terminal.rs` (`command_for`), `src/components/TerminalPanel.tsx` |
| Project templates | `list_templates`, `create_project`, `write_leptos_files` in `src-tauri/src/project.rs`; `src/components/Welcome.tsx` |
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
