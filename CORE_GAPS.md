# XEVO — CORE Gap Closure Plan

**Source:** `SPEC_COMPLIANCE.md` (audit of v1.38.0 against `DEVBROWSER_PROJECT_GUIDE.md`)
**Purpose:** ordered, self-contained implementation plan. Hand this file to a fresh session and
start at the first unchecked item.
**Rule:** one item per session. Each is a complete, shippable unit. Do not batch them.

---

## How to use this file in a new session

1. Read `PROJECT_STATE.md`, then `ARCHITECTURE.md`, then `TASKS.md` (per `CLAUDE.md`).
2. Read **only this file's section for the item you are doing** — not the whole file.
3. Read only the source files that section names.
4. When done: update `PROJECT_STATE.md`, mark the item `[x]` here, deliver the §10 report.

**Do not** add these items to `TASKS.md` — that file is human/architect-owned. This file is the
working list.

Every section below states: **Why** · **Files** · **Approach** · **Risk** · **Done when**.
Where an API is named, it has been verified against the installed crate — versions are pinned in
the section. Anything unverified is marked **SPIKE FIRST**.

---

## Ordering rationale

Ordered by *launch impact per unit of risk*, not by spec order.

- **Phase 1 (1-3)** — the three gaps a first-time user hits before they finish evaluating the app. Ship these and XEVO reads as a real browser.
- **Phase 2 (4-6)** — the demo-critical gaps. §9.3 of the guide says the launch demo is localhost panel + workspaces + network log/API tester; these are the parts of that demo that are thin.
- **Phase 3 (7-9)** — completeness. Cheap, visible, low risk.
- **Phase 4 (10)** — the decision item. Not code.

Item 1 is deliberately first *and* hardest. It is the one people notice, and everything else is
easier to schedule around it than after it.

---

# PHASE 1 — Blocks "is this a real browser?"

## [x] 1. Session restore

**Why.** `stores/workspaces.ts:223-225` calls `resetAllWorkspaceTabs()` on rehydrate — comment
reads *"Clear all tab references on startup — start fresh every time"*. `stores/tabs.ts` has no
`persist` middleware; it was removed in Session 59 because persisting live tab state caused black
screens and stale-state bugs. Result: every launch opens empty. Spec §7.3 makes this `[CORE]`:
*"Reopen → exactly where you left off."* This is the single most visible miss in the product.

**Files.**
- `src/stores/tabs.ts` — tab state, no persist today
- `src/stores/workspaces.ts:161-168, 220-229` — `resetAllWorkspaceTabs` + the rehydrate hook that calls it
- `src/hooks/useWebviewBridge.ts:550-660` — discard/recreate machinery (`discardedAt`, pinned/active exemption, `maxConcurrentWebviews` cap)
- `src/components/browser/ContentArea.tsx:37` — renders `HomePage` when the tab has no URL

**Approach — restore tabs as *discarded*, not as live webviews.**

The v0.9 failure was persisting *live* tab state: on boot the app tried to reconstitute N
webviews at once and raced its own creation path. Do not re-add `persist` to the tabs store.
Instead:

1. **Persist a snapshot, not the store.** New `persist` entry (its own key, e.g. `xevo-session`)
   holding only what is needed to rebuild: per tab `{ id, url, title, favicon, isPinned,
   workspaceId }`, plus each workspace's `tabIds` order and `activeTabId`. Explicitly exclude
   `isLoading`, `discardedAt`, `lastActiveAt`, `historyBack/Forward`, `loadTime` — transient
   fields are exactly what poisoned the old attempt.
2. **On rehydrate, recreate tabs with `discardedAt: Date.now()`.** Every restored tab is born in
   the already-proven discarded state: it has a URL and a title, renders in the tab bar, and has
   no webview. `useWebviewBridge` already knows how to materialise a discarded tab on activation
   (it was built for the 10-minute inactivity discard). Zero webviews are created at boot.
3. **Activate exactly one tab** — the persisted `activeTabId` — and let the existing recreate
   path build its webview. That is one webview creation at startup, the same as today's
   "user clicks a link" path.
4. **Delete `resetAllWorkspaceTabs()`** and its call site once the above works. Keep a guard that
   drops any persisted `tabId` with no matching snapshot entry (defends against a partial write).
5. **Write timing:** persist on tab open/close/navigate/reorder and on workspace switch. Do not
   write on every keystroke or scroll.

**Explicitly out of scope** (spec lists them, they are a second session): scroll positions, form
state. `Tab.savedFormState` already exists and `browser_save_tab_state` / `browser_restore_tab_state`
(`browser.rs:2673, 2735`) already implement the save/restore for the discard path — reuse that
later, do not entangle it with this.

**Risk.** High — this is the code that produced the black-screen bug family (`TASKS.md`,
Sessions 23-27, 57-59). Mitigations: never more than one webview created at boot; discarded-tab
path is already exercised in normal use; the snapshot is a separate persist key, so a corrupt
session can be cleared without touching workspaces/settings.

**Done when.** Open 5 tabs across 2 workspaces, pin one, quit, relaunch: all 5 tabs present in
the right workspaces in the right order, pin preserved, the previously-active tab is active and
its page loads, the other 4 load on click with no black screen. Relaunch again immediately —
still correct (catches write-on-quit races).

---

## [x] 2. Zoom

**Why.** `[CORE]` in §7.1, entirely absent. `Tab.zoom` (`types/index.ts:18`) is set to `1` in
`stores/tabs.ts:22` and never read — a ghost field. Status bar is also specced to show zoom level.

**Files.**
- `src-tauri/src/commands/browser.rs` — add command near the other per-tab commands (`browser_reload` is at :824)
- `src-tauri/src/commands/browser.rs:510` `create_webview_for_tab` — builder chain
- `src-tauri/src/lib.rs` — register the new command
- `src/services/browser.ts` — typed invoke wrapper
- `src/hooks/useKeyboardShortcuts.ts` — Ctrl +/-/0 bindings
- `src/stores/tabs.ts` — a `setZoom` action, so `Tab.zoom` stops being a ghost
- `src/components/browser/StatusBar.tsx` — show level when ≠ 100%

**Approach (verified against `tauri-2.11.2`).**

1. Add `.zoom_hotkeys_enabled(true)` to the builder in `create_webview_for_tab`
   (`tauri-2.11.2/src/webview/mod.rs:1051`). On Windows this sets WebView2's
   `IsZoomControlEnabled` — Ctrl +/-/mousewheel then work **natively inside the page**, no JS,
   no IPC. That alone satisfies most of the spec bullet.
2. Add `browser_set_zoom(tab_id, factor)` calling `Webview::set_zoom(f64)`
   (`mod.rs:2098`) so the app can drive zoom explicitly and implement **reset (Ctrl+0)** and
   per-tab memory, which hotkeys alone don't give.
3. Bind Ctrl+`+` / Ctrl+`-` / Ctrl+`0` in `useKeyboardShortcuts.ts`, clamp ~0.25-5.0, write to
   `Tab.zoom`, re-apply on tab activation (that's the "per-tab zoom memory" bullet).
4. Status bar: render `${Math.round(zoom*100)}%` only when zoom ≠ 1.

**Risk.** Low. Note `zoom_hotkeys_enabled` is a *builder* attribute — it only affects webviews
created after the change, so restart the app when testing, don't just reload.

**Done when.** Ctrl +/- zooms the page, Ctrl+0 resets, the level shows in the status bar, and
switching away and back to a tab preserves its zoom.

---

## [x] 3. Downloads

**Why.** `[CORE]` §7.1, nothing exists — no handler, no store, no `PanelId` entry. A browser
that can't download a file reads as a prototype.

**Files.**
- `src-tauri/src/commands/browser.rs:510` `create_webview_for_tab` — attach the handler
- `src/stores/downloads.ts` — **new**
- `src/components/panels/DownloadsPanel.tsx` — **new**
- `src/types/index.ts:60-72` — add `"downloads"` to `PanelId`
- `src/components/sidebar/Sidebar.tsx` — panel entry
- `src/App.tsx` — the `React.lazy` panel registration (matches the existing 9-panel pattern)

**Approach (verified against `tauri-2.11.2`).**

1. `WebviewBuilder::on_download(|webview, event| -> bool)` — `mod.rs:604`. Events are
   `DownloadEvent::Requested { url, destination }` and
   `DownloadEvent::Finished { url, path, success }` (`mod.rs:75`). Returning `false` on
   `Requested` cancels the download.
2. On `Requested`: keep the default `destination` (the OS downloads folder) for v1 — do **not**
   build a save-as dialog yet. Emit `xevo://download-started` with url + destination + tabId.
3. On `Finished`: emit `xevo://download-finished` with path + success.
4. Store: `{ id, url, filename, path, status: "active"|"done"|"failed", startedAt }`. Persist
   the list (spec wants a clearable download history).
5. Panel: list, "Open file", "Show in folder", "Clear history". Open/reveal go through the
   existing `open_external_url` (`browser.rs:859`, uses `tauri-plugin-opener`) — check whether
   the plugin's reveal-in-directory API is enabled in `capabilities/default.json` before using
   it; if not, add the capability there, not a new plugin.

**Known limitation — state it in `PROJECT_STATE.md`, don't hide it.** Tauri's `DownloadEvent`
has no progress callback, so v1 shows *started → finished*, not a percentage. Live progress needs
WebView2 COM (`ICoreWebView2DownloadOperation`, `BytesReceivedChanged`) — same pattern as the
existing network-capture handler in `browser.rs:1145`, and a separate follow-up item.

**Risk.** Low-medium. `on_download` is a builder attribute → applies only to new webviews.

**Done when.** Clicking a download link on a real site produces a file on disk, an entry in the
panel that moves active → done, and "Show in folder" opens the right directory.

---

# PHASE 2 — Blocks the launch demo (§9.3)

## [x] 4. API tester request collections

**Why.** `[CORE]` §7.7 and §8-v0.4. Today there is only `stores/apiHistory.ts` — flat, capped at
50, **not persisted**, not workspace-scoped. "Save this request" is what makes the panel more
than a curl box, and the guide names the API tester as a launch-demo feature.

**Files.**
- `src/stores/apiCollections.ts` — **new**, follow the shape of `stores/headers.ts` (`rulesByWs` keyed by workspaceId — the established per-workspace store pattern)
- `src/stores/apiHistory.ts` — add `persist`, raise cap 50 → 100 (spec §7.7)
- `src/components/panels/ApiTester.tsx` — save/load UI; `RequestEditor` is at :499, `HistoryPanel` at :722
- `src/components/sidebar/ApiTesterPanel.tsx` — collection list in the sidebar

**Approach.** `SavedRequest = { id, name, method, url, headers, body, folderId | null }`;
`Folder = { id, name }`. Store is `Record<workspaceId, { folders, requests }>`, persisted.
UI: "Save" in the request editor (name prompt inline, reuse `ConfirmButton`'s in-place pattern —
`window.prompt` is as unreachable as `window.confirm` behind the child webviews, see
`PROJECT_STATE.md` v1.36.0), collection tree in the sidebar, click to load, rename/delete/duplicate.

**Do not** build environment variables / `{{VAR}}` templating — that's `[V2]`, and adding it here
is exactly the scope creep `CLAUDE.md` rule 3 forbids.

**Risk.** Low. Pure frontend + localStorage.

**Done when.** Save a request, switch workspace, switch back, relaunch the app — it's still
there and loads into the editor correctly. History survives a relaunch too.

---

## [x] 5. Network panel triage: pause, filters, initiator

**Why.** `[CORE]` §7.4. Capture is excellent (native COM, `browser.rs:1145`); triage is thin —
`NetworkPanel.tsx:229-241` has four preset chips (All/Errors/API/Slow) and Clear. Missing:
pause/resume, method filter, status-range filter, URL search, per-resource-type filter, the
initiator column, and the "preserve log across reloads" toggle. On a real page (the audit used
github.com, 167 requests) the panel is hard to use.

**Files.**
- `src/components/panels/NetworkPanel.tsx` — filter bar (`GRID_COLS` at :18 defines the shared header/row grid; adding a column means editing that one constant)
- `src/stores/network.ts` — `paused` flag, `preserveLog` flag
- `src/hooks/useWebviewBridge.ts` — the `onLoadingChanged` handler that clears entries on the `loading: true` edge; gate it on `preserveLog`
- `src-tauri/src/commands/browser.rs:1145` — **only** if initiator is added

**Approach, in dependency order.**

1. **Pause/resume** — `paused` in the store; the batch-flush drops incoming entries while paused. Pure frontend, no Rust.
2. **URL search box** — plain substring over the existing entries array. One input.
3. **Method + status-range filters** — small dropdowns beside the existing chips. Keep the chips; they are good defaults.
4. **Resource-type filter** — 17 types are already captured and classified in Rust; this is a select over existing data, no capture change.
5. **Preserve-log toggle** — inverts the v1.38 clear-on-reload behaviour when checked. Default off (matches devtools).
6. **Initiator** — the only one needing Rust. **SPIKE FIRST:** confirm whether
   `ICoreWebView2WebResourceRequest` exposes an initiator/referrer usable here. If it doesn't,
   fall back to the `Referer` request header, label the column "Referrer", and record the
   deviation in `PROJECT_STATE.md`. Do not fake it.

**Risk.** Low for 1-5, unknown for 6 — hence its position last and the spike gate.

**Done when.** On a 150+ request page: pause freezes the list while the page keeps loading,
resume resumes, each filter narrows correctly, filters compose, and the columns stay aligned at a
240px sidebar width (the v1.38 regression — header and rows share `GRID_COLS`; keep it that way).

---

## [x] 6. Bookmarks: bar, folders, import/export

**Why.** `[CORE]` §7.1 and §8-v0.5 called bookmarks a "full system". What shipped is a flat,
workspace-scoped list — no bar, no folders, no JSON import/export.

**Files.**
- `src/stores/bookmarks.ts` — add `folderId`, folder list, import/export
- `src/components/sidebar/BookmarksPanel.tsx` — folder tree
- `src/components/browser/BookmarkBar.tsx` — **new**
- `src/components/browser/BrowserChrome.tsx` — mount the bar under the toolbar
- `src/stores/ui.ts` — `bookmarkBarVisible` toggle

**Approach.** Add `folderId: string | null` to `Bookmark` with a persist `version` bump +
`migrate` (the store is already versioned — follow `stores/settings.ts:46-58` for the pattern;
existing bookmarks migrate to `folderId: null`). Bar renders the current workspace's root-level
bookmarks in a ~28px strip, toggleable, off by default. Import/export = `JSON.stringify` of the
workspace's bookmarks + folders, via the Tauri dialog/fs plugins — **check
`src-tauri/capabilities/default.json` first**; if the file-dialog capability isn't declared,
declare it rather than working around it.

**Critical layout note.** The bookmark bar changes the content-area height, which moves the child
webview. The `ResizeObserver` in `useWebviewBridge.ts` already re-syncs bounds on any content-area
layout change — verify the bar toggle actually triggers it, because a stale sync here means a
webview overlapping the bar.

**Risk.** Medium, entirely because of that layout note. The store work is trivial.

**Done when.** Create a folder, drag/assign a bookmark into it, toggle the bar (webview resizes
cleanly, no overlap, no black strip), export to JSON, wipe, re-import, everything returns.

---

# PHASE 3 — Completeness, low risk

## [x] 7. Vertical tab layout

**Why.** `[CORE]` §7.11 — and it's the Arc/Edge-style differentiator the spec called out.
`TabBarPosition = "top" | "left"` (`types/index.ts:59`) is persisted in settings and **never
read**. Currently a lie in the type system.

**Files.** `src/components/layout/RootLayout.tsx`, `src/components/browser/TabBar.tsx`,
`src/components/browser/TabItem.tsx`, `src/components/panels/SettingsPanel.tsx`

**Approach.** Read `settings.tabBarPosition` in `RootLayout`; when `"left"`, render `TabBar` as a
fixed-width (~200px) column between the sidebar and the content area, with `TabItem` in a
favicon + truncated-title row form. Reuse the existing drag-reorder logic — it's pointer-event
based (`TabBar.tsx:195`), so it needs the axis swapped, not rewriting. Add the toggle to
Settings.

**Critical.** Same as item 6: the content area's width changes, so the child webview bounds must
re-sync. Verify against the existing `ResizeObserver` path.

**Risk.** Medium-low. Layout only, but it touches the bounds sync that has historically been the
most fragile part of this app.

**Done when.** Switching layout in Settings moves the tabs to a left column, the webview fills the
remaining area exactly (no gap, no overlap), drag-reorder still works, and the choice survives a
relaunch.

---

## [x] 8. Missing keybindings + address-bar security indicator

**Why.** Four small `[CORE]` bullets, all cheap, all visible.

**Files.** `src/hooks/useKeyboardShortcuts.ts`, `src/components/ShortcutHelp.tsx`,
`src/components/browser/Toolbar.tsx`, `src-tauri/src/commands/browser.rs:824`

**Approach.**
1. **Ctrl+Shift+R hard reload** — needs a cache-bypassing reload. `browser_reload` currently calls the plain reload. **SPIKE FIRST:** check whether wry/Tauri exposes a reload-ignoring-cache; if not, do it via COM (`ICoreWebView2` has no direct bypass — the CDP route `Page.reload {ignoreCache:true}` is available through the same DevTools-protocol path already used by `browser_screenshot`, `browser.rs:2296`).
2. **Ctrl+H** — open the history panel. Two lines.
3. **Ctrl+Shift+1-9** — switch workspace. Mirror the existing Ctrl+1-9 tab handler (`useKeyboardShortcuts.ts:180`) against `workspaceOrder`.
4. **Security indicator** — lock icon in the address bar from `new URL(url).protocol`: https → lock, http → "Not secure", localhost http → neutral (dev servers are http and must not be scolded). Purely derived from the URL; no cert inspection (that's `[V2]`).
5. Add all new bindings to `ShortcutHelp.tsx` in the same commit — an undocumented shortcut doesn't exist.

**Risk.** Low, except the hard-reload spike.

**Done when.** All four work and appear in the Ctrl+? sheet.

---

## [x] 9. Command palette breadth

**Why.** `[CORE]` §7.10 promised fuzzy search across tabs, bookmarks, history, commands, saved
API requests, workspaces, and detected servers. `CommandPalette.tsx:24` types `Item` as
`"tab" | "command"` only. Bookmarks appear as an *open-the-panel* command, not as entries.

**Files.** `src/components/CommandPalette.tsx` only.

**Approach.** Widen the `Item` union to include `bookmark | history | workspace | server |
request`, and build each source from the store it already lives in (`stores/bookmarks.ts`,
`history.ts`, `workspaces.ts`, `servers.ts`, and the new `apiCollections.ts` from item 4 — so do
this **after** item 4). Group results by category with a header row. Add a small
recently-used list at the top backed by a capped array in `stores/ui.ts`.

**Risk.** Low — one file, read-only against existing stores.

**Done when.** Typing a bookmark title, a workspace name, or a port number in Ctrl+K finds it and
Enter does the right thing, with results visibly grouped.

---

# PHASE 4 — Decision, not code

## [~] 10. The six ghosts, and the Windows question — partially done, see PROJECT_STATE.md

### 10a. Kill or wire the ghosts

After items 1-9, three of the six are resolved (`zoom` → item 2, `tabBarPosition` → item 7, plus
session restore making tab state real). **Three remain, and each needs a decision, not a default:**

| Ghost | Where | Options |
|---|---|---|
| `Tab.isMuted` | `types/index.ts:14`, written `stores/tabs.ts:18` | Implement via WebView2 `IsMuted` (COM), or delete the field |
| `AppSettings.clearOnClose` | `types/index.ts:84` | Implement (clear history/cookies/cache on exit — the cookie manager at `browser.rs:1758` already has the delete primitives), or delete the setting |
| `AppSettings.homePage` | `types/index.ts:80` | Make `ContentArea.tsx:37` honour it, or delete it and hardcode the home page |
| `AppSettings.customPorts` | `types/index.ts:83` | Add the "add custom port" UI the spec asks for (§7.2), or delete |

Leaving them is the worst option: they violate Principle 8 of the guide, and the next audit has
to re-derive that they're dead. Deleting is a legitimate, cheap answer for any of them.

### 10b. Decide what XEVO claims about platforms

**This is the largest strategic finding in the audit and it is not a bug to fix — it's a claim to
choose.** Network capture, header injection, cookies, tab titles/favicons, in-page shortcuts,
memory targeting are all `#[cfg(windows)]` *inside* the `with_webview` closure
(`browser.rs:1149` and siblings), and `browser_eval_inspector` / `browser_screenshot`
(`browser.rs:1885, 2286`) return errors off Windows. A macOS or Linux build **compiles and
silently loses every dev feature.** There are no `#[cfg(not(windows))]` fallbacks.

Three honest paths:
1. **Ship Windows-only for v1.** Say so in the README, and add a build-time guard or a startup
   warning so a mac/Linux build cannot silently pretend to work. Cheapest, honest, defensible.
2. **Port the WebKit paths.** WKWebView and WebKitGTK have their own APIs for cookies, network
   observation, and script evaluation — a large, multi-session project.
3. **Degrade loudly.** Keep the single codebase, but have each unavailable feature return a
   clear "not supported on this platform" to the UI instead of a silent no-op.

Recommendation: **1 for v1.0, 3 as the follow-up.** The guide's cross-platform claim (§1) is
currently untrue, and shipping it as-is is the one thing in this audit that could cost real
credibility at launch.

---

# Explicitly NOT in this plan

Do not build these while closing CORE gaps — they are `[V2]`/`[V3]` and adding them is the scope
creep `CLAUDE.md` rule 3 and the guide's §13 Risk 1 both warn about:

environment switcher · custom CSS/JS injection · network throttling · request blocking · HAR
export · accessibility checker · regex/timestamp/hash/URL tools · split view · distraction-free
mode · font/image/CSS-variable inspectors · workspace templates · plugin system · AI panel.

Two `[CORE]` items are also deliberately deferred out of the numbered list, because they are
low-impact relative to everything above — pick them up only if the launch date allows:
**colour picker / eyedropper** (§7.6 — spike whether WebView2 exposes the `EyeDropper` API before
committing to build one) and **address-bar URL autocomplete** (§7.1 — needs a history-backed
suggestion dropdown).

---

# Launch checklist (parallel track — not code, but blocks v1.0)

From guide §9 and §12. None of this depends on the items above; it can be done by anyone, anytime.

- [ ] `README.md` — still the Tauri starter template. Needs: hero GIF, **4.58MB** size badge, "No account. No telemetry. Free forever." in paragraph one, feature grid, comparison table vs Responsively/Polypane, install link
- [ ] `LICENSE` — MIT, promised in §1, absent
- [ ] `CONTRIBUTING.md`, `CHANGELOG.md` — §12 calls both required from day 1
- [ ] `.github/workflows/build.yml` — `tauri-apps/tauri-action`; no CI today, so no download links
- [ ] `ARCHITECTURE.md` — **2 bytes, empty**, while `CLAUDE.md` orders every agent to read it first
- [ ] `src-tauri/tauri.conf.json` version — says `0.1.0`, `PROJECT_STATE.md` says v1.38.0
- [ ] Auto-updater — not configured
- [ ] `repo-structure.md` — stale since 2026-06-01; regenerate or delete
- [ ] Retire the obsolete spec sections listed at the end of `SPEC_COMPLIANCE.md` (§10 AI workflow, §6.3 structure, §6.4 storage format)
