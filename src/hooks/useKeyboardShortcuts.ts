/**
 * useKeyboardShortcuts — global keyboard shortcuts for the browser.
 *
 * Two complementary mechanisms:
 *   1. Main-window keydown listener — works when the user is focused on
 *      the React UI (address bar, sidebar, etc.). Handles input/textarea
 *      guards so shortcuts don't fire while typing.
 *   2. OS-level global shortcuts via tauri-plugin-global-shortcut — works
 *      when the user is focused on the browser webview (e.g. browsing
 *      GitHub). Fires regardless of which window has focus.
 *
 * Both mechanisms call the same shared handleShortcut() function.
 * All actions are idempotent, so double-handling (when both fire
 * simultaneously) is harmless.
 *
 * Handled shortcuts:
 *   Ctrl/Cmd+K             → open command palette
 *   Ctrl/Cmd+Shift+?       → open keyboard shortcut help
 *   Ctrl/Cmd+F             → open find in page
 *   Ctrl/Cmd+D             → bookmark current tab
 *   Ctrl/Cmd+B             → toggle sidebar
 *   Ctrl/Cmd+,             → toggle settings panel
 *   Ctrl/Cmd+R             → reload
 *   Ctrl/Cmd+T             → new tab
 *   Ctrl/Cmd+W             → close tab
 *   Ctrl/Cmd+Shift+T       → reopen last closed tab
 *   Ctrl/Cmd+L             → focus address bar
 *   Alt+ArrowLeft          → back
 *   Alt+ArrowRight         → forward
 *   Escape                 → close find / stop loading
 *   Ctrl+Tab               → next tab
 *   Ctrl+Shift+Tab         → previous tab
 *   Ctrl/Cmd+1..9          → switch to tab N
 */
import { useEffect, useRef } from "react";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useUIStore } from "@/stores/ui";
import { useTabsStore } from "@/stores/tabs";
import {
  getLiveWorkspaceActiveTabId,
  getLiveWorkspaceTabIds,
} from "@/lib/workspaceTabs";
import { toggleBookmarkForActiveTab } from "@/lib/bookmarkAction";
import type { useWebviewBridge } from "@/hooks/useWebviewBridge";

type BridgeType = ReturnType<typeof useWebviewBridge>;

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

  if (shortcut === "ctrl+?") {
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
        useTabsStore.getState().tabs
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
    const currentTabId = getLiveWorkspaceActiveTabId(
      workspace,
      useTabsStore.getState().tabs
    );
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
    const currentTabId = getLiveWorkspaceActiveTabId(
      workspace,
      useTabsStore.getState().tabs
    );
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
            useTabsStore.getState().tabs
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

      // ── Ctrl/Cmd+R → reload ──────────────────────────────────────
      if (mod && !e.shiftKey && !e.altKey && (e.key === "r" || e.key === "R")) {
        if (bridge) {
          e.preventDefault();
          bridge.reload();
        }
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
        const currentTabId = getLiveWorkspaceActiveTabId(
          workspace,
          useTabsStore.getState().tabs
        );
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
        const currentTabId = getLiveWorkspaceActiveTabId(
          workspace,
          useTabsStore.getState().tabs
        );
        const currentIndex = tabIds.indexOf(currentTabId ?? "");
        const prevIndex =
          (currentIndex - 1 + tabIds.length) % tabIds.length;
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

  // ── Mechanism 2: OS-level global shortcuts ──────────────────────────
  // Works when the browser webview has focus. Bypasses CSP entirely.
  useEffect(() => {
    const shortcuts = [
      "CommandOrControl+K",
      "CommandOrControl+Shift+?",
      "CommandOrControl+F",
      "CommandOrControl+D",
      "CommandOrControl+B",
      "CommandOrControl+,",
      "CommandOrControl+R",
      "CommandOrControl+T",
      "CommandOrControl+W",
      "CommandOrControl+Shift+T",
      "CommandOrControl+L",
      "Alt+ArrowLeft",
      "Alt+ArrowRight",
      "Escape",
      "CommandOrControl+Tab",
      "CommandOrControl+Shift+Tab",
      "CommandOrControl+1",
      "CommandOrControl+2",
      "CommandOrControl+3",
      "CommandOrControl+4",
      "CommandOrControl+5",
      "CommandOrControl+6",
      "CommandOrControl+7",
      "CommandOrControl+8",
      "CommandOrControl+9",
    ];

    register(shortcuts, (event) => {
      if (event.state !== "Pressed") return;

      const raw = event.shortcut
        .replace("CommandOrControl+", "ctrl+")
        .replace("Meta+", "ctrl+")
        .toLowerCase();

      // Normalize modifier order: "ctrl+shift+?" stays as-is
      handleShortcut(raw, bridgeRef.current);
    }).catch((err) => {
      console.warn("[xevo] global shortcut registration failed:", err);
    });

    return () => {
      unregisterAll().catch(() => {});
    };
  }, []);
}
