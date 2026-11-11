# Agent instructions for the Divina repo

Divina is a Tauri v2 (Rust) macOS app: Figma for a real frontend. The user edits their running web project visually, and their local coding agent CLI writes the code.

## Read before changing anything

1. `docs/PRODUCT.md` is the product spec and the source of truth for behaviour.
2. `docs/ARCHITECTURE.md` maps behaviour to code: commands, events, flows, and where to change what.
3. `docs/GUIDE.md` is the user-facing guide.

`docs/superpowers/specs/2026-11-11-divina-design.md` is the original design. It's history and superseded where it differs.

## Product rules you must not break

These are decisions the owner made. Don't reverse them without being asked.

- **User in control.** Never run, start or pre-fill a project command the user didn't write. Run commands go verbatim through `$SHELL -lc` in the project folder. Suggestions may only be placeholder text. Anything that adds behaviour to the user's process (source tagging) is an explicit, explained opt-in.
- **Never edit the user's project config.** Divina's files go in `<project>/.divina/`, which is git-ignored by its own `.gitignore`.
- **Checkpoints never touch** the user's HEAD, index, branches or stash. Use `refs/divina/checkpoints/*` with a temporary `GIT_INDEX_FILE`. Never commit for the user.
- **Responsive scope:** Desktop (width 1024 or more) gives `all`. Tablet (768 to 1023) gives `tablet-down` and `max-lg:`. Mobile (under 768) gives `mobile-down` and `max-md:`. These rules live in three places, which must agree: `src/lib/viewport.ts`, `scope()` in `overlay/src/main.ts`, and `build_prompt` in `src-tauri/src/agent/mod.rs`.
- **Canvas edits become layout changes** (reorder, move into a container, Tailwind classes). Never absolute positioning.
- **No API keys.** Use the installed `claude`, `codex` or `opencode` CLIs.
- **Layout is "B":** a single frame with viewport presets. The multi-frame canvas is not built.
- **The app's own UI** uses shadcn (preset `b0`, Base UI) and Tailwind v4. Add components with `pnpm dlx shadcn@latest add <name>`.

## Contracts

- `src/shared/protocol.ts` and `src-tauri/src/protocol.rs` are mirrored. Change both, additively where possible, and keep the `wire_format_matches_ts` test passing.
- The UI talks to Rust only through `src/lib/api.ts`. Register new commands in `src-tauri/src/lib.rs`.

## Before you say it's done

```sh
pnpm build && pnpm test
pnpm -C overlay build && pnpm -C overlay test
cargo test --manifest-path src-tauri/Cargo.toml
```

For UI changes, also run `pnpm tauri dev` and look at the result.

**Docs are part of the change.** If you change user-visible behaviour, update `docs/PRODUCT.md`, and `docs/GUIDE.md` where it applies, in the same commit. If you move responsibilities between modules, update `docs/ARCHITECTURE.md`. Update "Known limits" honestly.

## Conventions

- **Minimal code.** No speculative abstractions. Mark deliberate shortcuts with a `ponytail:` comment naming the limit and the upgrade path.
- **Match the surrounding style.** Comments explain why, not what.
- **Commits** end with a Co-Authored-By line for the agent that wrote them.
- **Git hosting:** the remote is `github.com/shreyas-dhakal/divina`. On this machine a stale `GITHUB_TOKEN` is set, so push with `env -u GITHUB_TOKEN git push`.
- **Releases:** bump `src-tauri/tauri.conf.json` `version`, then push a `vX.Y.Z` tag. See `.github/workflows/release.yml`.
