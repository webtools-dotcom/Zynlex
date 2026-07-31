# Architecture

ZYNLEX runs each browser tab as its own child webview, composited natively inside a
single undecorated OS window. This document covers the invariants that keep that
model correct: process layout, bounds/resize, fullscreen, viewport emulation, and
the security boundary between page content and the app.

## Process model

Each tab is a child `Webview` (label `browser-{tabId}`) created via
`Window::add_child` on the main window, lazily on first navigation. Switching tabs
hides/shows the corresponding child — it never reloads, so tab state (scroll
position, in-page JS state, form values) survives a switch.

Exactly one tab webview is visible at a time, and this is enforced in Rust, not
trusted from the frontend: both `browser_show_tab` and `browser_create_tab` call
`hide_all_browser_webviews_except` (covering both Tauri's webview registry and the
app's own handle map) before showing anything. On the JS side, the tab-switch
effect carries a sequence guard so a superseded async show/create can't clobber a
later one.

No webview — including the main window — sets `data_directory`. This is what keeps
every webview inside one shared WebView2 environment (one browser/GPU/network
process set). Setting it on tab webviews only makes those tabs share an
environment *with each other*, not with the main window, and spawns a second,
duplicate WebView2 process tree.

Tabs inactive for more than 10 minutes are discarded (destroyed, then recreated
and reloaded on next switch). Pinned and active tabs are exempt. A soft cap of 10
concurrent webviews discards the oldest background tab when exceeded.

## Bounds and resize

Bounds are logical (CSS) pixels, window-relative — never screen coordinates.

Window resizes reposition the active child webview entirely in Rust, via
`on_window_event` in `lib.rs`'s `setup`, using content-area insets cached from the
last `browser_set_bounds` call. This runs inline inside the native
`WindowEvent::Resized` handler. The equivalent JS path — a `ResizeObserver` firing
an `invoke()` call — is 3-5 frames slower (requestAnimationFrame + IPC + Tokio +
event-loop queueing), which is enough for the child webview to visibly lag the
window during a drag-resize or maximize. The JS `ResizeObserver` still exists, but
it only drives layout changes that aren't window resizes (sidebar width, panel
splits).

An animated maximize needs special handling: `Window::add_child` webviews are not
auto-resized by Windows when the parent's client area grows (only moved, clipped,
hidden, or restored), so the synchronous `Resized` handler is the only thing that
resizes them — and on a mid-animation frame it can apply bounds that are already
stale by the time the animation finishes. A coalesced settle-timer re-reads the
window size ~320ms later (outlasting the maximize animation) and re-applies,
forcing a WebView2 recomposite via a height-1-then-real-height nudge when the
window is maximized.

## Fullscreen (HTML video)

Fullscreen is sized from the window's own reported size after the OS fullscreen
transition completes — never from an independently computed monitor rect. The
app's window has no decorations, so its client rect *is* the fullscreen rect once
the transition finishes, with no title bar or border to account for.

Fullscreen state is tracked per-tab (the owning tab's label), not as a global
flag. A global flag would stay set after switching away from or closing the
fullscreen tab, silently breaking tab switching for the rest of the session.

## Viewport emulation

The Viewport panel renders one device at a time, at true 1:1 scale, under a single
reused native webview. The measured card rect is the single source of truth for
both the webview's bounds and the CDP layout viewport override — they are the same
number, so they cannot drift apart. There is no independent display-scale factor:
combining a bounds scale with a CDP viewport override and a WebView2 zoom factor
async-raced against each other in earlier iterations, producing frames that were
cropped, off-center, or zoomed by a stale factor.

Device emulation carries three pieces that geometry alone can't express:
device-pixel ratio, `mobile`, and touch support — all set via CDP
(`Emulation.setDeviceMetricsOverride`), plus `Emulation.setUserAgentOverride` for
the UA string and Client Hints metadata (Chromium prefers Client Hints over the
UA header, so both must be set for server-side device detection to work), and
`Emulation.setPageScaleFactor: 1` (without it, Chromium's mobile shrink-to-fit
kicks in whenever anything overflows the viewport, and the page renders zoomed out
even though the layout viewport is correct).

## Security model

Page-originated IPC is intentionally never used. Tauri v2 rejects
`__TAURI_INTERNALS__.invoke` from `https://` content unless a capability declares
`remote.urls` — and declaring that would force allow-listing every command and
expose tab-scoped commands to any page the user navigates to.

Anything that needs data out of a tab — Inspector reads, tab title/favicon, in-page
keyboard shortcuts — goes through native WebView2 COM APIs instead
(`ExecuteScript`, `DocumentTitleChanged`, `AcceleratorKeyPressed`), always
Rust-initiated, never page-initiated. `capabilities/default.json` declares no
`remote` scope. This is a deliberate boundary, not a gap — do not add
`remote.urls` to work around it.

## Known limitations

- **Windows-only.** The tab/cookie/network/viewport machinery is built on
  WebView2 COM APIs, which have no equivalent implementation for WebKitGTK or
  WKWebView. A macOS/Linux build does not currently compile.
- **No live download progress.** Tauri's `DownloadEvent` has no progress
  callback; a percentage would need WebView2 COM's
  `ICoreWebView2DownloadOperation`.
- **Header injection cannot cover WebSockets.** WebView2 never fires
  `WebResourceRequested` for the WebSocket handshake — this isn't fixable from
  the app side.
