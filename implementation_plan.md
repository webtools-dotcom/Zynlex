# XEVO Browser — 9-Issue Fix Plan

Deep analysis and fix plan for all 9 reported issues. Each issue is analyzed with root cause, proposed fix, and files affected.

---

## Issue 1: Keyboard Shortcuts Don't Work When Webview Has Focus

### Root Cause
The `XEVO_SHORTCUT_FORWARD_SCRIPT` already intercepts **some** shortcuts (Ctrl+D/K/T/W/R/B/,/Shift+T) and forwards them via `forward_shortcut` Rust command → `xevo://shortcut` event. However, several shortcuts are **missing** from the forwarding map:

| Shortcut | Current Status | Missing From |
|---|---|---|
| Ctrl+D | ✅ Forwarded (via separate `XEVO_BOOKMARK_SCRIPT`) | — |
| Ctrl+K | ✅ Forwarded | — |
| Ctrl+T | ✅ Forwarded | — |
| Ctrl+W | ✅ Forwarded | — |
| Ctrl+R | ✅ Forwarded | — |
| Ctrl+B | ✅ Forwarded | — |
| Ctrl+Shift+T | ✅ Forwarded | — |
| **Ctrl+?** (Ctrl+Shift+/) | ❌ Not forwarded | `XEVO_SHORTCUT_FORWARD_SCRIPT` |
| **Ctrl+F** | ❌ Not forwarded | `XEVO_SHORTCUT_FORWARD_SCRIPT` |
| **Ctrl+L** | ❌ Not forwarded | `XEVO_SHORTCUT_FORWARD_SCRIPT` |
| **Ctrl+1-9** | ❌ Not forwarded | `XEVO_SHORTCUT_FORWARD_SCRIPT` |
| **Ctrl+Tab** | ❌ Not forwarded | `XEVO_SHORTCUT_FORWARD_SCRIPT` |
| **Ctrl+Shift+Tab** | ❌ Not forwarded | `XEVO_SHORTCUT_FORWARD_SCRIPT` |
| **Escape** | ❌ Not forwarded | `XEVO_SHORTCUT_FORWARD_SCRIPT` |
| **Alt+Left/Right** | ❌ Not forwarded (but works inside webview natively?) | `XEVO_SHORTCUT_FORWARD_SCRIPT` |

### Proposed Fix

#### [MODIFY] [browser.rs](file:///d:/nishant%20tp/Xevo/Xevo/src-tauri/src/commands/browser.rs)
- Add missing shortcuts to `XEVO_SHORTCUT_FORWARD_SCRIPT`:
  - `Ctrl+Shift+/` → `"ctrl+?"` (shortcut help)
  - `Ctrl+F` → `"ctrl+f"` (find in page)
  - `Ctrl+L` → `"ctrl+l"` (focus address bar)
  - `Ctrl+1-9` → `"ctrl+1"` through `"ctrl+9"` (tab switch)
  - `Ctrl+Tab` → `"ctrl+tab"` (next tab)
  - `Ctrl+Shift+Tab` → `"ctrl+shift+tab"` (prev tab)
  - `Escape` → `"escape"` (close find / stop loading)
  - `Alt+Left` → `"alt+left"` (back)
  - `Alt+Right` → `"alt+right"` (forward)

#### [MODIFY] [useKeyboardShortcuts.ts](file:///d:/nishant%20tp/Xevo/Xevo/src/hooks/useKeyboardShortcuts.ts)
- Add handlers for the new forwarded shortcuts in the `xevo://shortcut` listener:
  - `"ctrl+?"` → `openShortcutHelp()`
  - `"ctrl+f"` → `openFind()`
  - `"ctrl+l"` → focus address bar (emit a custom event or use a ref)
  - `"ctrl+1"` through `"ctrl+9"` → switch to tab N
  - `"ctrl+tab"` → next tab
  - `"ctrl+shift+tab"` → prev tab
  - `"escape"` → close find or stop loading
  - `"alt+left"` → `bridge?.goBack()`
  - `"alt+right"` → `bridge?.goForward()`

---

## Issue 2: Modals/Overlays Appear Behind the Webview

### Root Cause
Session 14 already added hide/show logic for `commandPaletteOpen` and `shortcutHelpOpen` in `useWebviewBridge.ts` (lines 399-422). However:
- The **Settings panel** (`settingsPanelOpen`) is NOT included in the hide/show logic
- The **API Tester** modal (`apiTesterOpen`) is NOT included
- The **Find bar** is fine (it's positioned over the webview area and the webview is separate)

### Proposed Fix

#### [MODIFY] [useWebviewBridge.ts](file:///d:/nishant%20tp/Xevo/Xevo/src/hooks/useWebviewBridge.ts)
- Extend the modal hide/show `useEffect` (lines 399-422) to also watch `settingsPanelOpen` and `apiTesterOpen`:
  ```
  const anyModalOpen = commandPaletteOpen || shortcutHelpOpen || settingsPanelOpen || apiTesterOpen;
  ```

---

## Issue 3: Tab Dragging Shows Ban Icon / Not Working

### Root Cause Analysis
The tab drag implementation uses HTML5 native drag-and-drop (`draggable={true}`). From the user's screenshot and description ("ban icon / slanted line inside a circle"), this is the browser's default `dropEffect: "none"` visual — meaning the drop target is not accepting the drop.

After reading [TabBar.tsx](file:///d:/nishant%20tp/Xevo/Xevo/src/components/browser/TabBar.tsx) and [TabItem.tsx](file:///d:/nishant%20tp/Xevo/Xevo/src/components/browser/TabItem.tsx), the implementation looks correct. The most likely cause on WebView2 is that `e.preventDefault()` in `onDragOver` is not firing early enough, or there's a WebView2 quirk.

Looking more carefully:
- `TabItem` has `onDragOver` prop that calls `handleDragOver(tabId, e)` in TabBar
- `handleDragOver` does call `e.preventDefault()` and `e.dataTransfer.dropEffect = "move"` ✅
- But: when dragging over the **gap between tabs** (the border area, padding), neither the tab nor the container handler fires because the drop target might be a child element that doesn't have `onDragOver`.

The container `div` has `onDragOver={handleContainerDragOver}` but it only sets `dropAtEnd` when `e.target === e.currentTarget`. If the drag cursor is over a child element (like the inner flex container), the check `e.target === e.currentTarget` fails and `e.preventDefault()` is still called (good), but the visual might not update.

**Actual root cause**: The `handleContainerDragOver` on the outer container div DOES call `e.preventDefault()`. The inner scroll container div at line 209-213 ALSO has `onDragOver={handleContainerDragOver}` and `onDrop={handleContainerDrop}`. This should work. 

The "ban icon" could be because the drag event bubbles up but `dropEffect` isn't being set on every dragover. Let me look again more carefully...

The issue might be that **both** the inner and outer containers have `handleContainerDragOver`, and both call `e.preventDefault()`. But the `e.target === e.currentTarget` check in the handler means that when dragging over a tab child, `dropAtEnd` doesn't get set but `e.preventDefault()` is still called, which is correct — the drop should be accepted.

**Most likely WebView2 specific**: WebView2 on Windows sometimes requires `dragenter` as well as `dragover` to have `preventDefault()` called. Without `onDragEnter` with `e.preventDefault()`, WebView2 shows the ban icon.

### Proposed Fix

#### [MODIFY] [TabBar.tsx](file:///d:/nishant%20tp/Xevo/Xevo/src/components/browser/TabBar.tsx)
- Add `onDragEnter` handlers to the outer container, inner container, and plus button, all calling `e.preventDefault()`. WebView2 requires this in addition to `onDragOver` to show the correct drop cursor.

---

## Issue 4: Webview Not Following Browser Drag

### Status: Accepted Limitation

As you stated, the previous session (10.6) conclusively proved this is a **Tauri 2.x architectural limitation**:
- `Window::add_child` returns `Ok(())` but does NOT produce a WS_CHILD on Windows
- Issue #10079 is closed as "not planned"
- The frontend `onMoved` IPC listener is the best available mechanism
- The ~5-10ms drag lag is accepted

**No code changes proposed.** This is documented in KNOWN ISSUES.

> [!IMPORTANT]
> Per Session 10.6's conclusion and the AGENTS.md "do not" directives you listed, I will NOT attempt to fix this. The drag lag is a Tauri 2.x framework limitation.

---

## Issue 5: UI Looks Too Basic / HomePage Not Centered

### Root Cause
1. **HomePage "XEVO Home" not centered**: The `HomePage` layout is `max-w-3xl mx-auto px-6 py-10` inside a `w-full h-full overflow-y-auto` container. The `mx-auto` should center it horizontally. However, `ContentArea` has `absolute inset-0`, and the flex layout makes the content area fill whatever space is left after sidebar + workspace switcher. The text "XEVO Home" heading is inside a `text-center` div with `inline-flex items-center gap-2 mb-4` — this should center it. 

   Looking at the screenshots, the issue is the **HomePage content is top-left aligned**, not vertically centered. The content starts at `py-10` from the top, not centered vertically in the viewport. Also, the heading uses `inline-flex` which makes it left-aligned within the `text-center` div. `inline-flex` renders as inline, so `text-center` on the parent does center it. But the overall page is top-aligned, not vertically centered.

2. **Settings panel "too shitty and buggy"**: The settings panel is an absolute-positioned 300px-wide panel. It's basic and could use polish — better spacing, clearer visual hierarchy, transitions.

### Proposed Fix

#### [MODIFY] [HomePage.tsx](file:///d:/nishant%20tp/Xevo/Xevo/src/components/panels/HomePage.tsx)
- Center the hero section vertically when there are few items: add `flex flex-col items-center justify-center min-h-full` to the outer container, with the content wrapper centered
- Improve the hero heading — make "XEVO" more prominent, centered properly
- Add subtle visual polish: slight gradient background, better spacing

#### [MODIFY] [SettingsPanel.tsx](file:///d:/nishant%20tp/Xevo/Xevo/src/components/panels/SettingsPanel.tsx)
- Add smooth slide-in animation (transform + transition)
- Better section separation (subtle dividers)
- Improve the section header styling
- Fix the settings panel version string (shows "v0.9.6" but should show current version)

#### [MODIFY] [ContentArea.tsx](file:///d:/nishant%20tp/Xevo/Xevo/src/components/browser/ContentArea.tsx)  
- Ensure the HomePage fills the content area properly with vertical centering

---

## Issue 6: Search Engine Setting Not Applied

### Root Cause
**Critical bug found.** The `AddressBar.tsx` `resolveInput` function (lines 12-21) has the search engine **hardcoded to Google**:

```typescript
return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
```

It does NOT read the `searchEngine` setting from the settings store. The `HomePage.tsx` version of `resolveInput` (lines 34-49) DOES read the setting correctly. But the **primary search entry point** — the address bar — ignores the setting entirely.

Similarly, the **Rust-side** `resolve_url` function in `browser.rs` (lines 477-495) also hardcodes Google:
```rust
format!("https://www.google.com/search?q={}", urlencoding::encode(s))
```

The Rust `resolve_url` is called by `browser_navigate`, which receives the URL from the frontend. Since the frontend's `AddressBar.resolveInput` already resolves searches to a full URL before sending it to Rust, the Rust fallback should never fire. But it's a defense-in-depth issue.

### Proposed Fix

#### [MODIFY] [AddressBar.tsx](file:///d:/nishant%20tp/Xevo/Xevo/src/components/browser/AddressBar.tsx)
- Import `useSettingsStore` and read `searchEngine` + `customSearchUrl`
- Update `resolveInput` to accept search engine parameters (same as `HomePage.tsx`'s version)
- Use the selected search engine when the input is a search query

---

## Issue 7: Cannot Delete Workspace (No Right-Click Option)

### Root Cause
The `WorkspaceSwitcher.tsx` workspace icons only have a `onClick` handler for switching. There's no `onContextMenu` handler. The `deleteWorkspace` action already exists in the workspaces store (line 108-117 of [workspaces.ts](file:///d:/nishant%20tp/Xevo/Xevo/src/stores/workspaces.ts)), including the safety check that prevents deleting the last workspace.

### Proposed Fix

#### [MODIFY] [WorkspaceSwitcher.tsx](file:///d:/nishant%20tp/Xevo/Xevo/src/components/sidebar/WorkspaceSwitcher.tsx)
- Add `onContextMenu` handler to `WorkspaceIcon`
- Show a small context menu (portal-rendered like `TabContextMenu`) with:
  - "Delete Workspace" option (disabled if it's the only workspace)
- The context menu calls `deleteWorkspace(id)` from the store
- Also clean up any tabs belonging to that workspace when deleting

---

## Issue 8: Theme Not Applied to Webview

### Root Cause
The browser webview is a **separate OS window**. When the user changes the theme in settings (dark → light), `App.tsx` sets `document.documentElement.setAttribute("data-theme", "light")` on the **main window's** document. The webview window has its own separate document — no attribute is set on it.

The webview loads external websites, so we can't control their styling. But what we CAN do is inject a `prefers-color-scheme` media query override. However, **Tauri 2's WebviewWindow doesn't have a direct API to change the webview's theme/color-scheme**.

What we can do:
1. When theme changes, `eval()` a script on the browser webview that sets `document.documentElement.style.colorScheme = "light"` (or `"dark"`). This tells the browser rendering engine to use light/dark mode for native form controls, scrollbars, and `prefers-color-scheme` media query.

### Proposed Fix

#### [MODIFY] [browser.rs](file:///d:/nishant%20tp/Xevo/Xevo/src-tauri/src/commands/browser.rs)
- Add new command `browser_set_theme(theme: String)` that calls `wv.eval()` to set `document.documentElement.style.colorScheme` to the specified theme

#### [MODIFY] [lib.rs](file:///d:/nishant%20tp/Xevo/Xevo/src-tauri/src/lib.rs)
- Register `browser_set_theme` command

#### [MODIFY] [browser.ts](file:///d:/nishant%20tp/Xevo/Xevo/src/services/browser.ts) (service)
- Add `setWebviewTheme(theme: string)` IPC function

#### [MODIFY] [useWebviewBridge.ts](file:///d:/nishant%20tp/Xevo/Xevo/src/hooks/useWebviewBridge.ts)
- Add `useEffect` that watches the `theme` setting and calls `setWebviewTheme()` when it changes (only if webview exists / has a URL loaded)

---

## Issue 9: Unnecessary Console Errors in Webview

### Root Cause Analysis

There are **two categories** of errors:

#### Category A: CSP violations from the website itself
```
Executing inline script violates the following Content Security Policy directive...
```
These are **the website's own CSP rules** blocking their own inline scripts. These appear in Chrome too. **Not an XEVO bug — these are the website's own issues.** No fix needed.

#### Category B: XEVO's IPC errors in the webview console
```
Connecting to 'http://ipc.localhost/update_tab_info' violates the following Content Security Policy directive...
IPC custom protocol failed, Tauri will now use the postMessage interface instead
Uncaught (in promise) update_tab_info not allowed. Plugin not found
```

These are caused by XEVO's injected scripts (`BROWSER_INIT_SCRIPT`, `XEVO_FIND_SCRIPT`, etc.) trying to call `__TAURI_INTERNALS__.invoke("update_tab_info", ...)` from within websites that have strict CSP rules. When a website has a `connect-src` CSP directive that doesn't include `http://ipc.localhost`, the Tauri IPC call via fetch fails. Tauri then falls back to `postMessage`, which also fails because the command is invoked from the **browser webview** (which is a real WebviewWindow with `__TAURI_INTERNALS__`), but the error `"update_tab_info not allowed. Plugin not found"` suggests the command permissions or capabilities might not be configured for the browser webview.

The **"Tracking Prevention blocked access to storage"** errors are Microsoft Edge WebView2's built-in tracking prevention feature. **Not an XEVO bug.**

The GitHub `503 Service Unavailable` errors are GitHub's own analytics service issues. **Not an XEVO bug.**

### Proposed Fix

#### Category A + GitHub 503 + Tracking Prevention: **No fix** — these are external. We could suppress console noise but that changes behavior.

#### Category B (IPC errors):

#### [MODIFY] [browser.rs](file:///d:/nishant%20tp/Xevo/Xevo/src-tauri/src/commands/browser.rs)
- In the injected scripts (`BROWSER_INIT_SCRIPT`, `XEVO_BOOKMARK_SCRIPT`, `XEVO_SHORTCUT_FORWARD_SCRIPT`), wrap `__TAURI_INTERNALS__.invoke(...)` calls in try-catch blocks that **silently** swallow errors instead of letting them propagate to the console
- The `BROWSER_INIT_SCRIPT` already has `catch(function() {})` on the invoke call, but the Tauri IPC fallback mechanism itself logs the error before the catch fires. We can't suppress that.
- **Better approach**: Check if the invoke will work before calling it. Use a flag or test call.
- **Actually, the best approach**: The errors from Tauri's IPC fallback mechanism (`IPC custom protocol failed...`) and the `"not allowed"` error are logged by Tauri's own JS runtime, not by our code. We can't suppress them without patching Tauri. But we can reduce the frequency by wrapping calls in a debounced/guarded pattern.
- The `"update_tab_info not allowed"` error suggests the browser webview's capabilities may need the command to be explicitly allowed. Check [capabilities/default.json](file:///d:/nishant%20tp/Xevo/Xevo/src-tauri/capabilities/default.json).

#### [MODIFY] [default.json](file:///d:/nishant%20tp/Xevo/Xevo/src-tauri/capabilities/default.json)
- Review and possibly add the browser webview window to the capabilities so `update_tab_info` is allowed from it.

> [!NOTE]
> The CSP-related IPC errors are an inherent limitation: websites with strict CSP will block Tauri's IPC mechanism. The `postMessage` fallback exists for this, but the error is logged by Tauri internals. The best we can do is ensure our own invoke calls have silent catch handlers and reduce unnecessary calls.

---

## Open Questions

> [!IMPORTANT]
> **Issue 5 scope**: You mentioned keeping it "lightweight and minimal" — how much UI polish do you want? I can do:
> - **Option A (minimal)**: Just center the HomePage content properly, fix version string in settings
> - **Option B (moderate)**: Also add slide-in animation to settings, better section dividers, improve visual hierarchy
> 
> I'll go with **Option B** unless you say otherwise.

> [!IMPORTANT]
> **Issue 9**: The CSP/IPC console errors from Tauri's own runtime are not suppressible from our code — Tauri's JavaScript bridge logs them internally before our catch handlers run. Do you want me to:
> - **Option A**: Just ensure our own invoke calls have silent catches (already mostly done)
> - **Option B**: Investigate the capabilities file to fix the "not allowed" errors specifically
>
> I'll go with **Option B** since the "not allowed" error is potentially fixable.

---

## Proposed Changes Summary

| Issue | Files Changed | Complexity |
|-------|--------------|------------|
| #1 Keyboard shortcuts | `browser.rs`, `useKeyboardShortcuts.ts` | Medium |
| #2 Modals behind webview | `useWebviewBridge.ts` | Low |
| #3 Tab drag ban icon | `TabBar.tsx` | Low |
| #4 Webview drag follow | None (accepted limitation) | — |
| #5 UI polish | `HomePage.tsx`, `SettingsPanel.tsx`, `ContentArea.tsx` | Medium |
| #6 Search engine | `AddressBar.tsx` | Low |
| #7 Delete workspace | `WorkspaceSwitcher.tsx` | Medium |
| #8 Theme on webview | `browser.rs`, `lib.rs`, `browser.ts`, `useWebviewBridge.ts` | Medium |
| #9 Console errors | `browser.rs`, `default.json` | Low |

---

## Verification Plan

### Automated Tests
- `cd src-tauri && cargo check` — Rust compilation
- `pnpm tsc --noEmit` — TypeScript type checking

### Manual Verification
- Run `pnpm tauri dev` and verify each issue:
  1. Click on webview → press Ctrl+K, Ctrl+T, Ctrl+W, etc. → verify they work
  2. Open command palette / shortcut help / settings / API tester → verify they appear above webview
  3. Try dragging tabs → verify no ban icon, tabs reorder correctly
  4. (Skip — accepted limitation)
  5. Open new tab → verify "XEVO Home" is centered, settings panel looks polished
  6. Change search engine to DuckDuckGo → search from address bar → verify DuckDuckGo is used
  7. Right-click workspace → verify "Delete" option appears and works
  8. Change theme to Light → verify webview respects the change
  9. Open a website with strict CSP → verify console errors are reduced
