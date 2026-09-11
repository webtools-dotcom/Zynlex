# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.12.0] - 2026-09-12

A correctness release. Several features turned out never to have worked at all —
find in page, forward navigation, and tab state restore among them — and a few
long-standing rough edges are gone with them.

### Fixed

- **Find in page works.** The match counter stayed on "No results" and the
  next/previous buttons were permanently disabled, a search term containing a
  capital letter matched nothing at all, only the first occurrence in each
  paragraph was highlighted, and opening the bar hid the page you were searching.
- **Forward navigation works.** Going back silently cleared the forward history,
  so the Forward button could never become available. Back and forward now come
  from the webview itself, which also means in-page navigation on single-page
  apps is tracked correctly.
- **Escape reaches web pages.** It was being consumed by the browser on every
  page, so nothing on a site could respond to it.
- **Ctrl+D, Ctrl+F and Ctrl+Tab work while a page has focus.** All three were
  listed in the shortcut help but did nothing unless the surrounding UI happened
  to be focused.
- **Fullscreen video fills the screen** when the window is already maximized.
  The page went fullscreen inside the content area with the tab bar and sidebar
  still visible around it.
- **Closing a tab no longer drops another tab's fullscreen.**
- **Opening a new tab while a page is still loading** no longer leaves the old
  page drawn over the new tab until you close the old one.
- **Closing the last tab in a workspace** shows the home page instead of briefly
  opening the device-emulation surface.
- **Discarded tabs restore their scroll position and form values.** Passwords are
  deliberately not captured.
- **Background tabs are no longer discarded early.** Closed tabs kept counting
  toward the concurrent-webview limit, so live tabs were reclaimed to get under a
  limit that was never exceeded. That limit also now takes effect without a
  restart.
- **The System theme follows the operating system**, and a theme change reaches
  background tabs rather than only the visible one.
- **Load time is measured per tab.** Two tabs loading at once reported each
  other's timings, and one of them reported none.
- **The address bar tells URLs from searches more carefully.** `1.5` is a search,
  `example.com?q=1` is a URL, and IP addresses such as `192.168.1.50:3000` are
  navigated to.
- **A deleted workspace stays deleted** instead of reappearing empty on the next
  launch.
- **API Tester:** requests time out after 30 seconds instead of hanging forever
  with no way to cancel; very large responses are capped rather than growing
  until the app dies; a binary response says so instead of arriving as
  replacement characters; and repeated response headers, `Set-Cookie` above all,
  are no longer collapsed to one.
- **Network panel:** repeated `Set-Cookie` headers are kept, the size column is
  populated regardless of how the server capitalised `Content-Length`, and a body
  cut short at the capture limit says so instead of looking complete.
- **Header injection:** patterns like `*api.example.com` match again. A pattern
  whose last segment also appeared earlier in the URL silently matched nothing.
- **Viewport mode:** the device frame renders reliably when switching devices or
  re-entering the mode, and the command palette and shortcut help open above it
  rather than behind.
- **Live Servers:** a server that stops is shown as stopped rather than staying
  green indefinitely, and page titles are read correctly from tags carrying
  attributes.
- **Inspector:** image diagnostics work for images served over plain http, which
  is the usual case for a local dev server.

### Changed

- Find highlights at most 1000 matches per page. A one- or two-letter query on a
  large page could freeze it for several seconds.
- The Network panel keeps response bodies for the 50 most recent requests and
  drops older ones, saying so when you open them. Metadata is kept for all of
  them.
- The Inspector refreshes every 10 seconds rather than every 3. The refresh
  button covers the immediate case.
- The port scanner opens one connection per probe instead of two, and bounds how
  many it opens at once.

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

[Unreleased]: https://github.com/webtools-dotcom/Zynlex/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/webtools-dotcom/Zynlex/releases/tag/v0.12.0
[0.11.0]: https://github.com/webtools-dotcom/Zynlex/releases/tag/v0.11.0
[0.10.0]: https://github.com/webtools-dotcom/Zynlex/releases/tag/v0.10.0
[0.9.1]: https://github.com/webtools-dotcom/Zynlex/releases/tag/v0.9.1
[0.9.0]: https://github.com/webtools-dotcom/Zynlex/releases/tag/v0.9.0
