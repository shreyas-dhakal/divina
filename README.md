# Divina

Figma for a real frontend. A macOS app where you drag, move and tweak the UI of your actual running web project, and the coding agent you already use (Claude Code, Codex or opencode) rewrites the source to match. You write the command that runs your project. Divina never runs anything you didn't.

## Docs

- [docs/GUIDE.md](docs/GUIDE.md): how to use Divina
- [docs/PRODUCT.md](docs/PRODUCT.md): product spec, the source of truth for behaviour
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it's built and where to change what
- [AGENTS.md](AGENTS.md): rules for coding agents working on this repo

## Install

```
brew install shreyas-dhakal/tap/divina
```

macOS (Apple Silicon and Intel). You need Node.js and at least one of Claude Code, Codex or opencode installed and logged in.

## Dev

```sh
pnpm i
pnpm tauri dev
```

Checks: `pnpm build && pnpm test`, `pnpm -C overlay build && pnpm -C overlay test`, `cargo test --manifest-path src-tauri/Cargo.toml`.

## Release

Bump `version` in `src-tauri/tauri.conf.json`, commit, then push a tag: `git tag v0.2.0 && git push origin v0.2.0`. The Release workflow builds the universal macOS app, publishes the GitHub release and updates the Homebrew tap (needs the `HOMEBREW_TAP_TOKEN` repo secret).

## License

Copyright (C) 2026 Shreyas Dhakal

Divina is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0-only). If you modify Divina and distribute it, or let people use a modified version over a network, you must make your source available under the same license.
