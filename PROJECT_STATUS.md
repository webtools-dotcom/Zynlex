# XEVO — Project Status Audit

Audit date: 2026-07-22. Read-only review of the full repository. No code was changed.

---

## 1. Architecture in plain language

XEVO is a **Windows-only developer browser** built as a Tauri 2 desktop app. React renders the
chrome (tab bar, toolbar, sidebar, panels); the actual web pages render in **native WebView2
windows that are not part of the React tree at all**. That single fact drives most of the
codebase's complexity and most of its bugs.

**Stack (verified from config, not assumed)**
- Shell: Tauri 2 (`src-tauri/`), Rust 2021, `panic = "abort"`, LTO release profile.
- Windows-only by construction: `webview2-com`, `windows-core`, raw GDI FFI for screenshots,
  `#[cfg(target_os = "windows")]` around the real implementations. Non-Windows paths compile but
  return errors or no-op.
- Frontend: React 19 + TypeScript 5.8 + Vite 7, Tailwind v4 (`@tailwindcss/vite`), Radix + shadcn
  conventions, `lucide-react` icons, `zustand` (+ `immer`, + `persist`) for state.
- Package manager: pnpm (`pnpm-lock.yaml`, `pnpm-workspace.yaml`).
- No test runner, no linter config, no CI.

**Entry points**
- `src-tauri/src/main.rs` → `xevo_lib::run()` in `src-tauri/src/lib.rs`.
- `src/main.tsx` → `src/App.tsx` → `src/components/layout/RootLayout.tsx`.

**How a page actually gets on screen**
1. Every tab is a separate `WebviewWindow` with label `browser-{tabId}`, created lazily on first
   navigation (`browser_create_tab`), parented to the main window.
2. React never renders page content. `ContentArea` is an empty positioned `<div>`; the hook
   `useWebviewBridge` measures that div's `DOMRect`, converts it to screen coordinates, applies a
   hand-calibrated per-edge fudge factor (`WEBVIEW_EDGE_INSET` in `useWebviewBridge.ts:79`), and
   pushes those bounds to Rust so the native window sits exactly over the hole.
3. Tab switching = `browser_hide_tab` + `browser_show_tab`. No reload, page state survives.
4. Rust holds a `HashMap<label, WebviewWindow>` in `BrowserState.webviews` as a strong-reference
   workaround for a Tauri bug where handles drop and the OS window disappears.

**Frontend ↔ backend contract**
- One chokepoint: `src/services/browser.ts` wraps every `invoke()` and every `listen()`. Nothing
  else in the frontend talks to Tauri directly except a few `getCurrentWindow()` calls.
- Rust → frontend is event-based: `browser://url-changed`, `browser://loading`,
  `browser://tab-info`, `browser://network-entry`, `xevo://inspector-data`, `xevo://shortcut`,
  `xevo://minimize-state`, `xevo://force-sync`, `viewport://*`.
- Page → Rust is via injected JS calling `window.__TAURI_INTERNALS__.invoke(...)`. Three init
  scripts are injected into every tab (`CORE_SCRIPT`, `CHROME_FEATURES_SCRIPT`,
  `JSON_VIEWER_SCRIPT`, all string constants in `commands/browser.rs`).

**State management**
- 11 zustand stores in `src/stores/`. Persisted to localStorage: `workspaces`, `settings`,
  `bookmarks`, `history`, `notes`, `servers`, `headers`. Session-only: `tabs`, `network`,
  `inspector`, `apiHistory`.
- Deliberate design choice: tabs are **not** persisted, and `workspaces` clears all tab references
  on rehydrate (`onRehydrateStorage` → `resetAllWorkspaceTabs`). Every launch starts with no tabs.

**Native integrations (all Windows COM/Win32)**
- Network capture: `AddWebResourceRequestedFilter("*")` + `WebResourceResponseReceived` +
  `GetContent` for bodies.
- Header injection: `SetHeader` on the request inside the `WebResourceRequested` handler.
- Memory: `ICoreWebView2_19::SetMemoryUsageTargetLevel` for background tabs.
- Screenshots: DevTools Protocol `Page.captureScreenshot`, falling back to GDI `PrintWindow`.
- Port scanning: pure `tokio` TCP + a hand-rolled HTTP/1.0 GET (no HTTP client dependency).

**Build / run**
- Dev: `pnpm tauri dev` (Vite on :1420, `beforeDevCommand`).
- Build: `pnpm tauri build` → `tsc && vite build` → bundle.
- Typecheck: `pnpm typecheck` — **currently passes clean**.

---

## 2. Feature inventory

### Working
| Feature | Where | Notes |
|---|---|---|
| Tabs (create/close/switch/pin/duplicate/reorder) | `stores/tabs.ts`, `browser/TabBar.tsx` | Persistent webviews, state survives switching |
| Workspaces | `stores/workspaces.ts` | Tab sets, colors, versioned persistence with a real `migrate` |
| Address bar + URL resolution | `resolve_url()` in `browser.rs:540` | localhost / IP / domain / search fallback |
| Back / forward / reload / stop | `browser.rs:841-878` | Implemented via `eval("history.back()")` etc. |
| Find in page | `CHROME_FEATURES_SCRIPT`, `FindBar.tsx` | JS `<mark>` highlighting; Tauri has no native find |
| Bookmarks | `stores/bookmarks.ts`, `lib/bookmarkAction.ts` | Ctrl+D from both chrome and page focus |
| History | `stores/history.ts` | 100-entry FIFO, workspace-scoped |
| Live server scanner | `commands/ports.rs`, `usePortScanner.ts` | Concurrent scan of 24 dev ports + custom |
| Notes | `stores/notes.ts`, `NotesNotepad.tsx` | Rich-text, persisted |
| JWT decoder / Base64 tool | `JwtDecoder.tsx`, `Base64Tool.tsx` | Pure client-side, self-contained |
| Command palette / shortcut help | `CommandPalette.tsx`, `ShortcutHelp.tsx` | Ctrl+K / Ctrl+? |
| JSON viewer | `JSON_VIEWER_SCRIPT` | Auto-renders JSON responses collapsibly |
| Header injection | `browser.rs:1223-1260`, `HeadersPanel.tsx` | Verified working; glob matcher has unit tests |
| Screenshots | `browser_screenshot` | CDP path works; GDI fallback captures chrome only |
| Tab discard / memory target | `useWebviewBridge.ts:593-738` | 10-min idle discard, soft cap of 10 webviews |

### Partial
| Feature | What works | What doesn't |
|---|---|---|
| **API Tester** | UI, cURL import, history, response viewer | Uses the main window's `fetch()`. The CSP in `tauri.conf.json` is `connect-src ipc: tauri: http://localhost:*` — **any request to a non-localhost or https origin is blocked**, despite the placeholder saying `https://api.example.com/endpoint`. Also subject to CORS. Needs a Rust-side HTTP command to be real. |
| **Network panel** | Captures every request/response with headers, timing, body, curl/fetch export | Request headers are never captured (only response headers), so exported curl replays the *response* headers. Bodies truncated at 64 KB. WebSockets invisible (WebView2 limitation). Entries for a closed tab are never freed. |
| **Multi-viewport mode** | Creates N native webviews sized to device presets, syncs scroll/click/input | Presets carry `userAgent`, `deviceScaleFactor`, `mobile`, `touch` — **none are applied**. `create_viewport` (`browser.rs:1679`) sets only position/size. It is a resize preview, not device emulation. The metrics probe exists to warn the user about exactly this mismatch. |
| **User-agent override** | Persists, applied to newly built webviews | Changing it tears down and recreates every webview (`recreateForUserAgent`); background tabs are discarded as a side effect. |
| **Port scanner protocol detection** | TCP liveness + HTTP title | `scan_single_host` can only ever return `"http"` or `"tcp"` — it never returns `"https"`. An HTTPS dev server (`vite --https`) fails the plaintext GET, is labeled `tcp`, and the sidebar then opens it as `http://` — a broken link. |
| **Theme sync to pages** | Sets `color-scheme` on all webviews | Only affects pages that respect `prefers-color-scheme` |

### Broken
| Feature | Status |
|---|---|
| **Inspector panel** (meta / cookies / localStorage / sessionStorage) | **Broken end to end.** See BUG-1. Every load ends in "Failed to parse inspector data". |
| GDI screenshot fallback | Returns a black rectangle where the page is (DirectComposition can't be `PrintWindow`ed). Only reachable when CDP fails, but then it silently produces a useless image. |

### Dead / unused code
- `src-tauri/src/commands/headers.rs` is **deleted in the working tree but still tracked in git**
  (`git status` shows ` D`). Same for `networklog_issues.md`. Uncommitted deletions.
- `browser_find_next`'s `forward` argument reaches `__xevoFindNext`, but `__xevoFind`'s `forward`
  parameter is accepted and never used (`CHROME_FEATURES_SCRIPT`).
- `stores/ui.ts` has both `settingsOpen` and `settingsPanelOpen`; only the latter is ever read.
- `stores/inspector.ts` exposes `setLastTabId` / `lastTabId` — never called.
- `types/index.ts` `ScreenshotResult.bytes` round-trips the whole PNG through IPC as a JSON number
  array even though Rust already wrote the file to disk; only `path` is needed for the file, and
  `bytes` is used solely for the clipboard copy.
- `vite-review.json` is a stale tool-output artifact committed to the repo.

---

## 3. Root-cause bug list

Grouped by cause. Ordered by severity, then by what unblocks what.

### BUG-1 — Inspector: object parsed as if it were a string  🔴 blocker
**Root cause (one line):** `src/hooks/useWebviewBridge.ts:450` does `JSON.parse(event.data)`, but
Rust emits `data` as a `serde_json::Value` **object**, not a string.

The trail: `TASKS.md` records a fix that removed a double-`JSON.stringify` and changed the Rust
command signature from `data: String` to `data: serde_json::Value` (`browser.rs:1592`). The
matching frontend change was never made, and `services/browser.ts:236` still types the field as
`data: string`, so TypeScript never caught it. `JSON.parse(someObject)` stringifies to
`"[object Object]"` and throws, so the catch fires and the panel shows
`"Failed to parse inspector data"` for **all four** sub-tabs, every time.

**Fix:** delete the `JSON.parse`, use `event.data` directly, and change the type in
`services/browser.ts` from `data: string` to a discriminated payload type. One-line behavior
change; the type is the part worth doing carefully.

### BUG-2 — API Tester can only ever reach localhost  🔴
**Root cause:** requests are issued with the main window's `fetch()`
(`ApiTester.tsx:284`), which runs under the app CSP `connect-src ipc: tauri: http://localhost:*`
in `src-tauri/tauri.conf.json`. Everything else is blocked before it leaves the process, and any
cross-origin call is additionally subject to CORS.

Two candidate fixes, pick one deliberately:
- (a) Add a Rust `http_request` command (reqwest or hyper) and route the tester through it. Real
  fix: no CSP, no CORS, request headers become inspectable. Adds a dependency.
- (b) Widen the CSP. Cheap, but it re-opens the app's own network surface and CORS still breaks
  most real APIs. Not recommended.

### BUG-3 — Double port scanning  🟠
**Root cause:** `usePortScanner()` is mounted twice — once via `PortScannerMount` in
`RootLayout.tsx:24`, and again inside `LiveServersPanel` in `Sidebar.tsx` (which calls the hook
just to get its `scan` function). Each instance runs its own mount scan and its own interval, and
the `isScanningRef` guard is per-instance, so the two overlap. Result: every port is scanned twice
per interval, and `isScanning` flickers.

**Fix:** the hook should own a module-level singleton guard, or `LiveServersPanel` should read a
`scan` function exposed from the store rather than mounting a second copy of the hook. The latter
is the smaller change.

### BUG-4 — HTTPS dev servers are mislabeled and open as `http://`  🟠
**Root cause:** `scan_single_host` (`ports.rs:66`) speaks only plaintext HTTP. TLS servers accept
the TCP connection, reject the plaintext GET, and fall into the `_ =>` arm which hardcodes
`protocol: "tcp"`. `stores/servers.ts` then normalizes anything that isn't literally `"https"` to
`"http"`, and `LiveServersPanel.openServer` builds `http://localhost:{port}`.

Note the same root cause makes the `"https"` branches in `usePortScanner.ts` and `servers.ts`
permanently dead code.

**Fix:** on plaintext failure, attempt a TLS handshake (or at minimum detect the TLS record header
`0x16 0x03`) and set `protocol: "https"`.

### BUG-5 — Network capture leaks memory (three related leaks)  🟠
Shared root cause: **capture has no lifecycle tied to the tab.**
1. `NETWORK_REQUEST_META` (`browser.rs:15`) entries are only removed when a response arrives.
   Cancelled, failed, and aborted requests leak an entry forever. The comment at line 1281
   ("entries removed on response — no cap needed") states the assumption that fails here.
2. The meta key is `"{tabId}:{uri}"`, so two concurrent requests to the same URL collide — the
   second overwrites the first's start time, corrupting the reported duration.
3. `useNetworkStore.clearTab` exists but is only wired to the panel's manual "clear" button. Tab
   close never calls it, so up to 500 entries × up to 64 KB of body per closed tab stay resident
   for the whole session.

**Fix:** clear both the Rust meta map and the store's per-tab entries in the tab-close path
(`browser_close_tab` and the discard/cap paths in `useWebviewBridge`), and key the meta map by
request identity rather than URL.

### BUG-6 — Header rules default to `*`, which sends secrets to every origin  🟠 security
**Root cause:** `AddRuleForm` in `HeadersPanel.tsx:56` initializes `pattern` to `"*"`, and
`url_matches` correctly treats `*` as "match everything". A rule created with the default — the
obvious use case being `Authorization: Bearer …` — is therefore attached to **every request the
tab makes**, including third-party scripts, analytics beacons, and CDN fetches. The token leaves
the machine to hosts the user never intended.

The matcher itself is correct and tested (`browser.rs:2430`); the problem is the default value and
the absence of any warning in the UI.

**Fix:** default the pattern to the active tab's origin, and show an explicit warning badge on any
enabled rule whose pattern is `*` or empty.

### BUG-7 — Webview creation race can leave a permanently blank tab  🟡
**Root cause:** `browser_create_tab` (`browser.rs:667`) destroys any stale handle and any orphan
in Tauri's registry, then immediately re-checks `app.get_webview_window(&label).is_some()` and
**returns `Ok(())` if it's still there**. On Windows, `destroy()` is asynchronous — the entry can
still be present microseconds later. The command then reports success without creating anything,
while the frontend has already added the tab to `createdTabsRef` (it reserves the slot *before*
awaiting, `useWebviewBridge.ts:292`). The tab is now permanently blank and unrecoverable without
a close/reopen.

**Fix:** the post-destroy existence check should not be a success path. Either wait for the
destroy to settle, or return a distinguishable error so the frontend can release the reserved slot.

### BUG-8 — Debug instrumentation shipping in release  🟡
**Root cause:** two independent sets of always-on logging.
- 48 `eprintln!` calls in `src-tauri/src/` are unconditional; only a handful are wrapped in
  `#[cfg(debug_assertions)]`. In release, `windows_subsystem = "windows"` means there is no
  console, so these are pure overhead on hot paths (`browser_set_bounds` logs on every bounds
  sync, i.e. on every window move frame).
- 10 `console.log` calls in `src/`, mostly `[XEVO-BOUNDS]` traces in `useWebviewBridge.ts`,
  several of which build object literals before logging — they run even when nothing reads them.

**Fix:** gate the Rust ones behind `#[cfg(debug_assertions)]` (the pattern already exists in the
file), and drop or `import.meta.env.DEV`-gate the JS ones.

### BUG-9 — Hand-calibrated pixel offsets  🟡 fragility, not a defect
`WEBVIEW_EDGE_INSET = { top: 1.5, right: 7.5, bottom: 4, left: -5.5 }`
(`useWebviewBridge.ts:79`) compensates for an upstream Tauri/WebView2 positioning drift. The
comment is honest about it. It is almost certainly DPI-dependent and will misalign on a non-100%
scaling display. Worth an explicit test on a 150% display before calling the layout done — not
worth "fixing" blind.

### Cross-cutting quality observations
- **Error handling is mostly `.catch(() => {})`.** Roughly 40 IPC call sites swallow errors
  silently. When a native call fails, the UI shows nothing and the user gets no signal. The
  `pushToast` mechanism already exists and is used in exactly one place (screenshot failure).
- **The service layer's types lie.** BUG-1 is one instance; `InspectorDataEvent.data: string` and
  `ScreenshotResult.bytes: number[]` are hand-written and unverified against the Rust structs.
  Nothing regenerates or checks them.
- **Copy-paste patterns.** The bounds-computing block
  (`getBoundingClientRect` → overlay height → `computeWebviewBounds`) is repeated verbatim six
  times inside `useWebviewBridge.ts` alone. `create_viewport` / `resize_viewport` /
  `show_viewport` / `hide_viewport` are four near-identical Rust commands that could be two.
- **`useWebviewBridge.ts` is 1000 lines with 14 `useEffect`s.** It is the single highest-risk file
  in the repo and the one where the bounds/minimize/restore bug history lives.
- **No tests at all** except one Rust unit-test module (`url_matches`, `browser.rs:2430`) — which,
  notably, is attached to the one feature that got debugged into a working state.

---

## 4. Remediation roadmap

Small reviewable chunks, in dependency order. Each is independently shippable.

**Phase A — make broken things work (highest value per line)**
1. **Fix the Inspector** (BUG-1). Drop the `JSON.parse`, type the payload properly. ~5 lines.
   Unblocks any further inspector work; four sub-tabs go from broken to working.
2. **Kill the duplicate port scan** (BUG-3). Single-owner the hook. ~10 lines.
3. **Detect HTTPS dev servers** (BUG-4). TLS probe or record-header sniff in `ports.rs`.
   Removes the dead `"https"` branches downstream.

**Phase B — safety and correctness**
4. **Header-rule default + `*` warning** (BUG-6). Security-relevant, purely frontend.
5. **Network capture lifecycle** (BUG-5). Clear meta map and store entries on tab close;
   re-key the meta map. Touches both sides.
6. **Webview creation race** (BUG-7). Make the post-destroy path non-silent. Rust + the frontend's
   slot-reservation logic.

**Phase C — decide, then build**
7. **API Tester transport** (BUG-2). Requires a product decision first (Rust HTTP command vs.
   accepting localhost-only). If Rust: new command + swap `fetch` for `invoke`, and the request
   headers become available to the Network panel as a bonus.
8. **Viewport device emulation.** Apply `userAgent` in `create_viewport`; wire
   `deviceScaleFactor` / `touch` via CDP `Emulation.setDeviceMetricsOverride`. This is the largest
   single gap between what the UI promises and what it does — scope it deliberately or relabel the
   feature as "responsive resize".

**Phase D — cleanup (do last; they conflict with everything above)**
9. Strip debug logging (BUG-8).
10. Commit or revert the pending deletions (`headers.rs`, `networklog_issues.md`), and remove
    `vite-review.json` and the other dead code listed in §2.
11. Extract the repeated bounds-computation block in `useWebviewBridge.ts` into one helper.
12. Replace blanket `.catch(() => {})` with `pushToast` on the paths where the user should know.
13. Verify `WEBVIEW_EDGE_INSET` on a 150% DPI display (BUG-9).

---

## 5. Open-source readiness checklist

### Blockers
- [ ] **README is still the Tauri template.** It says "Tauri + React + Typescript / This template
      should help get you started" and nothing about XEVO. Needs: what it is, Windows-only
      requirement stated up front, screenshots, install/build steps, feature list, known
      limitations (no WebSocket capture, no device emulation, localhost-only API tester).
- [ ] **No LICENSE file.** Without one the repo is "all rights reserved" and legally unusable by
      anyone who clones it. Pick one (MIT and Apache-2.0 are the conventional choices here).
- [ ] **No CONTRIBUTING.md.** Should cover: pnpm, Rust toolchain, WebView2 runtime requirement,
      `pnpm tauri dev`, `pnpm typecheck`, `cargo test` for the Rust unit tests, and that the app
      cannot be developed or run on macOS/Linux in its current state.
- [ ] `Cargo.toml` still has template metadata: `description = "A Tauri App"`, `authors = ["you"]`.
      No `license` or `repository` field.

### Repo hygiene
- [ ] **Internal working docs are committed** and read as private notes, not project docs:
      `AGENTS.md` (18 KB), `TASKS.md` (12 KB), `PROJECT_STATE.md` (17 KB),
      `DEVBROWSER_PROJECT_GUIDE.md` (45 KB), `XEVO_FRONTEND.md` (29 KB), `repo-structure.md`,
      `header_issue-report.md`, `vite-review.json`, and `ARCHITECTURE.md` (2 bytes — empty).
      Decide per file: move to `docs/`, rewrite for a public audience, or delete. They contain no
      secrets, but they are session logs written for an AI agent and set an odd tone for a
      public repo.
- [ ] `ai_integration.md` (61 KB) is untracked in the working tree — decide before it gets
      committed by accident.
- [ ] `.agents/` is untracked **and not in `.gitignore`** — one `git add -A` away from being
      committed. Add it to `.gitignore`.
- [ ] Uncommitted deletions of `headers.rs` and `networklog_issues.md` are still staged as tracked
      files. Commit the removal.
- [ ] `public/tauri.svg` and `public/vite.svg` are template leftovers.

### `.gitignore` correctness — mostly good
Verified covering: `node_modules`, `dist`, `src-tauri/target/`, `.env` and `.env.*`, `*.pem`,
`.opencode/`, `graphify-out/`, `.playwright-mcp/`, `.vscode/*` (with an `extensions.json`
exception). Confirmed by `git ls-files`: 123 tracked files, no build artifacts, no `dist`,
no `target`. Only gap is `.agents/` above.

### Sensitive data — clean, with one local-only exception
- ✅ **No secrets in any tracked file.** Grepped tracked content for key/secret/token/password
  patterns and AWS/OpenAI key shapes: only false positives (COM event tokens, the JWT decoder's
  `token` state variable, a CSS comment).
- ✅ **No personal filesystem paths or personal information** in tracked files.
- ⚠️ **`.env` exists locally and holds a real API key** (`OPENAI_API_KEY` for an unrelated
  "graphify" tool). It is correctly gitignored and `git log --all -- .env` confirms it has
  **never** been committed — history is clean. Still: it is unused by this application, so delete
  it from the working tree before going public rather than relying on the ignore rule.
- ✅ Git history contains no `.env` and no removed-secret commits.

### Nice to have before announcing
- [ ] A CI workflow that at minimum runs `pnpm typecheck` and `cargo test` — the repo has zero
      automation today.
- [ ] A `SECURITY.md`, given the app injects arbitrary headers and captures response bodies.
- [ ] Explicit note in the README that header-injection rules with a `*` pattern transmit their
      value to every origin the page contacts (see BUG-6) — even after the default is fixed.
