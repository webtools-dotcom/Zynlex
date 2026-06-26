/**
 * useWebviewBridge - manages per-tab browser WebviewWindow bridge.
 *
 * Architecture: each tab gets its own WebviewWindow (label "browser-{tabId}").
 * Tab switching = hide old webview + show new (no reload, state preserved).
 *
 * Responsibilities:
 * - Creates webviews lazily on first navigation
 * - Activates (hide/show) on tab switch
 * - Closes webviews on tab close
 * - Keeps active tab's webview bounds in sync with the content area
 * - Subscribes to per-tab events from Rust and updates Zustand
 * - Exposes navigate / goBack / goForward / reload actions
 */
import { useEffect, useRef, useCallback, useMemo } from "react";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useUIStore } from "@/stores/ui";
import {
  createTab,
  activateTab,
  navigateTab,
  setWebviewBounds,
  repositionWebview,
  hideTabWebview,
  showTabWebview,
  webviewGoBack,
  webviewGoForward,
  webviewReload,
  stopLoading,
  setWebviewTheme,
  onUrlChanged,
  onLoadingChanged,
  onTabInfoChanged,
  onBookmarkRequest,
  onNetworkEntry,
  onInspectorData,
  type BrowserBounds,
} from "@/services/browser";
import { useSettingsStore } from "@/stores/settings";
import { useHistoryStore } from "@/stores/history";
import { useNetworkStore } from "@/stores/network";
import { useInspectorStore } from "@/stores/inspector";
import type { MetaInfo, CookieEntry, StorageEntry } from "@/types";
import {
  getLiveWorkspaceActiveTab,
  getLiveWorkspaceActiveTabId,
} from "@/lib/workspaceTabs";
import { toggleBookmarkForActiveTab } from "@/lib/bookmarkAction";
import { getCurrentWindow } from "@tauri-apps/api/window";

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const IS_WINDOWS =
  typeof navigator !== "undefined" &&
  /Windows|Win32|Win64|WOW64/i.test(
    `${navigator.userAgent} ${navigator.platform}`
  );
// Compensates for a known Tauri/WebView2 child-webview positioning bug:
// the native webview's actual rendered position drifts from the CSS
// bounds we compute, by a DIFFERENT amount on each edge. This is an
// unresolved upstream issue (not something we can fix from here), so we
// calibrate it empirically per edge instead of one symmetric number.
//
//   POSITIVE value = INSET  -> shrinks the webview inward.
//                              Use this on an edge where the webview
//                              currently overflows past the chrome.
//   NEGATIVE value = BLEED  -> expands the webview outward.
//                              Use this on an edge where there's a
//                              visible gap between the webview and chrome.
//
// Change ONE value at a time, rebuild, and check only that edge.
const WEBVIEW_EDGE_INSET = {
  top: -4,
  right: -4,
  bottom: 4,
  left: -4,
};

/**
 * Computes the native webview's screen-space bounds from the content
 * area's DOMRect, applying the per-edge calibration above. Every place
 * that positions or resizes the webview goes through this single
 * function — so tuning WEBVIEW_EDGE_INSET fixes the gap everywhere at
 * once, instead of needing the same edit repeated in five places.
 */
function computeWebviewBounds(rect: DOMRect, overlayH: number): BrowserBounds {
  const inset = IS_WINDOWS
    ? WEBVIEW_EDGE_INSET
    : { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    x: Math.round(rect.left + window.screenX + inset.left),
    y: Math.round(rect.top + window.screenY + overlayH + inset.top),
    width: Math.round(Math.max(1, rect.width - inset.left - inset.right)),
    height: Math.round(
      Math.max(1, rect.height - overlayH - inset.top - inset.bottom)
    ),
  };
}

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

  // Track last bounds to avoid redundant Rust calls
  const lastBoundsRef = useRef<BrowserBounds | null>(null);
  // Track when loading started so we can report load time on completion.
  const loadStartRef = useRef<number | null>(null);
  // Track maximize state to detect maximize/restore transitions.
  const wasMaximizedRef = useRef(false);
  // Throttle onMoved to avoid spamming Rust during drag (~60 events/sec).
  const lastMoveRef = useRef(0);
  // Track minimize state — suppress syncBounds while minimized.
  const isMinimizedRef = useRef(false);
  // Track which tabs have been created (have a WebviewWindow).
  const createdTabsRef = useRef<Set<string>>(new Set());

  // ── Ref-based syncBounds ──────────────────────────────────────────
  const syncBoundsRef = useRef<() => void>(() => {});
  syncBoundsRef.current = () => {
    if (!IS_TAURI) return;
    if (isMinimizedRef.current) return;
    const tabId = useWorkspacesStore.getState().workspaces[
      useWorkspacesStore.getState().activeWorkspaceId
    ]?.activeTabId;
    if (!tabId) return;
    const el = contentAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const ui = useUIStore.getState();
    const overlayH =
      ui.overlayPanel !== "none" ? ui.overlayHeight * rect.height : 0;
    const bounds: BrowserBounds = computeWebviewBounds(rect, overlayH);
    const last = lastBoundsRef.current;
    if (
      last &&
      Math.abs(last.x - bounds.x) < 5 &&
      Math.abs(last.y - bounds.y) < 5 &&
      Math.abs(last.width - bounds.width) < 5 &&
      Math.abs(last.height - bounds.height) < 5
    ) {
      return;
    }
    lastBoundsRef.current = bounds;
    setWebviewBounds(tabId, bounds).catch(() => {});
  };

  const syncBounds = useCallback(() => syncBoundsRef.current(), []);

  // Show the active tab's webview with fresh bounds.
  const ensureWebviewVisible = useCallback(
    (attempt = 0) => {
      if (isChromeOverlayOpen()) return;
      const tabId = useWorkspacesStore.getState().workspaces[
        useWorkspacesStore.getState().activeWorkspaceId
      ]?.activeTabId;
      if (!tabId) return;
      const el = contentAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) {
        if (attempt < 8) {
          setTimeout(() => ensureWebviewVisible(attempt + 1), 50);
        }
        return;
      }
      const ui = useUIStore.getState();
      const overlayH =
        ui.overlayPanel !== "none" ? ui.overlayHeight * rect.height : 0;
      const bounds: BrowserBounds = computeWebviewBounds(rect, overlayH);
      showTabWebview(tabId, bounds).catch(() => {});
    },
    [contentAreaRef]
  );

  // Navigate action (called by AddressBar on Enter).
  const navigate = useCallback(
    async (url: string) => {
      if (!IS_TAURI) {
        if (activeTabId) {
          updateTab(activeTabId, { url, title: url, isLoading: false });
        }
        return;
      }
      const el = contentAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      const ui = useUIStore.getState();
      const overlayH =
        ui.overlayPanel !== "none" ? ui.overlayHeight * rect.height : 0;
      const bounds: BrowserBounds = computeWebviewBounds(rect, overlayH);
      const displayTitle = url
        .replace(/^https?:\/\/(www\.)?/, "")
        .split("/")[0];
      try {
        if (activeTabId) {
          updateTab(activeTabId, {
            url,
            isLoading: true,
            title: displayTitle,
          });

          if (createdTabsRef.current.has(activeTabId)) {
            // Webview already exists — just navigate it
            await navigateTab(activeTabId, url);
          } else {
            // First navigation — create the webview
            await createTab(activeTabId, url, bounds);
            createdTabsRef.current.add(activeTabId);
          }
        }
        useHistoryStore.getState().addEntry({
          url,
          title: displayTitle,
          favicon: null,
          timestamp: Date.now(),
          workspaceId: useWorkspacesStore.getState().activeWorkspaceId,
        });
      } catch {
        if (activeTabId) {
          updateTab(activeTabId, { isLoading: false });
        }
      }
    },
    [activeTabId, updateTab, contentAreaRef]
  );

  const goBack = useCallback(async () => {
    if (!IS_TAURI) return;
    const tabId = activeTabId ?? getLiveWorkspaceActiveTabId(
      useWorkspacesStore.getState().workspaces[useWorkspacesStore.getState().activeWorkspaceId],
      useTabsStore.getState().tabs
    );
    if (!tabId) return;
    await webviewGoBack(tabId);
  }, [activeTabId]);

  const goForward = useCallback(async () => {
    if (!IS_TAURI) return;
    const tabId = activeTabId ?? getLiveWorkspaceActiveTabId(
      useWorkspacesStore.getState().workspaces[useWorkspacesStore.getState().activeWorkspaceId],
      useTabsStore.getState().tabs
    );
    if (!tabId) return;
    await webviewGoForward(tabId);
  }, [activeTabId]);

  const reload = useCallback(async (overrideTabId?: string) => {
    if (!IS_TAURI) return;
    const tabId = overrideTabId ?? activeTabId ?? getLiveWorkspaceActiveTabId(
      useWorkspacesStore.getState().workspaces[useWorkspacesStore.getState().activeWorkspaceId],
      useTabsStore.getState().tabs
    );
    if (!tabId) return;
    await webviewReload(tabId);
  }, [activeTabId]);

  const stopLoadingAction = useCallback(async () => {
    if (!IS_TAURI) return;
    const tabId = activeTabId ?? getLiveWorkspaceActiveTabId(
      useWorkspacesStore.getState().workspaces[useWorkspacesStore.getState().activeWorkspaceId],
      useTabsStore.getState().tabs
    );
    if (!tabId) return;
    await stopLoading(tabId);
  }, [activeTabId]);

  // ── Subscribe to Rust events (per-tab) ──────────────────────────
  useEffect(() => {
    if (!IS_TAURI) return;
    let unUrl: (() => void) | null = null;
    let unLoading: (() => void) | null = null;
    let unTabInfo: (() => void) | null = null;
    let unBookmark: (() => void) | null = null;
    let unNetworkEntry: (() => void) | null = null;
    let unInspectorData: (() => void) | null = null;

    onBookmarkRequest(() => {
      toggleBookmarkForActiveTab();
    }).then((fn) => {
      unBookmark = fn;
    });

    onUrlChanged((tabId, url) => {
      useTabsStore.getState().updateTab(tabId, { url });
      // Record to global history
      const wsState = useWorkspacesStore.getState();
      useHistoryStore.getState().addEntry({
        url,
        title: url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0],
        favicon: null,
        timestamp: Date.now(),
        workspaceId: wsState.activeWorkspaceId,
      });
    }).then((fn) => {
      unUrl = fn;
    });

    onLoadingChanged((tabId, loading) => {
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
    }).then((fn) => {
      unLoading = fn;
    });

    onTabInfoChanged((tabId, info) => {
      useTabsStore
        .getState()
        .updateTab(tabId, { title: info.title, favicon: info.favicon ?? null });
      if (info.url) {
        useTabsStore.getState().updateTab(tabId, { url: info.url });
      }
    }).then((fn) => {
      unTabInfo = fn;
    });

    // Network log entries from webview init script
    onNetworkEntry((entry) => {
      useNetworkStore.getState().addEntry(entry);
    }).then((fn) => {
      unNetworkEntry = fn;
    });

    // Inspector data from browser_eval_inspector
    onInspectorData((event) => {
      const store = useInspectorStore.getState();
      store.setIsLoading(false);
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.error) {
          store.setError(parsed.error);
          return;
        }
        store.setError(null);

        switch (event.dataType) {
          case "meta":
            store.setMeta(parsed as MetaInfo);
            break;
          case "cookies":
            store.setCookies(parsed.cookies as CookieEntry[]);
            break;
          case "localStorage":
            store.setLocalStorage(parsed.items as StorageEntry[]);
            break;
          case "sessionStorage":
            store.setSessionStorage(parsed.items as StorageEntry[]);
            break;
        }
      } catch {
        store.setError("Failed to parse inspector data");
      }
    }).then((fn) => {
      unInspectorData = fn;
    });

    return () => {
      unUrl?.();
      unLoading?.();
      unTabInfo?.();
      unBookmark?.();
      unNetworkEntry?.();
      unInspectorData?.();
    };
  }, []);

  // ── TAB SWITCHING: activate the target tab's webview ─────────────
  // No navigation! Just hide old + show new. State is preserved.
  useEffect(() => {
    if (!IS_TAURI) return;
    if (!activeTabId) return;

    const tabUrl = activeTab?.url ?? "";

    if (!tabUrl) {
      // Empty tab -> hide the currently active webview so the HomePage shows.
      // Find which tab was previously active by checking all created tabs.
      // We hide all browser webviews except we can't know which was visible.
      // Simplest: hide all created webviews.
      for (const tid of createdTabsRef.current) {
        hideTabWebview(tid).catch(() => {});
      }
      return;
    }

    // Tab has a URL -> activate its webview (create if needed)
    const el = contentAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const ui = useUIStore.getState();
    const overlayH =
      ui.overlayPanel !== "none" ? ui.overlayHeight * rect.height : 0;
    const bounds: BrowserBounds = computeWebviewBounds(rect, overlayH);

    activateTab(activeTabId, tabUrl, bounds)
      .then(() => {
        createdTabsRef.current.add(activeTabId);
      })
      .catch(() => {});

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  // ── ResizeObserver: sync bounds when content area or window resizes ──
  useEffect(() => {
    if (!IS_TAURI) return;
    const el = contentAreaRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      syncBounds();
    });
    observer.observe(el);
    observer.observe(document.documentElement);
    syncBounds();
    return () => observer.disconnect();
  }, [contentAreaRef, syncBounds]);

  // ── Window move + resize listeners ────────────────────────────────
  useEffect(() => {
    if (!IS_TAURI) return;
    let unmove: (() => void) | null = null;
    let unresize: (() => void) | null = null;

    getCurrentWindow()
      .onMoved(() => {
        const now = performance.now();
        if (now - lastMoveRef.current < 16) return;
        lastMoveRef.current = now;
        requestAnimationFrame(() => syncBoundsRef.current());
      })
      .then((fn) => {
        unmove = fn;
      });

    getCurrentWindow()
      .onResized(() => {
        setTimeout(() => syncBoundsRef.current(), 50);
      })
      .then((fn) => {
        unresize = fn;
      });

    return () => {
      unmove?.();
      unresize?.();
    };
  }, []);

  // ── Minimize state listener ──────────────────────────────────────
  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisten = getCurrentWindow().listen<boolean>("xevo://minimize-state", (event) => {
      isMinimizedRef.current = event.payload;
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // ── Detect maximize/restore transitions ──────────────────────────
  useEffect(() => {
    if (!IS_TAURI) return;
    let disposed = false;
    const unlisten = getCurrentWindow().onResized(async () => {
      if (disposed) return;
      const isMax = await getCurrentWindow().isMaximized();
      if (wasMaximizedRef.current !== isMax) {
        wasMaximizedRef.current = isMax;
        lastBoundsRef.current = null;
        setTimeout(() => syncBoundsRef.current(), 60);
      }
    });
    return () => {
      disposed = true;
      unlisten.then((fn) => fn?.());
    };
  }, []);

  // ── Reposition on sidebar toggle ────────────────────────────────
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  useEffect(() => {
    if (!IS_TAURI) return;
    const timer = setTimeout(() => {
      const wsState = useWorkspacesStore.getState();
      const ws = wsState.workspaces[wsState.activeWorkspaceId];
      const tab = getLiveWorkspaceActiveTab(ws, useTabsStore.getState().tabs);
      if (!tab?.url) return;
      const el = contentAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      const ui = useUIStore.getState();
      const overlayH =
        ui.overlayPanel !== "none" ? ui.overlayHeight * rect.height : 0;
      const bounds = computeWebviewBounds(rect, overlayH);
      repositionWebview(
        tab.id,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height
      ).catch(() => {});
    }, 80);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarOpen]);

  // ── Hide/show webview when chrome overlays open ──────────────────
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const shortcutHelpOpen = useUIStore((s) => s.shortcutHelpOpen);
  const settingsPanelOpen = useUIStore((s) => s.settingsPanelOpen);
  const apiTesterOpen = useUIStore((s) => s.apiTesterOpen);
  const findOpen = useUIStore((s) => s.findOpen);
  const overlayPanel = useUIStore((s) => s.overlayPanel);
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
      hideTabWebview(tab!.id).catch(() => {});
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

  // ── Sync bounds when overlay panel opens/closes/resizes ──────────
  useEffect(() => {
    if (!IS_TAURI) return;
    const wsState = useWorkspacesStore.getState();
    const ws = wsState.workspaces[wsState.activeWorkspaceId];
    const tab = getLiveWorkspaceActiveTab(ws, useTabsStore.getState().tabs);
    if (!tab?.url) return;
    const timer = setTimeout(() => {
      syncBounds();
    }, 50);
    return () => clearTimeout(timer);
  }, [overlayPanel, syncBounds]);

  // ── Sync bounds when overlay is drag-resized ─────────────────────
  const overlayHeight = useUIStore((s) => s.overlayHeight);
  useEffect(() => {
    if (!IS_TAURI) return;
    const ui = useUIStore.getState();
    if (ui.overlayPanel === "none") return;
    const wsState = useWorkspacesStore.getState();
    const ws = wsState.workspaces[wsState.activeWorkspaceId];
    const tab = getLiveWorkspaceActiveTab(ws, useTabsStore.getState().tabs);
    if (!tab?.url) return;
    const timer = setTimeout(() => syncBounds(), 30);
    return () => clearTimeout(timer);
  }, [overlayHeight, syncBounds]);

  // ── Sync theme to all browser webviews ───────────────────────────
  const theme = useSettingsStore((s) => s.settings.theme);
  useEffect(() => {
    if (!IS_TAURI) return;
    let resolved: "light" | "dark" = theme === "light" ? "light" : "dark";
    if (theme === "system") {
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    setWebviewTheme(resolved).catch(() => {});
  }, [theme]);

  return useMemo(
    () => ({
      navigate,
      goBack,
      goForward,
      reload,
      syncBounds,
      stopLoading: stopLoadingAction,
    }),
    [navigate, goBack, goForward, reload, syncBounds, stopLoadingAction]
  );
}