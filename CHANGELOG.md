# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.11.0] - 2026-08-05

### Added

- ZYNLEX now checks for a newer release on launch and offers to install it.
  Nothing is downloaded until you agree, and dismissing the prompt lasts for
  that session only. Updates are signed, and a build will refuse an update it
  cannot verify.

### Note

Builds before this one have no updater. If you are on 0.10.0 or earlier you
need to install this version manually, once.


## [0.10.0] - 2026-08-05

### Added

- The status bar now shows the target URL of a hovered link. Thanks to
  [@terminalchai](https://github.com/terminalchai) for the implementation, which
  uses WebView2's `StatusBarTextChanged` rather than an injected listener.

### Changed

- Find, the viewport panel and the API tester are now scoped to the tab or
  workspace that opened them. They were global booleans, so opening find in one
  tab showed it in all of them and the API tester leaked across workspaces.


## [0.9.1] - 2026-08-03

### Fixed

- The About line in Settings showed a hardcoded version instead of the real one.

## [0.9.0] - 2026-07-31

First public release. Development history before this point is in the git log
rather than here — this file starts at the point the project became something
other people could install.

### Added

- **Localhost server discovery.** The new-tab page scans local ports and lists
  running dev servers with their page titles, refreshed on an interval.
- **Network log.** Per-tab request capture built on WebView2 COM (not a proxy):
  method, status, resource type, size, timing and response bodies, with
  pause/resume, URL search, method/status/type filters, and a preserve-log
  toggle for navigations.
- **Viewport emulation.** One device at true 1:1, with the correct CSS pixel
  size, device pixel ratio, user agent, Client Hints and touch flags.
- **Header injection.** Per-workspace rules to add, override or strip request
  headers, matched by URL glob.
- **API tester.** Request editor with methods, headers, bodies and cURL import,
  running through Rust so page CORS and CSP don't apply. Requests save into
  per-workspace collections with folders; history persists across restarts.
- **Workspaces.** Tabs, bookmarks, header rules and saved requests are scoped
  per workspace and restored on relaunch.
- **Session restore.** Tabs come back after a restart as discarded entries that
  materialise on click, so startup creates exactly one webview.
- **Inspector.** Meta and Open Graph validation, social preview cards, and a
  cookie manager backed by the native WebView2 cookie API (reads `HttpOnly`).
- **Downloads panel** with a persisted, clearable history.
- **Bookmarks** with folders, a toggleable bookmark bar, and JSON import/export.
- **Command palette** (`Ctrl+K`) across tabs, bookmarks, history, workspaces,
  saved requests and detected servers.
- **Vertical tab layout** as an alternative to the top tab bar.
- **Utilities:** JWT decoder, Base64 encoder/decoder, user-agent switcher,
  find-in-page, per-tab zoom with persistence.

### Known limitations

- **Windows only.** Tab lifecycle, cookies, network capture, header injection
  and viewport emulation are implemented against WebView2 COM APIs. A build for
  another platform compiles but refuses to start rather than launch without
  them. See [ROADMAP.md](ROADMAP.md).
- Downloads report started and finished, not progress — Tauri's download event
  exposes no progress callback.
- Header rules do not apply to WebSocket handshakes; WebView2 does not raise its
  request event for them.
- The network log captures fetch and XHR, not images, fonts or stylesheets.
- JWT signatures are decoded, never verified.

[Unreleased]: https://github.com/webtools-dotcom/Zynlex/compare/v0.11.0...HEAD
[0.11.0]: https://github.com/webtools-dotcom/Zynlex/releases/tag/v0.11.0
[0.10.0]: https://github.com/webtools-dotcom/Zynlex/releases/tag/v0.10.0
[0.9.1]: https://github.com/webtools-dotcom/Zynlex/releases/tag/v0.9.1
[0.9.0]: https://github.com/webtools-dotcom/Zynlex/releases/tag/v0.9.0
