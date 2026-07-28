/**
 * useKeyboardShortcuts — global keyboard shortcuts for the browser.
 *
 * Two complementary mechanisms feed the same handleShortcut(): a main-window
 * keydown listener (input/textarea guarded) for when focus is on the React
 * UI, and a bridge for when focus is inside a tab's webview — its injected
 * script forwards the keypress to Rust, which re-emits it back here. Both
 * paths are idempotent, so double-handling when they overlap is harmless.
 *
 * Full shortcut list: see ShortcutHelp.tsx, the single source of truth shown
 * to users (Ctrl/Cmd+?).
 */
import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useUIStore } from "@/stores/ui";
import { useTabsStore } from "@/stores/tabs";
import { getLiveWorkspaceActiveTabId, getLiveWorkspaceTabIds } from "@/lib/workspaceTabs";
import { toggleBookmarkForActiveTab } from "@/lib/bookmarkAction";
import { closeTabWebview, setTabZoom, hardReload } from "@/services/browser";
import type { useWebviewBridge } from "@/hooks/useWebviewBridge";

type BridgeType = ReturnType<typeof useWebviewBridge>;

/** Chrome's zoom ladder. Clamped by browser_set_zoom to 0.25..5 as well. */
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

function hardReloadActiveTab() {
  const wsState = useWorkspacesStore.getState();
  const tabId = getLiveWorkspaceActiveTabId(
    wsState.workspaces[wsState.activeWorkspaceId],
    useTabsStore.getState().tabs,
  );
  if (tabId) hardReload(tabId).catch(() => {});
}

function switchWorkspace(index: number) {
  const { workspaceOrder, setActiveWorkspace } = useWorkspacesStore.getState();
  const target = workspaceOrder[index];
  if (target) setActiveWorkspace(target);
}

/** dir: -1 zoom out, +1 zoom in, 0 reset to 100%. */
function applyZoom(dir: -1 | 0 | 1) {
  const wsState = useWorkspacesStore.getState();
  const wsId = wsState.activeWorkspaceId;
  const tabId = getLiveWorkspaceActiveTabId(wsState.workspaces[wsId], useTabsStore.getState().tabs);
  if (!tabId) return;

  let next = 1;
  if (dir !== 0) {
    const current = useTabsStore.getState().tabs[tabId]?.zoom ?? 1;
    let i = ZOOM_STEPS.findIndex((z) => Math.abs(z - current) < 0.001);
    if (i === -1) i = ZOOM_STEPS.indexOf(1);
    next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + dir))];
  }

  useTabsStore.getState().updateTab(tabId, { zoom: next });
  setTabZoom(tabId, next).catch(() => {});
}

// Shared shortcut handler — called from both keydown and global shortcut.
function handleShortcut(shortcut: string, bridge: BridgeType | null) {
  if (shortcut === "ctrl+d") {
    toggleBookmarkForActiveTab();
    return;
  }

  if (shortcut === "ctrl+k") {
    useUIStore.getState().openCommandPalette();
    return;
  }

  if (shortcut === "ctrl+b") {
    useUIStore.getState().toggleSidebar();
    return;
  }

  if (shortcut === "ctrl+,") {
    useUIStore.getState().toggleSettingsPanel();
    return;
  }

  if (shortcut === "ctrl+r") {
    bridge?.reload();
    return;
  }

  if (shortcut === "ctrl+t") {
    const wsState = useWorkspacesStore.getState();
    const wsId = wsState.activeWorkspaceId;
    const id = useTabsStore.getState().addTab(wsId, { url: "", title: "New Tab" });
    useWorkspacesStore.getState().addTabToWorkspace(wsId, id);
    useWorkspacesStore.getState().setActiveTab(wsId, id);
    return;
  }

  if (shortcut === "ctrl+w") {
    const wsState = useWorkspacesStore.getState();
    const wsId = wsState.activeWorkspaceId;
    const ws = wsState.workspaces[wsId];
    const tabId = getLiveWorkspaceActiveTabId(ws, useTabsStore.getState().tabs);
    if (tabId) {
      useWorkspacesStore.getState().removeTabFromWorkspace(wsId, tabId);
      useTabsStore.getState().closeTab(tabId);
      closeTabWebview(tabId).catch(() => {});
    }
    return;
  }

  if (shortcut === "ctrl+shift+t") {
    const last = useTabsStore.getState().lastClosedTab;
    if (!last) return;
    const wsState = useWorkspacesStore.getState();
    const wsId = wsState.activeWorkspaceId;
    const newId = useTabsStore.getState().addTab(wsId, {
      url: last.url,
      title: last.title,
    });
    useWorkspacesStore.getState().addTabToWorkspace(wsId, newId);
    useWorkspacesStore.getState().setActiveTab(wsId, newId);
    useTabsStore.getState().clearLastClosedTab();
    return;
  }

  if (shortcut === "ctrl+?" || shortcut === "ctrl+shift+/") {
    useUIStore.getState().openShortcutHelp();
    return;
  }

  if (shortcut === "ctrl+f") {
    const ui = useUIStore.getState();
    if (ui.findOpen) {
      ui.closeFind();
      requestAnimationFrame(() => ui.openFind());
    } else {
      ui.openFind();
    }
    return;
  }

  if (shortcut === "ctrl+l") {
    window.dispatchEvent(new CustomEvent("xevo:focus-address-bar"));
    return;
  }

  if (shortcut === "escape") {
    const ui = useUIStore.getState();
    if (ui.findOpen) {
      ui.closeFind();
    } else if (bridge) {
      const wsState = useWorkspacesStore.getState();
      const wsId = wsState.activeWorkspaceId;
      const tabId = getLiveWorkspaceActiveTabId(
        wsState.workspaces[wsId],
        useTabsStore.getState().tabs,
      );
      if (tabId) {
        const tab = useTabsStore.getState().tabs[tabId];
        if (tab?.isLoading) {
          bridge.stopLoading();
        }
      }
    }
    return;
  }

  if (shortcut === "ctrl+shift+r") {
    hardReloadActiveTab();
    return;
  }

  if (shortcut === "ctrl+h") {
    useUIStore.getState().setActivePanel("history");
    useUIStore.getState().setSidebarOpen(true);
    return;
  }

  if (/^ctrl\+shift\+[1-9]$/.test(shortcut)) {
    switchWorkspace(parseInt(shortcut.slice(-1), 10) - 1);
    return;
  }

  if (shortcut === "ctrl+=" || shortcut === "ctrl++") {
    applyZoom(1);
    return;
  }

  if (shortcut === "ctrl+-") {
    applyZoom(-1);
    return;
  }

  if (shortcut === "ctrl+0") {
    applyZoom(0);
    return;
  }

  if (shortcut === "alt+left") {
    bridge?.goBack();
    return;
  }

  if (shortcut === "alt+right") {
    bridge?.goForward();
    return;
  }

  if (/^ctrl\+[1-9]$/.test(shortcut)) {
    const n = parseInt(shortcut.slice(-1), 10) - 1;
    const wsState = useWorkspacesStore.getState();
    const wsId = wsState.activeWorkspaceId;
    const workspace = wsState.workspaces[wsId];
    if (!workspace) return;
    const tabIds = getLiveWorkspaceTabIds(workspace, useTabsStore.getState().tabs);
    const targetTabId = tabIds[n];
    if (targetTabId) {
      useWorkspacesStore.getState().setActiveTab(wsId, targetTabId);
    }
    return;
  }

  if (shortcut === "ctrl+tab") {
    const wsState = useWorkspacesStore.getState();
    const wsId = wsState.activeWorkspaceId;
    const workspace = wsState.workspaces[wsId];
    if (!workspace) return;
    const tabIds = getLiveWorkspaceTabIds(workspace, useTabsStore.getState().tabs);
    if (tabIds.length === 0) return;
    const currentTabId = getLiveWorkspaceActiveTabId(workspace, useTabsStore.getState().tabs);
    const currentIndex = tabIds.indexOf(currentTabId ?? "");
    const nextIndex = (currentIndex + 1) % tabIds.length;
    const nextTabId = tabIds[nextIndex];
    if (nextTabId) {
      useWorkspacesStore.getState().setActiveTab(wsId, nextTabId);
    }
    return;
  }

  if (shortcut === "ctrl+shift+tab") {
    const wsState = useWorkspacesStore.getState();
    const wsId = wsState.activeWorkspaceId;
    const workspace = wsState.workspaces[wsId];
    if (!workspace) return;
    const tabIds = getLiveWorkspaceTabIds(workspace, useTabsStore.getState().tabs);
    if (tabIds.length === 0) return;
    const currentTabId = getLiveWorkspaceActiveTabId(workspace, useTabsStore.getState().tabs);
    const currentIndex = tabIds.indexOf(currentTabId ?? "");
    const prevIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
    const prevTabId = tabIds[prevIndex];
    if (prevTabId) {
      useWorkspacesStore.getState().setActiveTab(wsId, prevTabId);
    }
    return;
  }
}

export function useKeyboardShortcuts(bridge: BridgeType | null) {
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;

  // ── Mechanism 1: Main-window keydown listener ────────────────────────
  // Works when the React UI has focus. Includes input/textarea guards.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      const isMac = e.metaKey;

      // ── Escape → close find bar or stop loading ──────────────────────
      if (e.key === "Escape") {
        const ui = useUIStore.getState();
        if (ui.findOpen) {
          e.preventDefault();
          ui.closeFind();
        } else if (bridge) {
          const wsState = useWorkspacesStore.getState();
          const wsId = wsState.activeWorkspaceId;
          const tabId = getLiveWorkspaceActiveTabId(
            wsState.workspaces[wsId],
            useTabsStore.getState().tabs,
          );
          if (tabId) {
            const tab = useTabsStore.getState().tabs[tabId];
            if (tab?.isLoading) {
              e.preventDefault();
              bridge.stopLoading();
            }
          }
        }
        return;
      }

      // ── Ctrl/Cmd+K → open command palette ──────────────────────────
      if (mod && !e.shiftKey && !e.altKey && e.key === "k") {
        e.preventDefault();
        useUIStore.getState().openCommandPalette();
        return;
      }

      // ── Ctrl/Cmd+B → toggle sidebar ────────────────────────────────
      if (mod && !e.shiftKey && !e.altKey && e.key === "b") {
        e.preventDefault();
        useUIStore.getState().toggleSidebar();
        return;
      }

      // ── Ctrl/Cmd+? (i.e. Ctrl/Cmd+Shift+/) → open keyboard shortcut help ─
      if (mod && e.shiftKey && !e.altKey && e.key === "?") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
        useUIStore.getState().openShortcutHelp();
        return;
      }

      // ── Ctrl/Cmd+F → open find in page ────────────────────────────
      if (mod && !e.shiftKey && !e.altKey && e.key === "f") {
        e.preventDefault();
        const ui = useUIStore.getState();
        if (ui.findOpen) {
          ui.closeFind();
          requestAnimationFrame(() => ui.openFind());
        } else {
          ui.openFind();
        }
        return;
      }

      // ── Ctrl/Cmd+, → toggle settings panel ─────────────────────────
      if (mod && e.key === ",") {
        e.preventDefault();
        useUIStore.getState().toggleSettingsPanel();
        return;
      }

      // ── Ctrl/Cmd+D → bookmark current tab ─────────────────────────
      if (mod && !e.shiftKey && !e.altKey && e.key === "d") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
        toggleBookmarkForActiveTab();
        return;
      }

      // ── Alt+ArrowLeft → back ─────────────────────────────────────
      if (e.altKey && !mod && e.key === "ArrowLeft") {
        if (bridge) {
          e.preventDefault();
          bridge.goBack();
        }
        return;
      }

      // ── Alt+ArrowRight → forward ─────────────────────────────────
      if (e.altKey && !mod && e.key === "ArrowRight") {
        if (bridge) {
          e.preventDefault();
          bridge.goForward();
        }
        return;
      }

      // ── Ctrl/Cmd+Shift+R → hard reload (bypass cache) ────────────
      if (mod && e.shiftKey && !e.altKey && (e.key === "R" || e.key === "r")) {
        e.preventDefault();
        hardReloadActiveTab();
        return;
      }

      // ── Ctrl/Cmd+H → history panel ───────────────────────────────
      if (mod && !e.shiftKey && !e.altKey && e.key === "h") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
        useUIStore.getState().setActivePanel("history");
        useUIStore.getState().setSidebarOpen(true);
        return;
      }

      // ── Ctrl/Cmd+Shift+1..9 → switch workspace ───────────────────
      // Must come before the Ctrl+1..9 tab handler, which ignores shift.
      if (mod && e.shiftKey && !e.altKey && /^[1-9!@#$%^&*(]$/.test(e.key)) {
        const digit = "!@#$%^&*(".indexOf(e.key);
        const index = digit === -1 ? parseInt(e.key, 10) - 1 : digit;
        if (index >= 0) {
          e.preventDefault();
          switchWorkspace(index);
          return;
        }
      }

      // ── Ctrl/Cmd+R → reload ──────────────────────────────────────
      if (mod && !e.shiftKey && !e.altKey && (e.key === "r" || e.key === "R")) {
        if (bridge) {
          e.preventDefault();
          bridge.reload();
        }
        return;
      }

      // ── Ctrl/Cmd +/-/0 → zoom in / out / reset ───────────────────
      if (mod && !e.altKey && (e.key === "+" || e.key === "=" || e.key === "-" || e.key === "0")) {
        e.preventDefault();
        applyZoom(e.key === "0" ? 0 : e.key === "-" ? -1 : 1);
        return;
      }

      // ── Ctrl/Cmd+1..9 → switch to tab N ──────────────────────────
      if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const wsState = useWorkspacesStore.getState();
        const wsId = wsState.activeWorkspaceId;
        const workspace = wsState.workspaces[wsId];
        if (!workspace) return;
        const tabIds = getLiveWorkspaceTabIds(workspace, useTabsStore.getState().tabs);
        const targetIndex = parseInt(e.key, 10) - 1;
        const targetTabId = tabIds[targetIndex];
        if (targetTabId) {
          useWorkspacesStore.getState().setActiveTab(wsId, targetTabId);
        }
        return;
      }

      // ── Ctrl+Tab → next tab (Cmd+Tab is OS-reserved on macOS) ────────
      if (!isMac && e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "Tab") {
        e.preventDefault();
        const wsState = useWorkspacesStore.getState();
        const wsId = wsState.activeWorkspaceId;
        const workspace = wsState.workspaces[wsId];
        if (!workspace) return;
        const tabIds = getLiveWorkspaceTabIds(workspace, useTabsStore.getState().tabs);
        if (tabIds.length === 0) return;
        const currentTabId = getLiveWorkspaceActiveTabId(workspace, useTabsStore.getState().tabs);
        const currentIndex = tabIds.indexOf(currentTabId ?? "");
        const nextIndex = (currentIndex + 1) % tabIds.length;
        const nextTabId = tabIds[nextIndex];
        if (nextTabId) {
          useWorkspacesStore.getState().setActiveTab(wsId, nextTabId);
        }
        return;
      }

      // ── Ctrl+Shift+Tab → previous tab ────────────────────────────────
      if (!isMac && e.ctrlKey && e.shiftKey && !e.altKey && e.key === "Tab") {
        e.preventDefault();
        const wsState = useWorkspacesStore.getState();
        const wsId = wsState.activeWorkspaceId;
        const workspace = wsState.workspaces[wsId];
        if (!workspace) return;
        const tabIds = getLiveWorkspaceTabIds(workspace, useTabsStore.getState().tabs);
        if (tabIds.length === 0) return;
        const currentTabId = getLiveWorkspaceActiveTabId(workspace, useTabsStore.getState().tabs);
        const currentIndex = tabIds.indexOf(currentTabId ?? "");
        const prevIndex = (currentIndex - 1 + tabIds.length) % tabIds.length;
        const prevTabId = tabIds[prevIndex];
        if (prevTabId) {
          useWorkspacesStore.getState().setActiveTab(wsId, prevTabId);
        }
        return;
      }

      // ── Ctrl+Shift+T → reopen last closed tab ────────────────────────
      if (mod && e.shiftKey && !e.altKey && e.key === "T") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        const last = useTabsStore.getState().lastClosedTab;
        if (!last) return;
        e.preventDefault();
        const wsState = useWorkspacesStore.getState();
        const wsId = wsState.activeWorkspaceId;
        const newId = useTabsStore.getState().addTab(wsId, {
          url: last.url,
          title: last.title,
        });
        useWorkspacesStore.getState().addTabToWorkspace(wsId, newId);
        useWorkspacesStore.getState().setActiveTab(wsId, newId);
        useTabsStore.getState().clearLastClosedTab();
        return;
      }

    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bridge]);

  // ── Mechanism 2: Browser-focus shortcut bridge ───────────────────────
  // Works when the browser webview has focus. The webview injects a
  // keydown listener that forwards shortcuts to Rust, which re-emits
  // them here as xevo://shortcut events.
  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;

    let cancelled = false;
    let unlisten: UnlistenFn | null = null;

    void listen<string>("xevo://shortcut", (e) => {
      handleShortcut(e.payload.toLowerCase(), bridgeRef.current);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
