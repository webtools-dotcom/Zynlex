/**
 * useKeyboardShortcuts — global keyboard shortcuts for the browser.
 *
 * Centralizes shortcut handling so individual components don't need
 * their own keydown listeners. Re-runs when the bridge changes.
 *
 * Handles:
 *   - Ctrl/Cmd+K                       → open command palette
 *   - Ctrl/Cmd+?                       → open keyboard shortcut help
 *   - Alt+ArrowLeft / Alt+ArrowRight  → back / forward
 *   - Ctrl/Cmd+R                       → reload
 *   - Ctrl/Cmd+1..9                    → switch to tab N in current workspace
 *   - Ctrl+Tab / Ctrl+Shift+Tab        → cycle tabs (Cmd+Tab is OS-reserved)
 *   - Ctrl/Cmd+,                       → toggle settings panel
 *
 * Skipped (handled elsewhere — would create duplicate listeners):
 *   - Ctrl/Cmd+L  → focus address bar (AddressBar.tsx)
 *   - Ctrl/Cmd+T  → new tab           (TabBar.tsx)
 *   - Ctrl/Cmd+W  → close tab         (TabBar.tsx)
 */
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
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

export function useKeyboardShortcuts(bridge: BridgeType | null) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      const isMac = e.metaKey;

      // ── Escape → close find bar or stop loading ──────────────────────────
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

      // ── Ctrl/Cmd+K → open command palette ──────────────────────────────
      if (mod && !e.shiftKey && !e.altKey && e.key === "k") {
        e.preventDefault();
        useUIStore.getState().openCommandPalette();
        return;
      }

      // ── Ctrl/Cmd+B → toggle sidebar ────────────────────────────────────
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

      // ── Ctrl/Cmd+F → open find in page ────────────────────────────────
      if (mod && !e.shiftKey && !e.altKey && e.key === "f") {
        e.preventDefault();
        const ui = useUIStore.getState();
        if (ui.findOpen) {
          // Already open — re-focus the input by closing & reopening.
          ui.closeFind();
          requestAnimationFrame(() => ui.openFind());
        } else {
          ui.openFind();
        }
        return;
      }

      // ── Ctrl/Cmd+, → toggle settings panel ─────────────────────────────
      if (mod && e.key === ",") {
        e.preventDefault();
        useUIStore.getState().toggleSettingsPanel();
        return;
      }

      // ── Ctrl/Cmd+D → bookmark current tab ─────────────────────────────
      // The webview side is handled by XEVO_BOOKMARK_SCRIPT (see
      // src-tauri/src/commands/browser.rs) which invokes
      // `browser_bookmark_request` → `browser://bookmark-request` event
      // → useWebviewBridge → toggleBookmarkForActiveTab(). This main
      // window handler is the fallback for when the user is focused on
      // the main window (address bar, sidebar, etc.) and not in a text
      // input.
      if (mod && !e.shiftKey && !e.altKey && e.key === "d") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea") return;
        e.preventDefault();
        toggleBookmarkForActiveTab();
        return;
      }

      // ── Alt+ArrowLeft → back ─────────────────────────────────────────────
      if (e.altKey && !mod && e.key === "ArrowLeft") {
        if (bridge) {
          e.preventDefault();
          bridge.goBack();
        }
        return;
      }

      // ── Alt+ArrowRight → forward ─────────────────────────────────────────
      if (e.altKey && !mod && e.key === "ArrowRight") {
        if (bridge) {
          e.preventDefault();
          bridge.goForward();
        }
        return;
      }

      // ── Ctrl/Cmd+R → reload ──────────────────────────────────────────────
      if (mod && !e.shiftKey && !e.altKey && (e.key === "r" || e.key === "R")) {
        if (bridge) {
          e.preventDefault();
          bridge.reload();
        }
        return;
      }

      // ── Ctrl/Cmd+1..9 → switch to tab N ──────────────────────────────────
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

      // ── Ctrl+Tab → next tab (Cmd+Tab is OS-reserved on macOS) ────────────
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

      // ── Ctrl+Shift+Tab → previous tab ────────────────────────────────────
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

      // ── Ctrl+Shift+T → reopen last closed tab ────────────────────────────
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

  // Listen for shortcuts forwarded from the browser webview via Rust
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<string>("xevo://shortcut", (e) => {
      const shortcut = e.payload;

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
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [bridge]);
}
