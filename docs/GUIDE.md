# Using Divina

A practical guide. For exact behaviour, see `docs/PRODUCT.md`.

## 1. Install

```sh
brew install shreyas-dhakal/tap/divina
```

You also need:
- **Node.js**, plus whatever your project itself needs (PHP, Python, Ruby and so on).
- **At least one coding agent, installed and logged in:**

  | Agent | Install | Log in |
  | --- | --- | --- |
  | Claude Code | `npm i -g @anthropic-ai/claude-code` | `claude auth login` |
  | Codex | `npm i -g @openai/codex` | `codex login` |
  | opencode | `npm i -g opencode-ai` | `opencode auth login` |

To check what Divina sees, open the settings row in the bottom-left corner, go to **Connectors**, and press Refresh.

## 2. Open a project

On the start screen, type or browse to your project folder and press **Open**. You can also create a new Vite + React + shadcn project there.

## 3. Tell Divina how to run it

The first time you open a project, **Set up preview** asks for the command that starts its dev server. You write it, and Divina runs exactly that in the project folder, in your normal shell. Examples:

| Project | Run command | Preview URL |
| --- | --- | --- |
| Vite / React | `pnpm dev` | (leave empty) |
| Next.js | `npm run dev` | (leave empty) |
| Laravel | `php artisan serve` | `http://127.0.0.1:8000` |
| Laravel + Vite | `composer run dev` | `http://127.0.0.1:8000` |
| Django | `python manage.py runserver` | `http://127.0.0.1:8000` |
| Rails | `bin/rails server` | `http://127.0.0.1:3000` |
| Plain PHP | `php -S 127.0.0.1:8000 -t public` | `http://127.0.0.1:8000` |

**Several lines** run in order. End a line that keeps running with `&`, and keep the last one in the foreground:

```sh
cd api && php artisan serve &
npm run dev
```

**Preview URL:** leave it empty to use the first local address your command prints. Set it when your command starts more than one server.

**Click-to-code source tagging** (React projects only): turn it on if you want to click and drag things in the preview. It doesn't change your command. Divina adds a dev-only Node preload whose files live in the git-ignored `.divina/` folder.

You can change all of this later from **Run command…** under the preview.

## 4. Edit visually

- **Size:** pick Desktop, Tablet, Mobile or a custom size in the toolbar. Edits at Desktop apply everywhere. Edits at Tablet or Mobile apply at that size and smaller.
- **Click** an element to select it. **Drag** it to move it; the purple line shows where it will land.
- **Resize** with the corner handle, and **double-click** text to edit it.
- **Properties** (right panel): change text, classes, padding, margin, gap, width and height.
- **Library** (left panel): drag a component into the frame. On Vite projects each component shows a live thumbnail rendered by your dev server. To install more, type a command in the installer box, for example `pnpm dlx shadcn@latest add card`.

Each change previews instantly and joins **Pending edits**.

## 5. Let the agent write the code

- Pick an agent in the **Agent** tab and optionally type what you want ("make this a pricing section").
- Press **Apply** or ⌘↵. Divina saves a checkpoint, the agent edits your source files, checks a screenshot of the preview, and your page reloads with the real result.
- Review the changed files below. Files outside the ones you edited are flagged.
- **Undo** restores the checkpoint. If the folder isn't a git repository, Divina asks once whether it may run `git init`.

## Good to know

- **Without tagging** (for example on Laravel Blade pages), you can't select elements in the preview, but you can still ask the agent in chat. It still sees screenshots and the page structure.
- **Divina never commits for you.** Checkpoints are stored outside your branches.
- **Everything Divina stores** for a project is in `.divina/`. Delete that folder to reset it.
