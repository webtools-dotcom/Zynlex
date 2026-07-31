# CLAUDE.md

Project-specific guidance for AI coding agents working in this repo. General
agent conduct (scope discipline, no speculative abstractions, ask before
guessing) is assumed — this file only covers what's specific to ZYNLEX.

## Where things live

- [docs/architecture.md](docs/architecture.md) — process model, bounds/resize,
  fullscreen, viewport emulation, security boundary. Read this before touching
  anything in `src-tauri/src/commands/browser.rs` or `src/hooks/useWebviewBridge.ts`.
- [docs/design-system.md](docs/design-system.md) — color tokens, typography,
  layout, Tauri platform constraints, hard rules for UI code.
- [ROADMAP.md](ROADMAP.md) — open items, not yet scheduled.
- [CONTRIBUTING.md](CONTRIBUTING.md) — build commands and pre-PR checks.

## Build and check commands

```bash
pnpm install
pnpm tauri dev              # run the app
pnpm lint                   # Biome
pnpm check-types            # tsc --noEmit
pnpm test                   # Vitest
pnpm build                  # tsc + vite build
pnpm knip                   # dead-code / unused-dependency check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

## Non-obvious constraints specific to this codebase

- **This app is Windows-only.** The tab/cookie/network/viewport machinery is
  built on WebView2 COM APIs (`webview2-com`, `windows-core`). Don't add
  cross-platform fallback code without discussing it first — it's a real
  multi-session undertaking, not a quick `#[cfg]` branch.
- **Never add `remote.urls` to `src-tauri/capabilities/default.json`.** Page-
  originated IPC is a deliberate non-feature — see
  [docs/architecture.md](docs/architecture.md#security-model). Anything that
  needs data out of a tab goes through Rust-initiated WebView2 COM calls
  (`ExecuteScript`, `DocumentTitleChanged`), never page-initiated `invoke()`.
- **Never use `window.confirm()` or `window.prompt()`.** They render behind
  the child webview and are unreachable. Use the existing `ConfirmButton`
  pattern for destructive actions.
- **Bounds/resize logic is fragile by history.** Read
  [docs/architecture.md](docs/architecture.md#bounds-and-resize) before
  touching `on_window_event` in `lib.rs`, `browser_set_bounds`, or the
  `ResizeObserver` in `useWebviewBridge.ts`. Do not route resize sync through
  a JS `ResizeObserver` → `invoke()` path — it's measurably slower and visibly
  lags the window during drag-resize.
- **`data_directory` must not be set on any webview**, including tab
  webviews — see [docs/architecture.md](docs/architecture.md#process-model).
