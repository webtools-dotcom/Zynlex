# ISSUE: Black Screen on Window Restore

## Problem Description

When the XEVO window is minimized and then restored (by clicking on the taskbar), the browser WebviewWindow (label: "browser") shows a **completely black screen**. The web content (e.g., github.com) is no longer visible.

### Key Observation
**Maximize/restore cycle immediately fixes it.** If you:
1. Minimize XEVO
2. Restore XEVO → black screen
3. Click maximize → content reappears instantly
4. Click restore → content stays visible

This proves:
- The web content is **NOT lost or destroyed**
- The issue is a **compositing/paint problem** — WebView2 has the content but isn't displaying it

---

## Root Cause Analysis

### What's Happening
1. User minimizes XEVO window
2. Windows sends `WM_SIZE` with size 0,0 to the main window
3. WebView2 (child window) receives the minimize
4. User clicks taskbar to restore XEVO
5. Windows sends `SW_SHOW` to the main window
6. **WebView2 does NOT re-composite its surface** — shows black

### Why Maximize/Restore Fixes It
- `ShowWindow(hwnd, SW_MAXIMIZE)` or `ShowWindow(hwnd, SW_RESTORE)` sends `WM_SIZE` to the window
- WebView2 receives `WM_SIZE` and **re-composites its surface**
- Content reappears instantly

### Why `SW_SHOW` Doesn't Work
- Tauri's `WebviewWindow::show()` calls `ShowWindow(hwnd, SW_SHOW)`
- `SW_SHOW` makes the window visible but does NOT send `WM_SIZE`
- WebView2 never re-composites — stays black

### Microsoft's Confirmation
This is a **known WebView2 bug**: [MicrosoftEdge/WebView2Feedback#5171](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5171)

> "Webview2 has a blank screen when restored from minimized state in some user's machines. Then when we click somewhere else outside the window the page paints itself and shows the page correctly."

---

## Fixes Attempted

### Fix A: JS Eval Repaint (Session 23)
**Approach:** Eval JavaScript to hide `documentElement`, force layout recalculation, and dispatch resize event.

**Code in `browser_repaint`:**
```rust
let script = r#"(function() {
    try {
        document.documentElement.style.display = 'none';
        void document.documentElement.offsetHeight;
        document.documentElement.style.display = '';
        window.dispatchEvent(new Event('resize'));
    } catch (e) {}
})();"#;
let _ = wv.eval(&script);
```

**Why It Failed:**
- JS eval runs in the **web content process**, not the compositor
- Cannot trigger `WM_SIZE` at the native window level
- WebView2's compositing surface is separate from the DOM

---

### Fix B: Hide+Show Cycle (Session 23)
**Approach:** Toggle visibility to force WebView2 to tear down and rebuild the window surface.

**Code in `browser_repaint`:**
```rust
let _ = wv.hide();
tokio::time::sleep(Duration::from_millis(50)).await;
let _ = wv.show();
```

**Why It Failed:**
- `wv.hide()` calls `ShowWindow(hwnd, SW_HIDE)`
- `wv.show()` calls `ShowWindow(hwnd, SW_SHOW)`
- `SW_SHOW` does NOT send `WM_SIZE`
- Only `SW_RESTORE` or `SW_MAXIMIZE` send `WM_SIZE`
- WebView2 never re-composites — stays black

---

### Fix C: RedrawWindow Win32 API (Session 24)
**Approach:** Use Win32 `RedrawWindow` API to force immediate native repaint.

**Code in `browser_repaint`:**
```rust
#[cfg(windows)]
{
    use windows::Win32::Graphics::Gdi::{
        RedrawWindow, RDW_ALLCHILDREN, RDW_INVALIDATE, RDW_UPDATENOW,
    };
    if let Some(wv) = app.get_webview_window(BROWSER_LABEL) {
        if let Ok(hwnd) = wv.hwnd() {
            unsafe {
                let _ = RedrawWindow(
                    Some(hwnd),
                    None,
                    None,
                    RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN,
                );
            }
        }
    }
}
```

**Why It Failed:**
- `RedrawWindow` with `RDW_INVALIDATE | RDW_UPDATENOW` sends `WM_PAINT`
- WebView2 needs `WM_SIZE` to re-composite its surface, NOT `WM_PAINT`
- `WM_PAINT` tells the window to redraw its contents, but WebView2's compositor doesn't respond to it the same way

---

### Fix D: set_size Triggers WM_SIZE (Session 24)
**Approach:** Re-apply the current size to trigger `WM_SIZE` through Tauri's normal resize path.

**Code in `browser_repaint`:**
```rust
if let Some(wv) = app.get_webview_window(BROWSER_LABEL) {
    if let Ok(size) = wv.inner_size() {
        let _ = wv.set_size(Size::Physical(size));
    }
}
```

**Why It Failed:**
- Even though `set_size()` should send `WM_SIZE` through Tauri's resize path, it still doesn't work
- Possible reason: The size doesn't actually change (same dimensions), so Windows may suppress the `WM_SIZE` message
- Windows optimization: if the new size equals the old size, `WM_SIZE` may not be sent

---

## What We Know Works

| Action | Sends WM_SIZE? | WebView2 Re-composites? |
|--------|----------------|------------------------|
| `ShowWindow(hwnd, SW_SHOW)` | ❌ No | ❌ No |
| `ShowWindow(hwnd, SW_RESTORE)` | ✅ Yes | ✅ Yes |
| `ShowWindow(hwnd, SW_MAXIMIZE)` | ✅ Yes | ✅ Yes |
| `RedrawWindow(...)` | ❌ (sends WM_PAINT) | ❌ No |
| `set_size(same_size)` | ❌ (suppressed) | ❌ No |

---

## Next Steps to Explore

### Option 1: Call ShowWindow(hwnd, SW_RESTORE) Directly
Use Win32 API to call `ShowWindow(hwnd, SW_RESTORE)` instead of `SW_SHOW`. This should send `WM_SIZE`.

### Option 2: Force True Resize
Set size to current ±1px, then back to original. This forces a real resize event that Windows can't suppress.

```rust
if let Ok(size) = wv.inner_size() {
    let slightly_different = PhysicalSize::new(size.width, size.height.saturating_sub(1));
    let _ = wv.set_size(Size::Physical(slightly_different));
    let _ = wv.set_size(Size::Physical(size));
}
```

### Option 3: SetWindowPos with SWP_FRAMECHANGED
Use `SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED)` to force frame recomputation, which may trigger `WM_SIZE`.

### Option 4: Frontend resize Event
Dispatch `window.dispatchEvent(new Event('resize'))` from the frontend after restore. This may not work if the issue is at the native compositor level.

### Option 5: Combine Multiple Approaches
Try combining `set_size(±1px)` + `set_size(original)` + JS `resize` event dispatch.

---

## Environment
- OS: Windows
- Tauri: 2.11.2
- WebView2: Microsoft Edge WebView2 Runtime
- Browser window: `WebviewWindow` with `parent` set to main window
- Shown/hidden via `WebviewWindow::hide()` / `WebviewWindow::show()`

---

## References
- [MicrosoftEdge/WebView2Feedback#5171](https://github.com/MicrosoftEdge/WebView2Feedback/issues/5171) — Known bug: WebView2 blank screen after restore from minimize
- [Microsoft WebView2 Docs](https://learn.microsoft.com/en-us/microsoft-edge/webview2/) — WebView2 documentation
- [ICoreWebView2Controller::IsVisible](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2controller) — Microsoft's recommended pattern for visibility toggling
