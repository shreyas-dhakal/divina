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

- **One frame** shows the running app through Divina's proxy at an exact viewport. It's scaled down to fit and never scaled up.
- **Presets:** Desktop 1440×900, Tablet 768×1024, Mobile 390×844, or a custom W×H.
- **Responsive scope** comes from the viewport width (a user decision):
  - width 1024 or more → `all`: the edit applies at every size
  - 768 to 1023 → `tablet-down`: written with Tailwind `max-lg:`
  - under 768 → `mobile-down`: written with `max-md:`
  - Inserts follow the same rule: a component inserted at Mobile shows only at mobile size.

#### Editing on the canvas

Selecting, moving, resizing and text editing need source tagging (see Known limits). Library drops work on any page.

- **Hover** outlines elements. **Click** selects the usage site in your own code. Elements whose source is under `components/ui/` or `node_modules/` are skipped in favour of the nearest owner in your code. Items rendered by a `.map()` carry `list: {file, line, index}`.
- **Drag a selected element** to move it. A drop line shows before or after a sibling, or inside a container, following the parent's flex or grid direction. The result is a `move` edit.
- **Resize handle:** creates a `resize` edit with width and height in px. The agent turns it into layout classes.
- **Double-click text** to edit it in place, which creates a `text` edit.
- **Drag a component from the library** into the frame. A drop indicator follows the pointer and a labelled placeholder is inserted, which creates an `insert` edit.
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
- **Send to agent** (needs an active agent tab):
  1. checkpoint the working tree
  2. build the brief for all pending edits (`agent_prompt`)
  3. paste it into the active agent tab as a bracketed paste, followed by Return
  4. revert the previews and clear the pending edits, then switch to the Terminal tab
- **Or ask in the tab:** "apply my Divina edits" works in any agent tab, because the `get_pending_edits` MCP tool returns the edits plus the same brief.
- **Show diff** lists changes since the last sent checkpoint, flagging files outside the edited ones. **Undo** restores the latest checkpoint from this app session and walks back one step at a time. Divina can't tell when an interactive agent is done, so both are buttons.
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
- **Live thumbnails (Vite projects):** each item shows the component rendered by the user's own dev server, with the project's CSS (components.json `tailwind.css`, else `src/index.css`, `src/globals.css` or `app/globals.css`). It renders with no props and its name as children, retrying without children if that throws. Thumbnails load lazily and are scaled to fit. One that fails, renders nothing or never reports within 5 s shows the name only. The page is `.divina/preview.html` + `preview.tsx`, rewritten (only when changed) each time the library is listed. The proxy doesn't inject the overlay into `/.divina/` pages.
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
- for untagged edits, the selector, text and candidate source locations; for catalog inserts, the library's install command and usage
- these instructions: implement only the requested changes; keep the project's patterns; map scope `all`, `tablet-down` and `mobile-down` to unprefixed, `max-lg:` and `max-md:` classes; no absolute positioning; no unrelated rewrites; verify with the divina `screenshot_frame` tool at the requested viewport and correct any mismatch before finishing

The agent also has the Divina MCP server, which runs locally over HTTP with a bearer token:
- `get_pending_edits`: the edits plus the brief, so "apply my Divina edits" works in any agent tab
- `screenshot_frame`: a native WKWebView snapshot of the frame at the current viewport, with an in-page capture as fallback
- `get_dom_snapshot`: the DOM tree with source refs
- `get_console_errors`

## Files Divina writes

All of these are inside the project's `.divina/` folder, which ignores itself with a `.gitignore` of `*`:

| File | Written when |
| --- | --- |
| `run.json` | the user saves the run setup |
| `preview.html`, `preview.tsx` | when the library is listed, Vite projects only (live thumbnails) |
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

- **Limited canvas editing without tagging.** Without source tagging (non-React projects, or tagging off), clicking in the preview selects nothing, because the overlay needs `data-divina-src`. Library drops still work through DOM anchors, and agents in terminal tabs work as usual.
- **Untagged drops are located by a guess.** The text search only finds text written literally in the source: not text built at runtime, i18n keys or icon-only elements. Repeated text gives several candidates. The agent picks and checks with screenshots, and can still pick wrong. Outside git the search reads every file, with no size limit.
- **No "agent finished" signal.** Interactive agents don't report completion, so Show diff and Undo are manual. Divina-side sessions are gone; each CLI keeps its own history (resume with its own commands).
- **Terminal tabs:** the terminal theme is set when a tab opens, so a light/dark switch only applies to new tabs. Shortcuts don't fire while focus is in the preview iframe. If WKWebView lets the app menu's Close Window win over ⌘W, the window closes instead of the tab (untested in the app; the fix is a custom menu).
- **Catalog:** four bundled libraries so far (shadcn/ui, shadcn-vue, shadcn-svelte, Thaw). Custom libraries have no thumbnails and can't be edited or deleted from the app (edit the JSON file). Thaw, shadcn-vue and shadcn-svelte thumbnails are captured from their docs sites.
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
