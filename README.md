# Divina

Figma for a real frontend. A desktop app (Tauri v2 + Rust) where you drag, move and tweak UI on your actual running React project, and your local coding agent (Claude Code / Codex / opencode) rewrites the source to match.

Design spec: [docs/superpowers/specs/2026-11-11-divina-design.md](docs/superpowers/specs/2026-11-11-divina-design.md)

## Dev

```sh
pnpm i
pnpm tauri dev
```

Checks: `pnpm build`, `pnpm --dir overlay build`, `cargo test --manifest-path src-tauri/Cargo.toml`.

## Module ownership

| Path | Owns |
| --- | --- |
| `src/shared/protocol.ts`, `src-tauri/src/protocol.rs` | Shared contracts (mirrored; change both, additively) |
| `src-tauri/src/lib.rs` | Command registration only |
| `src-tauri/src/project.rs` | `open_project`, `create_project` |
| `src-tauri/src/devserver.rs` | `start_dev_server`, `stop_dev_server`, `dev_server_status`; emits `devserver://log` |
| `src-tauri/src/proxy.rs` | `proxy_url`; overlay-injecting proxy |
| `src-tauri/src/agent/` | `detect_agents`, `run_agent`, `cancel_agent`; emits `agent://event` |
| `src-tauri/src/mcp/` | `start_mcp_server`, `mcp_config_for` |
| `src-tauri/src/library.rs` | `list_components`, `run_installer` |
| `src-tauri/src/checkpoint.rs` | `create_checkpoint`, `list_checkpoints`, `restore_checkpoint`, `diff_since_checkpoint` |
| `src/lib/api.ts` | Typed `invoke`/`listen` wrappers for the commands above |
| `src/App.tsx` | Host UI shell (library / frame / panel) |
| `src/components/ui/` | shadcn components (preset `b0`) |
| `overlay/` | In-frame overlay script, built to `overlay/dist/divina-overlay.js` (IIFE) |

## License

Copyright (C) 2026 Shreyas Dhakal

Divina is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). If you modify Divina and distribute it, or let people use a modified version over a network, you must make your source available under the same license.
