# Roadmap

Open items, in no particular priority order. Not commitments or dates — see
open issues for anything actively being worked on.

## Platform

- Cross-platform support (macOS/Linux). Currently Windows-only: tab lifecycle,
  cookies, network capture, header injection, and viewport emulation are all
  built on WebView2 COM APIs with no WebKitGTK/WKWebView equivalent yet. See
  [docs/architecture.md](docs/architecture.md#known-limitations).
- Live download progress (needs WebView2 COM's `ICoreWebView2DownloadOperation`
  — Tauri's `DownloadEvent` has no progress callback).

## Browser chrome

- Port scanner: HTTP title in sidebar tooltip, manual "add custom port" UI.
- Status bar: hovered-link URL preview (needs an injected script).
- Find in page: case-sensitive and whole-word toggles.

## Sidebar panels

- Workspace drag-to-reorder in the sidebar.
- Bookmarks: drag-to-reorder (folders already exist; assignment is currently
  via a select).
- API Tester: response body type detection (HTML/image/JSON preview),
  environment variables, request duplication/share.

## Testing

- Runtime integration tests exercising the live Tauri app (currently only unit
  tests over pure logic — anything touching the webview bridge needs
  `pnpm tauri dev` on real hardware).
