/**
 * useWebviewBridge - manages the browser WebviewWindow bridge.
 *
 * Responsibilities:
 * - Subscribes to URL/loading/tab-info events from Rust and updates Zustand
 * - Navigates the browser window when the active tab changes
 * - Hides the browser window when switching to an empty (no-URL) tab
 * - Keeps browser bounds in sync with the content area element
 * - Exposes navigate / goBack / goForward / reload actions
 */
import { useEffect, useRef, useCallback, useMemo } from "react";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useUIStore } from "@/stores/ui";
import {
  navigateWebview,
  setWebviewBounds,
  hideWebview,
  showWebview,
  webviewReload,
  stopLoading,
  repositionWebview,
  setWebviewTheme,
  onUrlChanged,
  onLoadingChanged,
  onTabInfoChanged,
  onBookmarkRequest,
  type BrowserBounds,
} from "@/services/browser";
import { useSettingsStore } from "@/stores/settings";
import {
  getLiveWorkspaceActiveTab,
  getLiveWorkspaceActiveTabId,
} from "@/lib/workspaceTabs";
import { toggleBookmarkForActiveTab } from "@/lib/bookmarkAction";
import { getCurrentWindow } from "@tauri-apps/api/window";

// True only when running inside the Tauri desktop app, not in browser dev mode
const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Any React chrome overlay that must sit above the OS-level browser webview. */
function isChromeOverlayOpen(): boolean {
  const ui = useUIStore.getState();
  return (
    ui.commandPaletteOpen ||
    ui.shortcutHelpOpen ||
    ui.settingsPanelOpen ||
    ui.apiTesterOpen ||
    ui.findOpen
  );
}

export function useWebviewBridge(
  contentAreaRef: React.RefObject<HTMLDivElement | null>
) {
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const tabs = useTabsStore((s) => s.tabs);
  const updateTab = useTabsStore((s) => s.updateTab);

  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);
  const activeTabId = activeTab?.id ?? null;

  // Prevent re-entrant tab-switch navigation
  const isSwitchingTabRef = useRef(false);
  // Track last bounds to avoid redundant Rust calls
  const lastBoundsRef = useRef<BrowserBounds | null>(null);
  // Track the previously active tab id so we can save its URL to history
  // before switching away.
  const prevActiveTabIdRef = useRef<string | null>(null);
  // Track when loading started so we can report load time on completion.
  const loadStartRef = useRef<number | null>(null);

  // Compute bounds from the content area DOM element.
  // Returns screen-relative LOGICAL (CSS) pixels. Tauri 2's
  // WebviewWindowBuilder + WebviewWindow::set_position(Logical) APIs
  // expect logical pixels; the OS scales to physical via DPI. The
  // browser window is a top-level window (parent: main) so it needs
  // absolute screen coordinates. window.screenX/Y give the viewport's
  // top-left in CSS pixels (Tauri 2 WebView2, not the OS window's
  // frame top-left like a normal browser), so adding rect.left/top
  // directly yields the correct content-area screen position.
  const getBounds = useCallback((): BrowserBounds | null => {
    const el = contentAreaRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return null;
    const bounds = {
      x: Math.round(rect.left + window.screenX),
      y: Math.round(rect.top + window.screenY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    console.log("[XEVO-BOUNDS]", {
      rect: {
        left: rect.left, top: rect.top,
        width: rect.width, height: rect.height,
      },
      screenX: window.screenX, screenY: window.screenY,
      computed: bounds,
    });
    return bounds;
  }, [contentAreaRef]);

  // Sync bounds with Rust (called on resize).
  // 5px threshold filters tiny relayout jitter so we do not spam Rust with
  // redundant bounds updates.
  const syncBounds = useCallback(async () => {
    if (!IS_TAURI) return;
    const bounds = getBounds();
    if (!bounds) return;
    const last = lastBoundsRef.current;
    if (
      last &&
      Math.abs(last.x - bounds.x) < 5 &&
      Math.abs(last.y - bounds.y) < 5 &&
      Math.abs(last.width - bounds.width) < 5 &&
      Math.abs(last.height - bounds.height) < 5
    ) {
      return; // No meaningful change (filters 2px browser-window relayout shift)
    }
    lastBoundsRef.current = bounds;
    try {
      await setWebviewBounds(bounds);
    } catch {
      // Bounds sync failed - not critical
    }
  }, [getBounds]);

  // Show the browser webview with fresh bounds. Retries when layout
  // has not settled yet (getBounds returns null briefly after mount).
  const ensureWebviewVisible = useCallback(
    (attempt = 0) => {
      // Never re-show the webview while a chrome overlay is open — that
      // would paint the OS webview on top of Ctrl+K / Ctrl+F / etc.
      if (isChromeOverlayOpen()) return;

      const bounds = getBounds();
      if (bounds) {
        showWebview(bounds).catch(() => {});
        return;
      }
      if (attempt < 8) {
        setTimeout(() => ensureWebviewVisible(attempt + 1), 50);
      }
    },
    [getBounds]
  );

  // Navigate action (called by AddressBar on Enter).
  // Re-read bounds first so the browser window stays aligned with the
  // content area when the active tab changes.
  const navigate = useCallback(
    async (url: string) => {
      if (!IS_TAURI) {
        // In browser dev mode: just update tab state visually
        if (activeTabId) {
          updateTab(activeTabId, { url, title: url, isLoading: false });
        }
        return;
      }
      const bounds = getBounds();
      if (!bounds) return;
      try {
        if (activeTabId) {
          // Save the current URL to the tab's back stack before navigating
          // away. This makes the previous page reachable via goBack().
          const currentTab = useTabsStore.getState().tabs[activeTabId];
          if (currentTab && currentTab.url) {
            useTabsStore.getState().recordNavigation(activeTabId, currentTab.url);
          }
          // Show the URL domain (e.g. "google.com") as the tab title
          // immediately. document.title from the page can take 1-2s to
          // arrive via Rust, and "New Tab" is a poor placeholder.
          const displayTitle = url
            .replace(/^https?:\/\/(www\.)?/, "")
            .split("/")[0];
          updateTab(activeTabId, {
            url,
            isLoading: true,
            title: displayTitle,
          });
        }
        await navigateWebview(url, bounds);
        ensureWebviewVisible();
      } catch {
        if (activeTabId) {
          updateTab(activeTabId, { isLoading: false });
        }
      }
    },
    [activeTabId, updateTab, getBounds, ensureWebviewVisible]
  );

  const goBack = useCallback(async () => {
    if (!IS_TAURI) return;
    const tabId = activeTabId ?? getLiveWorkspaceActiveTabId(
      useWorkspacesStore.getState().workspaces[useWorkspacesStore.getState().activeWorkspaceId],
      useTabsStore.getState().tabs
    );
    if (!tabId) return;
    const prevUrl = useTabsStore.getState().popBack(tabId);
    if (!prevUrl) return;
    const bounds = getBounds();
    if (!bounds) return;
    isSwitchingTabRef.current = true;
    try {
      await navigateWebview(prevUrl, bounds);
    } finally {
      setTimeout(() => { isSwitchingTabRef.current = false; }, 500);
    }
  }, [activeTabId, getBounds]);

  const goForward = useCallback(async () => {
    if (!IS_TAURI) return;
    const tabId = activeTabId ?? getLiveWorkspaceActiveTabId(
      useWorkspacesStore.getState().workspaces[useWorkspacesStore.getState().activeWorkspaceId],
      useTabsStore.getState().tabs
    );
    if (!tabId) return;
    const nextUrl = useTabsStore.getState().popForward(tabId);
    if (!nextUrl) return;
    const bounds = getBounds();
    if (!bounds) return;
    isSwitchingTabRef.current = true;
    try {
      await navigateWebview(nextUrl, bounds);
    } finally {
      setTimeout(() => { isSwitchingTabRef.current = false; }, 500);
    }
  }, [activeTabId, getBounds]);

  const reload = useCallback(async () => {
    if (IS_TAURI) await webviewReload().catch(console.error);
  }, []);

  // Subscribe to Rust events.
  useEffect(() => {
    if (!IS_TAURI) return;
    let unUrl: (() => void) | null = null;
    let unLoading: (() => void) | null = null;
    let unTabInfo: (() => void) | null = null;
    let unBookmark: (() => void) | null = null;

    // The webview's Ctrl+D handler (XEVO_BOOKMARK_SCRIPT) invokes
    // `browser_bookmark_request`, Rust emits `browser://bookmark-request`,
    // and we route it to the shared toggleBookmarkForActiveTab().
    onBookmarkRequest(() => {
      toggleBookmarkForActiveTab();
    }).then((fn) => {
      unBookmark = fn;
    });

    onUrlChanged((url) => {
      // Skip URL updates that we ourselves triggered via tab switching
      if (isSwitchingTabRef.current) return;
      const state = useWorkspacesStore.getState();
      const tabId = getLiveWorkspaceActiveTabId(
        state.workspaces[state.activeWorkspaceId],
        useTabsStore.getState().tabs
      );
      if (tabId) {
        const currentTab = useTabsStore.getState().tabs[tabId];
        if (currentTab && currentTab.url && currentTab.url !== url) {
          useTabsStore.getState().recordNavigation(tabId, currentTab.url);
        }
        useTabsStore.getState().updateTab(tabId, { url, title: url });
      }
    }).then((fn) => {
      unUrl = fn;
    });

    onLoadingChanged((loading) => {
      const state = useWorkspacesStore.getState();
      const tabId = getLiveWorkspaceActiveTabId(
        state.workspaces[state.activeWorkspaceId],
        useTabsStore.getState().tabs
      );
      if (tabId) {
        if (loading) {
          loadStartRef.current = Date.now();
          useTabsStore.getState().updateTab(tabId, { isLoading: true });
        } else {
          const elapsed = loadStartRef.current !== null
            ? Date.now() - loadStartRef.current
            : null;
          loadStartRef.current = null;
          useTabsStore.getState().updateTab(tabId, {
            isLoading: false,
            loadTime: elapsed,
          });
        }
      }
    }).then((fn) => {
      unLoading = fn;
    });

    onTabInfoChanged((info) => {
      const state = useWorkspacesStore.getState();
      const tabId = getLiveWorkspaceActiveTabId(
        state.workspaces[state.activeWorkspaceId],
        useTabsStore.getState().tabs
      );
      if (!tabId) return;
      useTabsStore
        .getState()
        .updateTab(tabId, { title: info.title, favicon: info.favicon ?? null });
      if (!isSwitchingTabRef.current) {
        const currentTab = useTabsStore.getState().tabs[tabId];
        if (currentTab && currentTab.url !== info.url) {
          useTabsStore.getState().updateTab(tabId, { url: info.url });
        }
      }
    }).then((fn) => {
      unTabInfo = fn;
    });

    return () => {
      unUrl?.();
      unLoading?.();
      unTabInfo?.();
      unBookmark?.();
    };
  }, []);

  // TAB SWITCHING: navigate the browser window when the active tab changes.
  // The WebviewWindow is a single persistent instance built once per
  // session via WebviewWindowBuilder. On tab switch we just call
  // navigateWebview(url, bounds).
  useEffect(() => {
    if (!IS_TAURI) return;

    const tabUrl = activeTab?.url ?? "";

    // Before switching away from the previous tab, save its current URL
    // to that tab's back stack so Back can return to it.
    const prevTabId = prevActiveTabIdRef.current;
    if (prevTabId && prevTabId !== activeTabId) {
      const prevTab = useTabsStore.getState().tabs[prevTabId];
      if (prevTab && prevTab.url) {
        useTabsStore.getState().recordNavigation(prevTabId, prevTab.url);
      }
    }
    prevActiveTabIdRef.current = activeTabId;

    if (!tabUrl) {
      // Empty tab -> hide the browser window so the placeholder shows
      hideWebview().catch(() => {
        // Webview might not exist yet (first launch) - that's fine
      });
      return;
    }

    // Tab has a URL -> navigate browser window to it. Guard prevents the
    // navigation's on_navigation echo from overwriting the tab URL with a
    // redirect destination for ~500ms after the navigate fires.
    isSwitchingTabRef.current = true;

    const showTimer = setTimeout(() => {
      const bounds = getBounds();
      if (!bounds) {
        isSwitchingTabRef.current = false;
        return;
      }
      navigateWebview(tabUrl, bounds)
        .then(() => ensureWebviewVisible())
        .finally(() => {
          setTimeout(() => {
            isSwitchingTabRef.current = false;
          }, 500);
        });
    }, 100);

    return () => clearTimeout(showTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]); // Only fire when the ACTIVE TAB ID changes

  // ResizeObserver: sync bounds when the content area or window resizes.
  useEffect(() => {
    if (!IS_TAURI) return;
    const el = contentAreaRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      syncBounds();
    });
    observer.observe(el);
    // Also observe documentElement so window resizes propagate too.
    // The browser window is positioned independently from the React tree,
    // so the root element can change its target bounds even when the content
    // area element itself does not.
    observer.observe(document.documentElement);
    syncBounds(); // Initial sync
    return () => observer.disconnect();
  }, [contentAreaRef, syncBounds]);

  // Listen for main window moves. ResizeObserver only fires on size
  // changes, not position changes, so dragging the OS window leaves the
  // browser out of sync until the next resize. The onMoved event gives
  // us the new viewport origin in CSS pixels; syncBounds re-derives
  // absolute bounds from the current rect.
  useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten: (() => void) | null = null;
    getCurrentWindow()
      .onMoved(() => {
        syncBounds();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [syncBounds]);

  // Reposition webview when sidebar toggles (content area changes size)
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  useEffect(() => {
    if (!IS_TAURI) return;
    const timer = setTimeout(() => {
      const bounds = getBounds();
      if (!bounds) return;
      const wsState = useWorkspacesStore.getState();
      const ws = wsState.workspaces[wsState.activeWorkspaceId];
      const tab = getLiveWorkspaceActiveTab(ws, useTabsStore.getState().tabs);
      if (tab?.url) {
        repositionWebview(bounds.x, bounds.y, bounds.width, bounds.height).catch(() => {});
      }
    }, 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarOpen]);

  // Hide/show webview when chrome overlays open. The browser WebviewWindow is
  // a separate OS surface above the React content area — the only way to keep
  // Ctrl+K / Ctrl+F / settings / etc. visible is to hide the webview first.
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const shortcutHelpOpen = useUIStore((s) => s.shortcutHelpOpen);
  const settingsPanelOpen = useUIStore((s) => s.settingsPanelOpen);
  const apiTesterOpen = useUIStore((s) => s.apiTesterOpen);
  const findOpen = useUIStore((s) => s.findOpen);
  useEffect(() => {
    if (!IS_TAURI) return;
    const overlayOpen =
      commandPaletteOpen ||
      shortcutHelpOpen ||
      settingsPanelOpen ||
      apiTesterOpen ||
      findOpen;
    const wsState = useWorkspacesStore.getState();
    const ws = wsState.workspaces[wsState.activeWorkspaceId];
    const tab = getLiveWorkspaceActiveTab(ws, useTabsStore.getState().tabs);
    const hasUrl = !!tab?.url;

    if (overlayOpen && hasUrl) {
      hideWebview().catch(() => {});
      return;
    }

    if (!overlayOpen && hasUrl) {
      const timer = setTimeout(() => ensureWebviewVisible(), 50);
      return () => clearTimeout(timer);
    }
  }, [
    commandPaletteOpen,
    shortcutHelpOpen,
    settingsPanelOpen,
    apiTesterOpen,
    findOpen,
    activeTabId,
    ensureWebviewVisible,
  ]);

  // Sync color-scheme to the browser webview when theme changes
  const theme = useSettingsStore((s) => s.settings.theme);
  useEffect(() => {
    if (!IS_TAURI) return;
    const wsState = useWorkspacesStore.getState();
    const ws = wsState.workspaces[wsState.activeWorkspaceId];
    const tab = getLiveWorkspaceActiveTab(ws, useTabsStore.getState().tabs);
    if (!tab?.url) return;

    let resolved: "light" | "dark" = theme === "light" ? "light" : "dark";
    if (theme === "system") {
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    setWebviewTheme(resolved).catch(() => {});
  }, [theme, activeTab?.url]);

  return useMemo(
    () => ({ navigate, goBack, goForward, reload, syncBounds, stopLoading }),
    [navigate, goBack, goForward, reload, syncBounds]
  );
}
