# Divina — design

Figma for a real frontend. A desktop app where you drag, move and tweak UI on your actual running project, and a local coding agent (Claude Code / Codex / opencode) rewrites the source to match.

## Intent and why

Coding agents rarely build a layout the way the user pictures it, and correcting them in words takes hours. Moving the button yourself takes seconds. This app flips the agent's job from *guessing taste* to *translating direct manipulation into clean code*.

Audience: the author first, as a test bed. It will be open-sourced later, so nothing may depend on the author's personal setup.

## Goals (v1)

1. **Open a project**: point at an existing React project folder, *or* create a new one from scratch with shadcn/ui preconfigured.
2. **Live preview in one frame** (chosen layout "B"): a single device frame in the center running the project's real dev server, with a toolbar for Desktop / Tablet / Mobile / custom W×H. The frame emulates the chosen viewport size (scaled to fit when larger than the window).
3. **Component library sidebar** (left): lists components available in the project. Any component library installed in the project should show up and be usable (shadcn first, but not shadcn-only). A one-line installer box accepts commands like `pnpm dlx shadcn@latest add button` or another library's install command and runs it in the project.
4. **All three editing modes work in v1:**
   - **Drag new**: drag a library component into the frame at a position in the layout.
   - **Move / tweak existing**: click to select an element on the page, drag it to a new spot, resize it, edit spacing/text/basic props in the right panel.
   - **Prompt, then adjust**: type in the agent chat ("build a pricing section"), the agent builds it, the user then adjusts by hand with the above.
5. **Agent writes the code**: every canvas edit becomes a precise instruction to the agent, which edits the real source. The frame reloads (HMR) with the real result.
6. **Agent can see the preview**: the agent has browser-use-like access to the frame (screenshot, page structure, the user's pending edits) so it can verify its change matches what the user laid out and fix mismatches before handing back.
7. **Uses the user's existing agent CLI**: auto-detect which of `claude`, `codex`, `opencode` are installed and logged in; use one (user picks if several). No API key required.

## Non-goals (v1)

- Multi-frame infinite canvas (layout "A") — later.
- Non-React frameworks (Vue, Svelte, plain HTML) — later.
- Real-time collaboration, Figma import, deployment/hosting.
- Windows/Linux polish — macOS first; don't do anything that blocks them later.
- Bundled Chromium. System webview (WKWebView on macOS) is fine for now.

## Anti-goals (failure even if it "works")

- Edits produce absolute-positioned / pixel-pinned markup. Moves must become real layout changes (reordering in a flex/grid/stack, moving into a different container, Tailwind spacing/size classes) so the result is responsive, maintainable code.
- The agent rewrites unrelated code or "improves" things nobody asked for.
- The user's code is lost or left broken with no way back.
- The user's repo is left full of junk from the tool.
- Requires an API key or a specific paid provider.

## Constraints and decided how

- **Language / shell: Rust, via Tauri v2** (user's choice: Rust). System webview, not Chromium (user confirmed fine).
- **The app's own UI**: React + Tailwind + **shadcn/ui**, initialised with the user's preset:
  `pnpm dlx shadcn@latest apply --preset b0`
  Package manager for the app itself: pnpm.
- **Agents**: drive the installed CLIs headlessly (e.g. `claude -p --output-format stream-json`, `codex exec --json`, `opencode run`), streaming output into the chat panel. Exact flags are the builder's to verify against installed versions.
- **Editing is the agent's job.** The app does not do its own AST rewriting of user code in v1; it produces precise, located instructions and the agent edits.

## My calls (Claude's, not confirmed by user — flag if wrong)

- **v1 project support:** React with Tailwind, on Vite or Next.js (App Router). New projects scaffold Vite + React + Tailwind + shadcn.
- **Element → source mapping:** while a project is open in the app, rendered elements carry their source location (`file:line:col`), so a selection/drag becomes "move `<Button>` at `src/Hero.tsx:42` to after the `<h1>` at line 30". Likely via a dev-only JSX source-tagging plugin (e.g. `code-inspector-plugin`-style) injected at dev-server start without permanently modifying the user's config if possible; if a config change is unavoidable, it is dev-only, clearly marked, and the user is asked once on first open.
- **Preview plumbing:** the frame is an iframe of the dev server served through a small local proxy in the Rust backend that injects an overlay script into HTML responses. The overlay handles hover/selection outlines, drag handles, drop indicators, and talks to the host UI via `postMessage`. This sidesteps cross-origin DOM access.
- **Optimistic preview, then real code:** a drag/tweak immediately updates the DOM in the frame as a preview. Edits queue up and are sent to the agent when the user hits **Apply** (or Cmd+Enter), not on every mouse move. After the agent finishes, HMR shows the real result and the optimistic state is discarded.
- **Agent ↔ app bridge:** the Tauri backend runs a local MCP server the agent CLI is pointed at, exposing roughly: `get_pending_edits`, `screenshot_frame` (at the current viewport size), `get_dom_snapshot` (with source locations), `get_console_errors`. Same mechanism for every CLI instead of relying on each one's own browser setup.
- **Safety / checkpoints:** before each Apply or chat prompt, snapshot the whole working tree (including uncommitted changes) into git objects under a private ref namespace (`refs/divina/checkpoints/*`), never as commits on the user's branch and never as a new branch. Multi-step undo walks back through checkpoints. Init git if absent, with consent. Committing is the user's job.
- **Responsive edit scope (user confirmed):** edits made at Desktop apply to all sizes. Edits made at Tablet or Mobile apply only to that size and below, written as Tailwind breakpoint-scoped classes (max-width variants). Each edit record carries the viewport and the scope. The right panel shows which size a value comes from.
- **Edit scope enforcement:** run the agent with file writes limited to the project directory. After each run, show the diff; files changed outside the edit list's files are flagged, and each can be reverted from the checkpoint in one click. Not auto-rejected.
- **Selection target:** clicking selects the *usage site* in the user's code (where `<Card>` is written), not the library definition (`components/ui/card.tsx`). Elements rendered by a `.map()` are marked as "item i of list at `file:line`"; moving one is handed to the agent as a reorder of that list (usually the data), and the agent decides how. The mapping keeps the owner-component chain, not a single `file:line`, so the agent gets enough context.
- **Agent session:** one continuing agent session per project (resumed with each CLI's resume mechanism) so "now nudge it" keeps context. Canvas Applies and chat prompts go through the same checkpoint → run → diff flow.
- **Component discovery:** shadcn via `components.json` + the `components/ui` folder; other libraries via the project's `package.json` deps and exported components; the user's own components by scanning the source tree. Thumbnails/previews are rendered by the dev server itself (a Vite virtual-module preview route, so no file is written into the project). On Next.js, v1 shows name + icon only, with no live thumbnails, because a route would mean writing a file into `app/`. "Any library loads" means: if it's installed and exports React components, it appears and can be dropped; the agent writes the import and default usage.
- **Dev server:** detect package manager from lockfile, run the project's `dev` script as a child process, parse the URL/port from output, restart on crash, show logs in a panel.

## Left to the builder

- Exact crate/library choices (proxy, MCP server crate, process management).
- How screenshots are captured from WKWebView (native snapshot API vs in-page rendering).
- Drop-target heuristics (how a drop position maps to "before/after sibling X" or "into container Y").
- Panel styling within the shadcn preset; keyboard shortcuts.
- Prompt template the app sends the agent per Apply (must include: edit list with source locations, viewport size, "change only what's needed", and "verify via screenshot_frame before finishing").

## Success for the first test

On a real project of the author's: open it, drag a shadcn Button into a section, move an existing card above another, change a heading's text and padding, ask the agent for a new section and then nudge it — hit Apply — and the resulting code is what a careful developer would have written, rendering as laid out at both Desktop and Mobile sizes.
