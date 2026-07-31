# Contributing

## Prerequisites

- Node.js 24
- Rust (stable toolchain, `rustc` 1.96+)
- pnpm 11
- Windows — ZYNLEX is currently Windows-only (see
  [docs/architecture.md](docs/architecture.md#known-limitations))

## Getting started

```bash
pnpm install
pnpm tauri dev
```

## Checks before opening a PR

```bash
pnpm lint          # Biome
pnpm check-types   # tsc --noEmit
pnpm test          # Vitest
pnpm build          # tsc + vite build
pnpm knip           # dead-code / unused-dependency check
```

```bash
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

These are the same checks CI runs. `pnpm format` / `cargo fmt` will fix most
formatting issues automatically.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, `build:`). Keep the
subject line under ~70 characters; explain *why* in the body when the change
isn't self-evident from the diff.

## Measuring memory

`scripts/measure.ps1` sums the working set of `zynlex.exe` plus its whole
`msedgewebview2` child process tree — measuring `zynlex.exe` alone understates
RAM usage significantly, since the actual page renderers live in the child
processes. Pass `-Name chrome` to compare against another browser.

## Where things live

See [docs/architecture.md](docs/architecture.md) for the process model and the
non-obvious invariants (bounds sync, fullscreen, viewport emulation, the
security boundary), and [docs/design-system.md](docs/design-system.md) for the
UI token system and platform constraints.
