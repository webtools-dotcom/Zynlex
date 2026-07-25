# XEVO Project State

## Version: v1.42.0
## Status: CORE gaps closed; RAM/perf pass done (idle RAM 1117 MB → 857 MB, resize/drag latency fixed, network capture gated to panel-open); motion pass done (design tokens now load-bearing, panel-switch fade-in). TS, Rust and `pnpm build` all clean.

## ENVIRONMENT
- OS: Windows
- Node: v24.16.0
- Rust: rustc 1.96.0
- pnpm: 11.5.0
- Tauri CLI / crate: 2.11.2

## ARCHITECTURE NOTE (CURRENT)
- **Tab-per-child-webview architecture:** each tab is a child `Webview` (label `browser-{tabId}`) created via `Window::add_child` on the main window, lazily on first navigation. Tab switch = hide/show only, no reload, full state preserved.
- Parent is the main window's `Window` (not `WebviewWindow`) — z-order, move, resize-clip, minimize/restore are OS-native.
- Tabs inactive >10 min are discarded (destroyed, recreated + reloaded on next switch). Pinned/active tabs exempt. Soft cap of 10 concurrent webviews (`maxConcurrentWebviews`), oldest background tab discarded when exceeded.
- No webview sets `data_directory` — every webview, main window included, uses Tauri's default, which is what actually keeps them in one WebView2 environment (one browser/GPU/network process set). Setting it on tab webviews only made tabs share with *each other* and spawned a second, duplicate process tree; removing it cut idle RAM 1117 MB → 857 MB.
- Bounds are logical (CSS) pixels, window-relative — not screen coordinates.
- **Window resizes reposition the active child webview entirely in Rust**, via `on_window_event` in `lib.rs`'s `setup`, using content-area insets cached from the last `browser_set_bounds` call (`BrowserState.content_insets`). This runs inline inside the native `WindowEvent::Resized` handler — Tauri's event loop drops its window-registry borrow before invoking listeners, so a re-entrant `set_bounds` call from there is safe (verified against `tauri-runtime-wry` 2.11.2's event-loop match arm). Do not move this back to a JS `ResizeObserver` → `invoke()` path — that route is 3-5 frames slower (rAF + IPC + Tokio + event-loop queueing) and is what made the page visibly lag the window during a drag-resize or maximize. The JS `ResizeObserver` still exists and still drives *layout* changes (sidebar, panels) that aren't window resizes.
- **HTML fullscreen (video):** WebView2's `ContainsFullScreenElementChanged` is handled in `register_webview_native_events` — on enter it sets `BrowserState.fullscreen`, puts the main window into OS fullscreen (`Window::set_fullscreen`), reads the window's own `inner_size()` right after (the app's window is `decorations:false`, so its client rect IS the fullscreen rect once the transition completes — no separate title bar/border to account for), and applies that to the active child with insets forced to `(0,0,0,0)` in `apply_active_child_bounds`; on exit it reverses. **Single source of truth, no independent monitor-size computation**: an earlier version tried computing bounds from `current_monitor().size()` directly, which left a thin strip at the bottom (whatever mismatch — origin/work-area/DPI-rounding — between that computed value and the real window rect). Fixed by always sizing the child from the *window's actual reported size* (same value the ordinary `WindowEvent::Resized` handler already uses for normal resizes), applied three times redundantly for safety — immediately in the fullscreen handler, again when the OS's own `Resized` event fires from the `set_fullscreen` call, and again from the 320ms settle-timer — all three reading the real window, so any one being momentarily stale self-corrects within a frame. `browser_set_bounds`/`browser_show_tab` early-return while fullscreen so the JS ResizeObserver sync can't shrink the child back. Recomposite nudge and settle-timer's own re-apply are both skipped while fullscreen (mid-transition re-applies were the ~0.5s freeze). Without any of this, `Window::add_child` children fullscreen only within their own inset bounds, leaving chrome visible.
- **Webview color scheme:** the app theme drives web pages' `prefers-color-scheme` via WebView2's native `ICoreWebView2Profile::PreferredColorScheme` (`apply_color_scheme` in browser.rs), applied on tab creation (from `BrowserState.preferred_dark`) and on every theme toggle (`browser_set_theme`). The old eval that set `document.documentElement.style.colorScheme` + `<meta color-scheme>` did NOT change `prefers-color-scheme`, so sites like Google/YouTube stayed dark regardless of app theme — that eval is gone. Profile is shared across all tabs, so the setting is consistent app-wide and updates already-loaded pages live (no reload).
- **Maximize-freeze fix:** child webviews (`Window::add_child`) are NOT auto-resized by Windows when the parent's client area grows (only moved/clipped/hidden/restored), so the `Resized` handler is the only thing resizing them. On an *animated* maximize the synchronous handler applies bounds from a mid-animation size and can leave the child stuck. Fix has 3 parts: (1) `lib.rs` extracts `apply_active_child_bounds(app, win_w, win_h, nudge)` shared by the sync handler; (2) after the sync apply, a coalesced (`BrowserState.resync_pending: AtomicBool`) settle-timer re-reads `inner_size()` ~320ms later (outlasts the maximize animation) and re-applies, passing `nudge=true` only when `is_maximized()` — the nudge sets height-1 then real height to force a WebView2 recomposite that a same-size `set_bounds` would suppress; (3) JS belt-and-suspenders: `WindowControls.tsx` dispatches `xevo:maximize-changed` on state flip, `useWebviewBridge` clears `lastBoundsRef` on it so the ResizeObserver→syncBounds fallback can't be short-circuited by the <1px guard. Do NOT put the nudge on every `Resized` (flicker) — settle-timer + maximized-only.
- **Remote-page IPC is intentionally never used.** Tauri v2 rejects `__TAURI_INTERNALS__.invoke` from `https://` content unless a capability declares `remote.urls`, which would force allow-listing every command and expose tab-scoped commands to any page. Anything that needs data out of a tab (Inspector reads, tab title/favicon, in-page shortcuts) goes through native WebView2 COM APIs instead (`ExecuteScript`, `DocumentTitleChanged`, `AcceleratorKeyPressed`) — Rust-initiated, never page-initiated. Do not reintroduce page-originated IPC calls.

## FEATURES

### Browser Chrome
- Settings Panel: theme (dark/light/system), search engine (+custom `%s`), scan interval, compact mode.
- Command Palette (Ctrl+K): fuzzy search across tabs, bookmarks, history, workspaces, servers, requests; grouped results, 5-entry MRU.
- Find in Page (Ctrl+F): JS-based, match highlighting/cycling.
- Tab bar: drag-to-reorder (pointer events, HTML5 DnD is broken in WebView2), context menu (close/close others/close right), pinning, vertical mode (`tabBarPosition: "left"`).
- Bookmark bar: toggleable, folders, JSON import/export (Blob+anchor, re-ids on import so double-import can't collide).
- Status bar: load time, loading pulse, origin, zoom indicator when ≠100%.
- Address bar: scheme-derived security indicator (lock/not-secure/wrench for localhost).
- Keyboard shortcuts: Ctrl+F/D/K/L/H/?, Ctrl+Shift+S/T/1-9, Escape. Full list in Ctrl+? sheet.
- Zoom: native Ctrl+mousewheel (WebView2), Ctrl+/-/0 forwarded from page, per-tab persisted. Known gap: mousewheel zoom doesn't update the store, so the status bar can lag that one input path.
- Hard reload: goes through CDP `Page.reload({ignoreCache:true})` — neither wry nor WebView2 exposes an ignore-cache reload API directly.

### Sidebar Panels
- Bookmarks, History (100-entry FIFO), Notes (rich text, pin/color/export MD), JWT Decoder, Base64 Tool.
- Network Log: native WebView2 COM capture (fetch/XHR only, not assets/images/fonts — by design), 17 resource types, timing, response body (5KB cap), filter chips, pause/resume, URL search, method/status/resource-type filters, preserve-log toggle, per-tab scoping, 500-entry cap.
- API Tester: Postman-style, method/URL/headers/body/cURL import, `api_fetch` Rust command (reqwest+rustls, bypasses app CSP/CORS), collections (folders, save/load/duplicate/move), 100-entry history.
- Header Injection: per-tab rules via WebView2 `WebResourceRequested`, anchored glob matching, defaults to active tab's origin (wildcard rules show a warning icon), inline value editing, internal-scheme guard.
- UA Switcher: 9 presets, injects override script.
- Inspector: meta validation, social preview (FB/Twitter/LinkedIn/Discord), image diagnostics via `new Image()` + HEAD request (not `fetch`, which CSP blocks). Cookie inspector via native `ICoreWebView2CookieManager` — sees HttpOnly cookies, exact domain/path-match delete and attribute-preserving edit. "Clear All" only clears cookies visible to the current page, never `DeleteAllCookies()`.
- Viewport Panel: mobile/tablet/laptop presets, CSS Grid layout, scroll sync.
- Downloads Panel: native `on_download` events, Open/Show-in-folder/Clear history. No live progress % (Tauri's `DownloadEvent` has no progress callback — would need WebView2 COM `ICoreWebView2DownloadOperation`).
- Screenshot Tool (Ctrl+Shift+S): CDP `Page.captureScreenshot`, PrintWindow fallback.
- All destructive actions use in-panel `ConfirmButton` (Sure?/No, Escape or ~4s to disarm) — never `window.confirm()`, which renders behind the child webview and is unreachable.

### UI & Theming
- **Warm Ivory retint (2b)**: whole app reskinned via `src/index.css` token values only (no component edits — ~700 `var(--color-*)` usages inherit automatically). Dark: base `#0b0b0a`, accent `#dcd3c4`. Light: warm "paper" `#faf8f3` base, accent darkened to `#a89878` for contrast (the dark theme's pale ivory is unreadable on a light bg — don't reuse the same accent hex across themes here). Body font is now `--font-ui` = JetBrains Mono (was Inter) for the "terminal instrument" feel; `--font-display` (Space Grotesk) added and used only on the HomePage hero heading + empty-state message, matching the design handoff exactly — not applied to panel titles/chrome. Server liveness dots stay functional green/red (`--color-live`/`--color-dead` untouched) rather than following the design's monochrome-dot spec, since they carry real alive/dead signal.
- New Tab / Home Page (`HomePage.tsx`): rebuilt to the **2b Warm Ivory** mockup — single centered flex column (`items-center`) so every block shares one center axis (was the asymmetry bug: a 440px centered search over a full-width left-padded servers block). Top-to-bottom: `▚ XEVO / LOCALHOST` eyebrow, Space Grotesk 46px (`--font-display`) heading, `//` mono subtitle, 620px×58px command bar (`›` accent prompt + inline Ctrl+L), then a 720px LIVE SERVERS section (label + hairline rule + `watching :ports`/`N running`) with a framed dashed empty-state (corner glyphs, `npm run dev` in accent) or the 2-col grid cards when populated. Command chips ($ new server / git status / open project) from the mockup deliberately OMITTED (map to no real feature). Bottom status bar OMITTED (global `StatusBar` already exists). All colors via `--color-*` tokens so it tracks light/dark.
  - **Gotcha (bit us):** never use `text-base` as a font-size class here — `--color-base` is a theme token, so Tailwind emits `text-base` as a *color* utility (`color: var(--color-base)`), silently overriding a sibling `text-[var(--color-accent)]`. Use `text-[1rem]` for size. Same family as the documented `--color-base`/`.text-base` collision.
- Light/dark/system theme, rem-based type scale (`--text-micro`→`--text-lg`, root 16px), compact mode is a single `html.xevo-compact { font-size: 14px }` override.
- All colors/spacing go through `@theme` tokens — no raw hex, no undefined `--color-*` custom properties (both were past bugs, see Gotchas).
- Motion: `--duration-instant/fast/normal/slow` (0/80/120/150ms) + `--ease-out`/`--ease-snap` in `index.css` `@theme` are the single source of truth — hover/active feedback uses `duration-fast`, mount/dismiss animations (panel switch, toasts, command palette) use `duration-normal`. **Never animate a property that changes content-area geometry** (sidebar width, panel-resize) — the child webview's HWND can't animate with the CSS, so the chrome slides while the page snaps; this is why the sidebar-width transition was removed. `prefers-reduced-motion` already suppresses all of it.
- Accessibility: ARIA roles, tabIndex + keyboard handlers throughout, 500ms tooltip delay (WCAG).

### Performance & Memory
- React.lazy for all panels; manualChunks in vite; init scripts split (CORE/HEADER/NETWORK).
- WebView2 `SetMemoryUsageTargetLevel`: background tabs → LOW, active → NORMAL. (No minimize handler calls this — grepped `lib.rs`, nothing found; a prior claim that minimize sets all tabs LOW was stale and removed.)
- `scripts/measure.ps1` sums the working set of XEVO plus its whole `msedgewebview2` child tree — measuring `xevo.exe` alone understates RAM badly, since renderers live in the children. Takes `-Name chrome` to compare against another browser.
- A `TrySuspend`/`Resume` freeze tier was attempted and **reverted** — it crashed the app (exit `0xcfffffff`) on tab create/close churn. Root cause not yet found; do not retry without a way to reproduce and step through it.
- Network capture is genuinely gated on the Network panel being mounted now — `NETWORK_CAPTURE_ACTIVE` (an `AtomicI32` ref-count in `browser.rs`) is checked inside both the `WebResourceRequested` and `WebResourceResponseReceived` COM handlers, which stay registered per tab always; the panel's mount/unmount effect flips it via `browser_set_network_capture`. Previously this line was aspirational — the handlers ran their full cost (header iteration, a full `GetContent` body read, two IPC emits per request) on every request of every tab regardless of whether the panel was ever opened. Header-rule injection is a separate always-on feature in the same request handler and is NOT gated by this. 500ms batch flush unchanged. **Gotcha:** was an `AtomicBool` set via `.store()` — since the panel remounts on every tab switch (`key={activeTabId}`), unmount's `invoke(false)` and mount's `invoke(true)` are two independent async IPC calls with no ordering guarantee, so `false` could resolve after `true` and leave capture stuck off (symptom: panel shows 0-2 requests then goes silent until app restart). Fixed by switching to a ref-count (`fetch_add`/`fetch_sub`) — increment/decrement commute regardless of arrival order.
- Bounds-sync perf pass: `browser_set_bounds` and `create_viewport` collapsed `set_position`+`set_size` (two separate wry event-loop messages, so the webview visibly moved then resized a frame apart) into one `set_bounds` call. Sidebar's `width` CSS transition removed — the webview has no matching animation, so it used to slide while the page snapped. Sidebar drag threshold 5px→1px, ResizeObserver switched from a debounce (which never fires mid-drag) to a real rAF throttle. Tab webviews now set `background_color` matching the dark chrome, so a resize's newly-exposed strip no longer flashes WebView2's default before repaint.

### Persistence
- Session restore: tabs persisted (`xevo-session` key) with only durable fields (`id,url,title,favicon,isPinned,workspaceId,createdAt,zoom`); every transient field excluded. Tabs restore in the discarded state and lazily recreate on activation.
- Downloads, bookmarks, API collections/history, header rules, history: each in its own persisted Zustand store, workspace- or tab-scoped as appropriate.

## KNOWN ISSUES
- Main window is opaque (no `transparent` in tauri.conf.json); tab webview is transparent so content-area background shows through unpainted pixels, may white-flash on first creation.
- JSON viewer depth limit 8, max 500 items/array.
- Brief dark flash on first paint before React sets `data-theme`.
- Settings panel uses absolute positioning, overlays right edge without reflowing the webview.
- Command palette / ShortcutHelp are mounted outside the content wrapper, fixed over the full window.
- In-page SPA link clicks can pollute history (multiple `onUrlChanged` fires).
- Global shortcuts fire even when XEVO isn't focused (OS-level hotkeys — intended).
- Header injection doesn't cover WebSockets (WebView2 never fires `WebResourceRequested` for the handshake — not fixable app-side).
- `Tab.isMuted` and `AppSettings.clearOnClose` are ghost settings (typed/persisted, read by nothing) — left for a human decision.
- App refuses to start on non-Windows; README still claims cross-platform.

## GOTCHAS (non-obvious, worth remembering)
- Tailwind v4 utilities live in `@layer utilities`; any unlayered CSS rule beats them regardless of specificity. Global resets/generic rules must go in `@layer base` or every spacing utility silently no-ops.
- Never put a `*/`-shaped substring inside a CSS comment — it prematurely closes the comment and can silently break the build (Vite keeps serving the last good CSS, so it's easy to miss).
- `--color-base` claims the `.text-base` Tailwind utility name, so the 0.875rem type-scale step is named `--text-md` instead — there is deliberately no `--text-base`.
- A Tauri GitHub issue closed "not planned" (`Window::add_child` limitations, #10079) turned out to be about a *different* API (`.parent()`) — worth re-verifying old architectural pivots against the current Tauri/wry version before assuming a limitation is permanent.
- WebView2 cookies must be deleted/edited by exact domain+path match; a host-only write never removes a `Domain=.example.com` cookie.

## NOT DONE YET
- Port scanner: HTTP title in sidebar tooltip
- Workspace drag-to-reorder in sidebar
- Notes panel: drag-to-reorder in sidebar list
- API tester: response body type detection (HTML/image/JSON preview), environments, request share
- Find in page: case-sensitive / whole-word toggles
- Bookmarks: drag-to-reorder (folders exist, assignment is via a select)
- Downloads: live progress percentage
- Status bar: hovered URL detection (needs injected script)
- GitHub push + README + v1.0 tag
- Runtime integration tests (require `pnpm tauri dev` on hardware)

## SPEC COVERAGE
Full item-by-item audit against the founding spec (`DEVBROWSER_PROJECT_GUIDE.md`) lives in `SPEC_COMPLIANCE.md`. `CORE_GAPS.md` turns that into the ordered closure plan — one item per session, start at the first unchecked item.

## REPOSITORY STRUCTURE

```text
Xevo/
├─ .vscode/
│  └─ extensions.json
├─ AGENTS.md
├─ ARCHITECTURE.md
├─ PROJECT_STATE.md
├─ README.md
├─ TASKS.md
├─ XEVO_FRONTEND.md
├─ ENHANCED_BROWSER.md
├─ MAJOR_FIXES.md
├─ bug_report.md
├─ feature_bug_fixes.md
├─ quickfixes.md
├─ web_url_issue.md
├─ networklog_issues.md
├─ CORE_GAPS.md
├─ SPEC_COMPLIANCE.md
├─ components.json
├─ index.html
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ tsconfig.json
├─ tsconfig.node.json
├─ vite.config.ts
├─ public/
│  ├─ tauri.svg
│  └─ vite.svg
├─ src/
│  ├─ App.tsx
│  ├─ main.tsx
│  ├─ index.css
│  ├─ vite-env.d.ts
│  ├─ components/
│  │  ├─ browser/
│  │  │  ├─ BrowserChrome.tsx
│  │  │  ├─ ContentArea.tsx
│  │  │  ├─ FindBar.tsx
│  │  │  ├─ LoadingBar.tsx
│  │  │  ├─ BookmarkBar.tsx
│  │  │  ├─ StatusBar.tsx
│  │  │  ├─ TabBar.tsx
│  │  │  ├─ TabContextMenu.tsx
│  │  │  ├─ TabItem.tsx
│  │  │  ├─ Toolbar.tsx
│  │  │  └─ WindowControls.tsx
│  │  ├─ layout/
│  │  │  └─ RootLayout.tsx
│  │  ├─ overlay/
│  │  │  └─ OverlayPanel.tsx
│  │  ├─ panels/
│  │  │  ├─ ApiTester.tsx
│  │  │  ├─ Base64Tool.tsx
│  │  │  ├─ HeadersPanel.tsx
│  │  │  ├─ HomePage.tsx
│  │  │  ├─ InspectorPanel.tsx
│  │  │  ├─ JwtDecoder.tsx
│  │  │  ├─ MetaValidator.ts
│  │  │  ├─ NetworkPanel.tsx
│  │  │  ├─ NotesNotepad.tsx
│  │  │  ├─ SettingsPanel.tsx
│  │  │  ├─ SocialPreview.tsx
│  │  │  ├─ UserAgentPanel.tsx
│  │  │  ├─ UserAgentPresets.ts
│  │  │  ├─ ViewportPanel.tsx
│  │  │  └─ ViewportPresets.ts
│  │  ├─ sidebar/
│  │  │  ├─ ApiTesterPanel.tsx
│  │  │  ├─ BookmarksPanel.tsx
│  │  │  ├─ DownloadsPanel.tsx
│  │  │  ├─ HistoryPanel.tsx
│  │  │  ├─ NotesSidebarPanel.tsx
│  │  │  ├─ Sidebar.tsx
│  │  │  ├─ WorkspaceContextMenu.tsx
│  │  │  └─ WorkspaceSwitcher.tsx
│  │  ├─ ui/
│  │  │  ├─ badge.tsx
│  │  │  ├─ button.tsx
│  │  │  ├─ input.tsx
│  │  │  ├─ separator.tsx
│  │  │  ├─ tooltip.tsx
│  │  │  └─ VirtualList.tsx
│  │  └─ ErrorBoundary.tsx
│  ├─ lib/
│  │  ├─ bookmarkAction.ts
│  │  ├─ networkCopy.ts
│  │  ├─ screenshot.ts
│  │  ├─ url.ts
│  │  ├─ utils.ts
│  │  └─ workspaceTabs.ts
│  ├─ stores/
│  │  ├─ apiCollections.ts
│  │  ├─ apiHistory.ts
│  │  ├─ bookmarks.ts
│  │  ├─ downloads.ts
│  │  ├─ headers.ts
│  │  ├─ history.ts
│  │  ├─ inspector.ts
│  │  ├─ network.ts
│  │  ├─ notes.ts
│  │  ├─ servers.ts
│  │  ├─ settings.ts
│  │  ├─ tabs.ts
│  │  ├─ ui.ts
│  │  └─ workspaces.ts
│  ├─ types/
│  │  └─ index.ts
│  ├─ hooks/
│  │  ├─ useKeyboardShortcuts.ts
│  │  ├─ usePortScanner.ts
│  │  ├─ useViewportSync.ts
│  │  └─ useWebviewBridge.ts
│  └─ services/
│     └─ browser.ts
└─ src-tauri/
   ├─ .gitignore
   ├─ Cargo.toml
   ├─ Cargo.lock
   ├─ build.rs
   ├─ tauri.conf.json
   ├─ capabilities/
   │  └─ default.json
   ├─ icons/
   └─ src/
      ├─ commands/
      │  ├─ browser.rs
      │  ├─ mod.rs
      │  └─ ports.rs
      ├─ lib.rs
      └─ main.rs
```
