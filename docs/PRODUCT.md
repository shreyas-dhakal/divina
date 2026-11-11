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
4. **The agent changes only what was asked.** Each run's diff is shown, and files outside the edited ones are flagged.
5. **Nothing is lost.** Every agent run is preceded by a checkpoint of the whole working tree, and Undo restores it. Checkpoints never touch the user's branch, index or stash.
6. **No API keys.** Divina uses the agent CLIs the user already has installed and logged in.
7. **No junk in the repo.** Divina's files live in the project's `.divina/` folder, which ignores itself in git. The user's config files are never edited.

## Screens

### Start screen

- **Open project folder:** type a path or use Browse…, then Open. Any folder can be opened: React (Vite, Next.js), Laravel, Django, Rails, plain PHP and so on.
- **Create new project:** parent folder and name. This runs `pnpm dlx shadcn@latest init --template vite --defaults --yes --no-monorepo --name <name>`, which creates a Vite + React + TypeScript + Tailwind v4 + shadcn project. The new project still needs a run command (see Set up preview).
- **Recent:** the last 8 opened projects, kept in the app's local storage.
- **Settings row:** at the bottom-left corner (see Settings).

### Set up preview dialog

Shown when a project has no saved run config. It can be reopened any time from **Run command…** on the dev server bar.

- **Run command** (required, multi-line): the user writes it. Divina runs it verbatim in the project folder through the login shell (`$SHELL -lc "<command>"`), so tools such as php, composer, python, rbenv, nvm and pnpm resolve as they do in the user's terminal.
  - Several lines run in order, like a shell script. A line that keeps running blocks the next one, so the user ends long-running lines with `&` and keeps the last one in the foreground.
  - If the script exits while its background jobs keep running, Divina treats that as a crash and restarts once, which can start duplicates. The dialog warns about this. Divina does not add `wait` or change the script.
  - ⌘↵ saves. The textarea stops the event, so it doesn't also trigger Apply.
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
- **Right:** tabs for **Properties** and **Agent**, then **Pending edits** with Apply ⌘↵ and Undo, then the diff of the last run.

#### Frame and viewport

- **One frame** shows the running app through Divina's proxy at an exact viewport. It's scaled down to fit and never scaled up.
- **Presets:** Desktop 1440×900, Tablet 768×1024, Mobile 390×844, or a custom W×H.
- **Responsive scope** comes from the viewport width (a user decision):
  - width 1024 or more → `all`: the edit applies at every size
  - 768 to 1023 → `tablet-down`: written with Tailwind `max-lg:`
  - under 768 → `mobile-down`: written with `max-md:`
  - Inserts follow the same rule: a component inserted at Mobile shows only at mobile size.

#### Editing on the canvas

This needs source tagging (see Known limits).

- **Hover** outlines elements. **Click** selects the usage site in your own code. Elements whose source is under `components/ui/` or `node_modules/` are skipped in favour of the nearest owner in your code. Items rendered by a `.map()` carry `list: {file, line, index}`.
- **Drag a selected element** to move it. A drop line shows before or after a sibling, or inside a container, following the parent's flex or grid direction. The result is a `move` edit.
- **Resize handle:** creates a `resize` edit with width and height in px. The agent turns it into layout classes.
- **Double-click text** to edit it in place, which creates a `text` edit.
- **Drag a component from the library** into the frame. A drop indicator follows the pointer and a labelled placeholder is inserted, which creates an `insert` edit.
- **Properties tab:**
  - shows the selected element's source location
  - edits its text and Tailwind classes
  - has selects for Padding, Padding X, Padding Y, Margin and Gap (0 to 16) and for Width and Height (auto, full, fit, 1/2, 32, 48, 64, 96)
  - badges show the scope each value applies to
  - a newer value for the same control, element and scope replaces the older one in the queue
- **Every edit previews immediately** in the frame (optimistic DOM change). Previews are reverted when a run starts, and the real result arrives through the dev server's hot reload.

#### Agent

- **Agent picker:** lists the detected CLIs, and logged-out ones can't be picked.
- **Chat:** the transcript shows agent text, tool calls and errors. Prompting works on every project, with or without tagging.
- **Apply (⌘↵)** sends the chat text and all pending edits in one run:
  1. checkpoint the working tree
  2. start the CLI
  3. stream its output into the chat
  4. when it finishes, show the diff since the checkpoint, flagging files outside the edited files
- **Not a git repo:** the user is asked once whether to run `git init`. Checkpoints need a repo, and the run is cancelled if they decline.
- **Cancel** kills the agent's process group. **Undo** restores the latest checkpoint from this app session and walks back one step at a time.
- **One continuing session per agent per project,** resumed on later runs and stored in `.divina/session.json`, so "now nudge it" keeps its context.

#### Component library

- **shadcn:** components from the `components.json` ui alias folder.
- **Packages:** React packages in `package.json`, found by reading each package's type declarations for PascalCase exports and following `export *`. Results are cached per hash of package.json and the lockfile.
- **Local:** your own exported PascalCase components in `src/`, `app/` and `components/`. Route files, tests and stories are skipped.
- **Import paths** use the project's tsconfig or jsconfig path aliases.
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

- **Vite:** `.divina/vite-preload.cjs` affects only a process whose script is `vite/bin/vite.js` running the dev server (no subcommand, or `dev`, `serve` or a flag) without its own `--config`/`-c`. It appends `--config .divina/vite.config.mjs`. That wrapper loads the user's own Vite config unchanged and swaps `react/jsx-dev-runtime` for a shim that tags elements. This also works when Vite is started indirectly, for example by `pnpm dev`, `composer run dev` or concurrently.
- **Next.js:** `.divina/next-preload.cjs` wraps Next's loaded config in memory, adding a loader that gives the project's own `.tsx`/`.jsx` files an `@jsxImportSource` pragma pointing at a tagging runtime. This covers both Turbopack and webpack.
- **Tags on each element:**
  - `data-divina-src="file:line:col"`, a project-relative usage site. When a component forwards its props, its usage site wins.
  - `data-divina-owners`, the space-separated owner usage sites, innermost first. Vite only: owner chains are skipped on Next.
- All files are written to `.divina/` at start. Nothing in the user's config changes.

## What the agent receives

Each run passes:
- the user's prompt
- the pending edits as JSON, with source refs, owner chain, viewport and scope
- these instructions: implement only the requested changes; keep the project's patterns; map scope `all`, `tablet-down` and `mobile-down` to unprefixed, `max-lg:` and `max-md:` classes; no absolute positioning; no unrelated rewrites; verify with the divina `screenshot_frame` tool at the requested viewport and correct any mismatch before finishing

The agent also has the Divina MCP server, which runs locally over HTTP with a bearer token:
- `get_pending_edits`
- `screenshot_frame`: a native WKWebView snapshot of the frame at the current viewport, with an in-page capture as fallback
- `get_dom_snapshot`: the DOM tree with source refs
- `get_console_errors`

## Files Divina writes

All of these are inside the project's `.divina/` folder, which ignores itself with a `.gitignore` of `*`:

| File | Written when |
| --- | --- |
| `run.json` | the user saves the run setup |
| `session.json` | after an agent run (resumable session ids) |
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

- **No canvas editing without tagging.** Without source tagging (non-React projects, or tagging off), clicking in the preview selects nothing, because the overlay needs `data-divina-src`. Chat prompts still work, and the agent still gets screenshots, the DOM and console errors.
- **No owner chains on Next.js.** Tagging gives `file:line:col` only.
- **Screenshot fallback:** the native screenshot exists only on macOS. Elsewhere the in-page capture is used, which can miss cross-origin styles.
- **Not notarized:** see Install and release.
- **macOS first.** Windows and Linux aren't polished.
- **opencode detection costs a model call:** it runs one tiny model call per detection, because stored credentials don't prove the model works.

## Not built (non-goals for now)

- multi-frame infinite canvas (layout "A")
- non-React click-to-code
- real-time collaboration
- Figma import
- deployment or hosting
- bundled Chromium (Divina uses the system WKWebView)
