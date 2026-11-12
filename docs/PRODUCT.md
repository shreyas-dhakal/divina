# Divina: product spec

This is the source of truth for what Divina is and how it behaves. It describes the product as built. When code and this file disagree, one of them is a bug: fix the code, or update this file in the same change if the product decision changed. The original design (`docs/superpowers/specs/2026-11-11-divina-design.md`) is history and is superseded by this file.

## What Divina is

Divina is Figma for a real frontend. It is a macOS desktop app where you look at your actual running web project, drag, move and tweak its UI directly, and a coding agent already installed on your machine (Claude Code, Codex or opencode) rewrites the real source code to match.

Coding agents rarely build a layout the way you picture it, and fixing that in words takes hours. Moving the button yourself takes seconds. Divina changes the agent's job from guessing your taste to turning your direct edits into clean code.

Audience: developers. It started as the author's own test bed and is open source under AGPL-3.0.

## Principles (do not drift from these)

1. **The user is in control.** Divina never runs a project command the user didn't write. It never starts a dev server on its own or pre-fills commands; suggestions appear only as placeholder text. Opt-in behaviour (source tagging) is an explicit checkbox that explains exactly what it does.
2. **Real code, real app.** The preview is the project's own dev server. Every change lands in the project's source files. Nothing is a mockup or an export.
3. **Edits become responsive layout, never pixel pinning.** Moves are reorders or moves into another container in the flex or grid flow, and sizing and spacing become Tailwind classes. No absolute positioning.
4. **The agent changes only what was asked.** Show diff lists what changed since edits were sent, and files outside the edited ones are flagged.
5. **Nothing is lost.** Sending edits to an agent is preceded by a checkpoint of the whole working tree, and Undo restores it. Checkpoints never touch the user's branch, index or stash.
6. **No API keys.** Divina uses the agent CLIs the user already has installed and logged in.
7. **No junk in the repo.** Divina's files live in the project's `.divina/` folder, which ignores itself in git. The user's config files are never edited.

## Screens

### Start screen

- **Open project folder:** type a path or use Browse…, then Open. Any folder can be opened: React (Vite, Next.js), Laravel, Django, Rails, plain PHP and so on.
- **Create new project:** parent folder, name and a **template**:
  - **React + Vite** (default): `pnpm dlx shadcn@latest init --template vite --defaults --yes --no-monorepo --name <name>`, React + TypeScript + Tailwind v4 + shadcn/ui
  - **Next.js:** the same shadcn init with the Next template
  - **Vue + Vite:** `pnpm create vite@latest <name> --template vue-ts`, then `pnpm install`
  - **SvelteKit:** `pnpm dlx sv create <name>`, minimal TypeScript
  - **Leptos:** Divina writes a Leptos CSR + Thaw project served by Trunk (Cargo.toml, `src/main.rs`, `index.html`, `.gitignore`) and runs `cargo generate-lockfile`
  - Templates whose tools are missing are disabled, with the missing piece shown (`pnpm`; for Leptos `cargo`, and to run it `trunk` and the `wasm32-unknown-unknown` target). Leptos can still be created when only `trunk` or the target is missing.
  - Divina never starts the new project. It still needs a run command (see Set up preview); the placeholder suggests the right one, e.g. `trunk serve` on `http://127.0.0.1:8080` for Leptos.
- **Recent:** the last 8 opened projects, kept in the app's local storage.
- **Settings row:** at the bottom-left corner (see Settings).

### Set up preview dialog

Shown when a project has no saved run config. It can be reopened any time from **Run command…** on the dev server bar.

- **Run command** (required, multi-line): the user writes it. Divina runs it verbatim in the project folder through the login shell (`$SHELL -lc "<command>"`), so tools such as php, composer, python, rbenv, nvm and pnpm resolve as they do in the user's terminal.
  - Several lines run in order, like a shell script. A line that keeps running blocks the next one, so the user ends long-running lines with `&` and keeps the last one in the foreground.
  - If the script exits while its background jobs keep running, Divina treats that as a crash and restarts once, which can start duplicates. The dialog warns about this. Divina does not add `wait` or change the script.
  - ⌘↵ saves.
- **Preview URL** (optional). When it's set, Divina waits until that address accepts connections (polling for up to 120 s). When it's empty, Divina uses the first local URL the command prints. It understands the output of Vite (`Local:`), Next (`Local:` / `url:`), Laravel (`Server running on [http://127.0.0.1:8000]`), the PHP built-in server, Django and Rails, and rewrites `0.0.0.0` to `127.0.0.1`. Set it when the command starts more than one server, for example Laravel plus Vite.
- **Click-to-code source tagging** (checkbox, off by default, shown only for projects with a `react` dependency). See Source tagging.
- Placeholder hints only, never run on their own:
  - `artisan` → `php artisan serve` with `http://127.0.0.1:8000`
  - `manage.py` → `python manage.py runserver` with `:8000`
  - `bin/rails` → `bin/rails server` with `:3000`
  - a `dev` script → `pnpm dev`, `yarn dev`, `bun dev` or `npm run dev`, from the lockfile
  - a `start` script → `npm start`
  - `public/index.php` → `php -S 127.0.0.1:8000 -t public`
  - `index.php` → `php -S 127.0.0.1:8000`
- Saved to `<project>/.divina/run.json` as `{ "command", "url", "tagging" }`.

### Workspace (layout "B": one frame)

Three resizable columns:

- **Left:** a header with ← Projects and the project name, the **component library**, and the settings row at the bottom.
- **Center:** the toolbar and **frame**, with the **dev server bar** below. The bar shows the status, URL and first line of the command, opens the log drawer of the last 500 lines, and has a Run command… button.
- **Right:** tabs for **Properties** and **Terminal**, then **Pending edits** with Send to agent, Show diff and Undo.

#### Frame and viewport

- **One frame** shows the running app through Divina's proxy at an exact viewport. It starts fitted to the pane (never scaled up).
  - **Canvas, like Figma or Illustrator:** the frame sits on a free canvas you can pan and zoom past its edges.
    - **Zoom:** pinch or ⌘/Ctrl+scroll zooms around the pointer, over the page or the canvas (the overlay forwards gestures from inside the page as `zoom`). ⌘+ and ⌘− step through 10% to 400%; ⌘0 or ⇧1 fits and centres; ⌘1 or ⇧0 is 100%. The toolbar's − / % / + control does the same, and clicking the percentage toggles fit and 100%. Changing the viewport size fits again.
    - **Pan:** two-finger scroll over the grey canvas, middle-drag on the grey canvas (over the page the page gets it), or hold Space (or pick the Hand tool, H) and drag, with grab and grabbing cursors. While panning, a cover over the frame keeps the page from taking the pointer. V returns to Select. Over the page itself, plain scrolling still scrolls the page.
    - **Keys inside the page:** the overlay forwards Space, ⌘+/−/0/1, ⇧0/1 and V/H (`canvas-key`, by `KeyboardEvent.code`) unless a text field or in-place text edit has focus. On the host they're ignored in text fields and the terminal.
    - While part of the frame is out of view, `screenshot_frame` uses the in-page capture.
  - **Focus on the canvas:** the left (library) and right (properties, terminal) sidebars collapse with the panel buttons at either end of the canvas toolbar, or by dragging their handle to the edge. ⌘\ hides both, or shows both when both are hidden (forwarded from the page too). Terminals keep running while hidden.
  - **Cursor:** in select mode the page shows one cursor for the current action, overriding its own (no pointer or text cursors, since clicks select): an arrow by default, grab over the selected element, grabbing while dragging it, resize while resizing, and text while editing text in place.
- **Presets:** Desktop 1440×900, Tablet 768×1024, Mobile 390×844, or a custom W×H.
- **Snap:** the canvas toolbar offers Off, 4px and 8px (default); the app remembers the choice across projects and restarts. It rounds only free drop and move offsets inside the target container, and shows a faint dot grid while dragging. Size is unchanged; holding Shift still snaps to layout slots.
- **Responsive scope** comes from the viewport width (a user decision):
  - width 1024 or more → `all`: the edit applies at every size
  - 768 to 1023 → `tablet-down`: written with Tailwind `max-lg:`
  - under 768 → `mobile-down`: written with `max-md:`
  - Inserts follow the same rule: a component inserted at Mobile shows only at mobile size.

#### Editing on the canvas

Everything works without source tagging except snapping an element into a layout slot (see Known limits); tagging makes edits point at exact source locations.

- **Hover** outlines elements. **Click** selects the usage site in your own code. Elements whose source is under `components/ui/` or `node_modules/` are skipped in favour of the nearest owner in your code. Items rendered by a `.map()` carry `list: {file, line, index}`.
  - **Names:** the outline label and Properties title show the component whose root the element is (`Card`, `Hero`), read from React's fibers or Vue's component instance without tagging; otherwise the tag. It's sent as `ref.component`.
  - **Untagged pages:** a click selects the clicked element itself. `select` and every edit made on it (text, classes, spacing, resize, delete) carry an empty `ref.file` plus a `dom` anchor, as library drops do, and the brief asks the agent to find it from the selector, text and candidate locations. Properties shows the DOM path and a note that tagging gives exact locations.
- **Drag a selected element** to move it. While held, a see-through copy of the element follows the pointer and the original fades in place.
  - **Free by default, like Figma:** the element stays exactly where it is released. Nothing is reparented: the preview shifts it with CSS `translate`. The result is a `move` edit with `free` (its box inside the content box of the container at the drop point, in px, plus that box's size); `anchor` and `position` only name the nearest sibling there. A further move of the same element replaces its queued edit. Works without source tagging (the edit then carries a `dom` anchor).
  - **Hold Shift to snap into the layout:** Divina snaps to the nearest insertion slot in the innermost usable layout container under the pointer. The dashed purple outline names the container, and the thicker guide shows the chosen slot; slots follow row or column layout direction. Empty containers use `inside-start`. The result is a `move` edit without `free`.
  - **In code it is always layout.** For a free placement the brief gives the agent the numbers and asks it to reproduce the spot with order, margins, padding, `gap` and flex or grid alignment on the Tailwind scale, scoped like other classes, never absolute or fixed positioning or transforms. So the hot-reloaded result is the nearest layout equivalent, not a pixel copy.
- **Resize handle:** creates a `resize` edit with width and height in px. The agent turns it into layout classes.
- **Double-click text** to edit it in place, which creates a `text` edit.
- **Delete:** while a selected element is dragged, a solid red trash button appears in the bottom-right corner of the preview pane, outside the frame. The host sends its rect to the overlay in frame coords (`trash-zone`), and the overlay captures the pointer so the drag continues past the frame edge. Dropping on it, or pressing Delete or Backspace with an element selected, hides the element and creates a `delete` edit. A dropped library placeholder can be selected, dragged to the trash or deleted by key, which removes it and its queued `insert` edit instead.
- **Drag a component from the library** into the frame. The drop creates an `insert` edit.
  - **Free by default:** the component follows the pointer (centred on it) and lands exactly where it is released, also past the end of the page's content. No sibling moves. The dashed outline names the container under the pointer with the component's x, y in it. The placeholder is pinned there (on the body, re-pinned on resize), and the edit carries `free` as for moves. A dropped placeholder can be dragged again to reposition it; its queued insert is updated in place. The host sends `free: true` on `insert-hover` and `preview-insert` unless Shift is held.
  - **Hold Shift to snap into the layout.** Everything below up to Placement zones (side by side, the in-flow ghost, spacing labels, alignment snaps, placement zones) applies to snapped drags only.
  - **Real component, not a pill:** the ghost and the dropped placeholder show the component, in this order of preference. The ghost stays where it is on drop and becomes the placeholder.
    1. **Rendered live** (Vite + React): the dev server renders the component in the page (`.divina/mount.tsx`, the module the thumbnails use; `live` on `insert-hover` and `preview-insert` names the module). It takes the component's own outer display, so inline components sit beside inline siblings and blocks stack. A catalog component renders this way when the project already has it.
    2. **A picture** (`image`, a data URL): the bundled catalog thumbnail cropped to the component, for catalog components the project doesn't have yet, for project shadcn components with the same name on stacks that can't render live (Next.js), and when a live render fails (needs props or context). The host crops it on pointer down; thumbnails that aren't a clean cut-out (captured from a docs page, where the crop keeps over 40% of the frame) give no picture.
    3. **The dashed pill** with the name, for everything else. Pill and picture sit inline when they land among inline siblings.
  - **Side by side:** slots come from the child nearest the pointer. In a stacked layout, the middle of a child's left or right edge (not its top or bottom quarter) is a side drop: the preview wraps the two in a flex row, and the edit carries `beside: true` with `before` (left) or `after` (right); the brief asks the agent for a flex row, never absolute positioning. Canvas moves take side drops too. In a block container, inline children give slots along the line.
  - **Next to a pending drop:** dropped placeholders count as siblings. A drop next to one copies its anchor and adds `sibling` (that edit's id), and the brief orders the two.
  - **Drag image:** a small chip with the component name follows the cursor, instead of the browser's snapshot of the whole card.
  - **Live ghost:** while dragging, the component (or the pill) sits in the page at the chosen slot, so siblings move aside to show the result. The slot is measured as if the ghost weren't there, so a point always picks the same slot; it moves only when the slot changes, and holds its slot while the pointer is over it. It replaces the slot line during library drags. It disappears when the drag leaves the frame; on drop it stays and becomes the placeholder.
  - **Spacing labels:** red Figma-style lines measure from the ghost to its neighbours along the slot axis, or to the container's padding edge when it's first or last. Labels show pixels, plus the Tailwind class when the container uses `gap` and the value is on the default scale (`16px · gap-4`).
  - In flex rows and columns, moving near the container's cross-axis start, centre or end snaps the component's alignment, shows a magenta guide, and asks the agent to add the matching `self-start`, `self-center` or `self-end` Tailwind class. Drops outside those snap zones keep the existing alignment.
  - **Placement zones:** on empty space (the pointer is on a container and at least 24px from all its children), the container's content box shows a faint 3×3 grid and the ghost sits in the cell under the pointer: flush to its edges, or centred. The drop records the component at the end of that container with `place` (`x`/`y` each `start`, `center` or `end`), and the brief asks the agent to make it render there with layout (`self-*`, `justify-*`/`items-*`, `m*-auto` or a filling flex/grid wrapper), scoped like other classes, never absolute positioning. Until the agent runs, the placeholder is pinned at that spot in page coordinates. Near children, gap snapping applies instead.
  - **On untagged pages** (any framework, Rust included), the edit has an empty `target.file` and a `dom` anchor instead: the element's CSS path, tag, its first text run (or the nearest sibling or heading text, up to 80 chars), and `meta` (`file:line:col`) when the framework exposes dev metadata (Svelte `__svelte_meta`; Vue component `__file`, line 0).
  - **Locating the code:** when the brief is built, Divina lists up to 5 likely source locations: `meta` first, then a search for the text (`git grep`, exact then case-insensitive, honouring `.gitignore` and skipping `node_modules`, `target`, `dist`, `build`, `.divina` and lockfiles; a file walk outside git). Text under 3 characters isn't searched.
  - **The agent decides:** the prompt gives the selector, text and candidates, says the purple placeholder marks the drop, and asks the agent to screenshot first, implement, then screenshot again and fix the placement if it's wrong.
- **Properties tab:**
  - shows the selected element's source location
  - edits its text and Tailwind classes
  - has selects for Padding, Padding X, Padding Y, Margin and Gap (0 to 16) and for Width and Height (auto, full, fit, 1/2, 32, 48, 64, 96)
  - badges show the scope each value applies to
  - a newer value for the same control, element and scope replaces the older one in the queue
- **Every edit previews immediately** in the frame (optimistic DOM change). Previews are reverted when the edits are sent to an agent, and the real result arrives through the dev server's hot reload.

#### Terminal tabs

Agents run as their own interactive CLIs in Ghostty-style terminal tabs, beside the canvas. Divina has no chat of its own.

- **Tabs:** Shell (`$SHELL -l`), Claude Code, Codex and opencode, each a real PTY in the project folder, rendered with `ghostty-web` (Ghostty's VT engine as WASM). The panel starts empty with a button per kind; nothing starts on its own. Agents that aren't installed or logged in are disabled with a hint.
- **Agent tabs see the canvas:** Divina starts its MCP server and launches `claude --mcp-config <json>`, `codex --cd <root> -c mcp_servers.divina.*` or `opencode <root>` with `OPENCODE_CONFIG_CONTENT`. The user's own CLI login, settings and other MCP servers stay as they are.
- **Shortcuts:** ⌘T new tab of the active kind (or Shell), ⌘W close tab, ⌘1–8 select a tab, ⌘9 the last tab, ⌘⇧[ and ⌘⇧] previous and next. Duplicate kinds are numbered ("Claude Code 2"). An exited process shows `[process exited (code)]` and the tab stays until closed. All tabs close when the project closes or the app quits.
- **Send to agent** (needs an active agent tab; with edits pending and none active, a line above the button says so and links to the Terminal tab):
  1. checkpoint the working tree
  2. build the brief for all pending edits (`agent_prompt`)
  3. paste it into the active agent tab as a bracketed paste, followed by Return
  4. revert the previews and clear the pending edits, then switch to the Terminal tab
- **Or ask in the tab:** "apply my Divina edits" works in any agent tab, because the `get_pending_edits` MCP tool returns the edits plus the same brief.
- **Show diff** lists changes since the last sent checkpoint, flagging files outside the edited ones. **Undo** restores the latest checkpoint from this app session and walks back one step at a time. When the agent calls the `edits_applied` MCP tool after a send, Divina runs Show diff for it and shows the agent's one-line summary; Undo stays a button. Without a sent checkpoint the call is only acknowledged.
- **Not a git repo:** the user is asked once whether to run `git init`. Checkpoints need a repo, and sending is cancelled if they decline.

#### Component library

A dropdown at the top picks the source: **Your project** (below), one entry per catalog library that matches the project's stack, and **Add library…**. The detected stack shows beside it (e.g. "React 19", "Leptos 0.7").

- **Stack detection:** `package.json` gives react, vue or svelte (Next.js and Vite count as react), with the installed version from `node_modules`, else the declared one. `Cargo.toml` (and non-glob workspace members) gives leptos, yew or dioxus, with the version from `Cargo.lock`, else the declared one. Anything else is "unknown".
- **Catalog:** bundled in the app (`src-tauri/catalog/catalog.json`): shadcn/ui for React 18+, shadcn-vue for Vue 3+, shadcn-svelte for Svelte 5+, and Thaw for Leptos 0.7+. A library shows when its framework matches and its version range matches (an unknown or unparsable version matches). Components show as a grid with pre-rendered thumbnails (`public/catalog/<library>/<Name>.webp`); a missing image shows the name.
- **Dropping a catalog component** adds `library: {id, name, install, usage}` to the insert. The agent installs the library with that command if it isn't a dependency yet and follows the usage. Divina never runs the command.
- **Add library…:** name, framework (prefilled), install command, optional import path and docs URL, components one per line as `Name` or `Name | usage`, and **Save for all my projects**. Saved to `.divina/libraries.json`, or `~/.divina/libraries.json` for all projects; a project entry wins over a global one with the same id, and either replaces a bundled one.

Your project:

- **shadcn:** components from the `components.json` ui alias folder.
- **Packages:** React packages in `package.json`, found by reading each package's type declarations for PascalCase exports and following `export *`. Results are cached per hash of package.json and the lockfile.
- **Local:** your own exported PascalCase components in `src/`, `app/` and `components/`. Route files, tests and stories are skipped.
- **Import paths** use the project's tsconfig or jsconfig path aliases.
- **Live thumbnails (Vite projects):** each item shows the component rendered by the user's own dev server, with the project's CSS (components.json `tailwind.css`, else `src/index.css`, `src/globals.css` or `app/globals.css`). It renders with no props and its name as children, retrying without children if that throws. Thumbnails load lazily and are scaled to fit. One that fails, renders nothing or never reports within 5 s shows the name only. Only the first 60 previewable items get a live thumbnail; the rest show names (WebKit creates no frame past 1000 iframes per page, which left the preview frame blank on packages like lucide-react). The page is `.divina/preview.html` + `preview.tsx`, rewritten (only when changed) each time the library is listed. The proxy doesn't inject the overlay into `/.divina/` pages.
- **Installer box:** runs one single-line command that the user types, such as `pnpm dlx shadcn@latest add button` or `pnpm add some-ui-lib`, through the login shell in the project folder. Empty or multi-line input is refused. The output streams into the box and the list refreshes afterwards.

### Settings (bottom-left corner)

The row shows an initial, the macOS account's full name (from `id -F`, falling back to `$USER`) and a gear. It opens a dialog with three sections:

- **General:** Appearance (System, Light or Dark), stored in local storage. System follows the OS live.
- **Connectors:**
  - Claude Code, Codex and opencode, each Connected, Not logged in or Not installed, with version and path
  - the exact command to install (`npm i -g @anthropic-ai/claude-code`, `@openai/codex`, `opencode-ai`) or to log in (`claude auth login`, `codex login`, `opencode auth login`)
  - Refresh, which re-detects and updates the workspace's agent picker
  - whether the Divina preview tools (MCP) server is running, with its URL
- **About:** version, license and a GitHub link.

## Source tagging (opt-in)

When the Click-to-code source tagging checkbox is on, Divina adds dev-only `NODE_OPTIONS=--require` preloads to the user's command. The command itself is unchanged.

- **Vite:** `.divina/vite-preload.cjs` affects only a process whose script is `vite/bin/vite.js` running the dev server (no subcommand, or `dev`, `serve` or a flag) without its own `--config`/`-c`. It appends `--config .divina/vite.config.mjs`. That wrapper loads the user's own Vite config unchanged, swaps `react/jsx-dev-runtime` for a shim that tags elements, and adds `.divina/preview.html` to `optimizeDeps.entries` (keeping the user's entries, else the build input, else `**/*.html`) so Library thumbnails don't trigger a re-optimise reload. This also works when Vite is started indirectly, for example by `pnpm dev`, `composer run dev` or concurrently.
- **Next.js:** `.divina/next-preload.cjs` wraps Next's loaded config in memory, adding a loader that gives the project's own `.tsx`/`.jsx` files an `@jsxImportSource` pragma pointing at a tagging runtime. This covers both Turbopack and webpack.
- **Tags on each element:**
  - `data-divina-src="file:line:col"`, a project-relative usage site. When a component forwards its props, its usage site wins.
  - `data-divina-owners`, the space-separated owner usage sites, innermost first. Vite only: owner chains are skipped on Next.
- All files are written to `.divina/` at start. Nothing in the user's config changes.

## What the agent receives

The brief (pasted by Send to agent, and returned by `get_pending_edits`) contains:
- the pending edits as JSON, with source refs, owner chain, viewport and scope
- for a library insert snapped to a flex container's cross-axis alignment, the requested `self-start`, `self-center` or `self-end` class, scoped to the edit's viewport
- for untagged edits, the selector, text and candidate source locations; for catalog inserts, the library's install command and usage
- these instructions: implement only the requested changes; keep the project's patterns; map scope `all`, `tablet-down` and `mobile-down` to unprefixed, `max-lg:` and `max-md:` classes; no absolute positioning; no unrelated rewrites; verify with the divina `screenshot_frame` tool at the requested viewport and correct any mismatch before finishing; then call the divina `edits_applied` tool with a one-line summary

The agent also has the Divina MCP server, which runs locally over HTTP with a bearer token:
- `get_pending_edits`: the edits plus the brief, so "apply my Divina edits" works in any agent tab
- `screenshot_frame`: a native WKWebView snapshot of the frame at the current viewport, with an in-page capture as fallback
- `get_dom_snapshot`: the DOM tree with source refs
- `get_console_errors`
- `edits_applied(summary?)`: the agent says it's done. After a send, Divina shows the diff and the summary. It never undoes or runs anything.

## Files Divina writes

All of these are inside the project's `.divina/` folder, which ignores itself with a `.gitignore` of `*`:

| File | Written when |
| --- | --- |
| `run.json` | the user saves the run setup |
| `preview.html`, `preview.tsx`, `mount.tsx` | when the library is listed, Vite projects only (live thumbnails and real-component drops) |
| `libraries.json` | the user adds a library for this project |
| `devserver.pid` | while a dev server runs, so a leftover server from a crashed app can be cleaned up |
| `vite.config.mjs`, `vite-preload.cjs`, `next-preload.cjs`, `pragma-loader.cjs`, `jsx-dev-runtime.mjs` | at dev server start, only with tagging on |

Checkpoints are git objects under `refs/divina/checkpoints/<n>`, not files.

## Install and release

- **Users:** `brew install shreyas-dhakal/tap/divina` installs a cask with a universal (Apple Silicon and Intel) `Divina.app`.
  - The app is ad-hoc signed and not notarized, so the cask removes the quarantine flag after install.
  - Plain `brew install divina` would need acceptance into Homebrew's main repository. It isn't available.
- **Releases:**
  1. Bump `version` in `src-tauri/tauri.conf.json`.
  2. Push a tag `vX.Y.Z`.
  3. `.github/workflows/release.yml` tests, builds `--target universal-apple-darwin --bundles app`, zips `Divina-X.Y.Z-universal.zip`, publishes the GitHub release, and updates `Casks/divina.rb` in `shreyas-dhakal/homebrew-tap`. The tap update needs the `HOMEBREW_TAP_TOKEN` repo secret, or it's skipped with a warning.

## Known limits (honest list)

- **Trash button placement:** it is pinned to the preview pane's corner, so when the frame fills both width and height it can overlap the frame's corner.
- **Limited canvas editing without tagging.** Without source tagging (non-React projects, or tagging off), selection and edits go through DOM anchors, so the agent has to find the code itself, and a Shift-drag to snap an element into a slot does nothing (a snapped move needs a source anchor; free moves work). Component names come from React and Vue dev data only; Svelte and other frameworks show the tag.
- **Untagged drops are located by a guess.** The text search only finds text written literally in the source: not text built at runtime, i18n keys or icon-only elements. Repeated text gives several candidates. The agent picks and checks with screenshots, and can still pick wrong. Outside git the search reads every file, with no size limit.
- **The "agent finished" signal is best effort.** The brief asks the agent to call `edits_applied`, but it may forget, call it early or not at all (for example when the user asks for edits without the brief). Show diff stays available as a button, and Undo is always manual. Divina-side sessions are gone; each CLI keeps its own history (resume with its own commands).
- **Terminal tabs:** the terminal theme is set when a tab opens, so a light/dark switch only applies to new tabs. Shortcuts don't fire while focus is in the preview iframe. If WKWebView lets the app menu's Close Window win over ⌘W, the window closes instead of the tab (untested in the app; the fix is a custom menu).
- **Catalog:** four bundled libraries so far (shadcn/ui, shadcn-vue, shadcn-svelte, Thaw). Custom libraries have no thumbnails and can't be edited or deleted from the app (edit the JSON file). Thaw, shadcn-vue and shadcn-svelte thumbnails are captured from their docs sites.
- **Free placement is approximate in code.** The preview is pixel-exact; the code is whatever layout the agent finds for those numbers (the product rule against absolute positioning stands), so the result can land a little off and depends on the viewport it was placed at. Free placeholders are pinned in page coordinates and re-pinned only on resize. A freely moved element keeps its original space in the flow until the agent runs.
- **Side-by-side preview reparents.** A side drop moves the anchor into a preview-only wrapper row until the edits are sent. The row takes the anchor's `flex`, `align-self` and `order`, class-agnostic parent rules (`gap`, `space-y-*`) apply to the row, and the parent's `removeChild`/`insertBefore` are stood in for while a row exists so React can still remove the anchor or insert next to it. Elements that are or contain an iframe, video, audio, object or embed take no side drops (moving them reloads them). Still off: parent selectors that name the anchor (`> h1`, `:nth-child`), and `nth-of-type` counts in DOM anchors of untagged elements.
- **Real-component drops are Vite + React only.** They render with no props and the name as children, like thumbnails. Elsewhere only components with a bundled shadcn/ui thumbnail get a picture; project components on Next.js, custom libraries, and shadcn-vue, shadcn-svelte and Thaw (docs-page thumbnails) get the pill. Rendering live on Next.js would need a route inside the user's app, which Divina doesn't add. A zone drop made before the component finishes rendering is pinned using the pill's size.
- **No owner chains on Next.js.** Tagging gives `file:line:col` only.
- **Screenshot fallback:** the native screenshot exists only on macOS. Elsewhere the in-page capture is used, which can miss cross-origin styles.
- **Not notarized:** see Install and release.
- **macOS first.** Windows and Linux aren't polished.
- **Thumbnails are Vite-only.** Next.js and non-Vite projects show names. Components that need props or a parent context (a `DialogTrigger` outside `Dialog`) show names too. Without source tagging, the first thumbnail that imports a not-yet-optimised package can make Vite re-optimise and reload the frame once (Vite caches the result, so it doesn't repeat until dependencies change). With tagging on, the wrapper adds the thumbnail page to Vite's dep scan, so this doesn't happen.
- **opencode detection costs a model call:** it runs one tiny model call per detection, because stored credentials don't prove the model works.

## Not built (non-goals for now)

- multi-frame infinite canvas (layout "A")
- non-React click-to-code
- real-time collaboration
- Figma import
- deployment or hosting
- bundled Chromium (Divina uses the system WKWebView)
