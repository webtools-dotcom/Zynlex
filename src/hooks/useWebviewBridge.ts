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
  navigateTab,
  setWebviewBounds,
  repositionWebview,
  hideTabWebview,
  showTabWebview,
  closeTabWebview,
  webviewGoBack,
  webviewGoForward,
  webviewReload,
  stopLoading,
  setWebviewTheme,
  onUrlChanged,
  onLoadingChanged,
  onTabInfoChanged,
  onBookmarkRequest,
  onNewTabRequested,
  onInspectorData,
  updateHeaderRules,
  setMemoryTarget,
  saveTabState,
  restoreTabState,
  type BrowserBounds,
} from "@/services/browser";
import { useSettingsStore } from "@/stores/settings";
import { useHistoryStore } from "@/stores/history";
import { useHeadersStore } from "@/stores/headers";
import { useInspectorStore } from "@/stores/inspector";
import type { MetaInfo, CookieEntry, StorageEntry } from "@/types";
import {
  getLiveWorkspaceActiveTab,
  getLiveWorkspaceActiveTabId,
} from "@/lib/workspaceTabs";
import { toggleBookmarkForActiveTab } from "@/lib/bookmarkAction";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { onNetworkEntry } from "@/services/browser";
import { useNetworkStore } from "@/stores/network";

let _netEntryId = 0;

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const IS_WINDOWS =
  typeof navigator !== "undefined" &&
  /Windows|Win32|Win64|WOW64/i.test(navigator.userAgent);
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
  top: 1.5,
  right: 7.5,
  bottom: 4,
  left: -5.5,
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
  const viewportMode = useUIStore((s) => s.viewportMode);

  // Track last bounds to avoid redundant Rust calls
  const lastBoundsRef = useRef<BrowserBounds | null>(null);
  // Track when loading started so we can report load time on completion.
  const loadStartRef = useRef<number | null>(null);
  // Track minimize state — suppress syncBounds while minimized.
  const isMinimizedRef = useRef(false);
  // Debounce timers for window resize event
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longResizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Throttle onMoved to avoid spamming Rust during drag (~60 events/sec).
  const lastMoveRef = useRef(0);
  // Track which tabs have been created (have a WebviewWindow).
  const createdTabsRef = useRef<Set<string>>(new Set());
  const prevActiveTabIdRef = useRef<string | null>(null);
  // Diagnostic: which trigger initiated the current syncBounds call.
  const syncTriggerRef = useRef<string>("initial");

  // ── Ref-based syncBounds ──────────────────────────────────────────
  const syncBoundsRef = useRef<() => void>(() => {});
  syncBoundsRef.current = () => {
    if (!IS_TAURI) return;
    if (isMinimizedRef.current) {
      console.log("[XEVO-BOUNDS] SKIP (isMinimized)", syncTriggerRef.current);
      return;
    }
    if (useUIStore.getState().viewportMode) return;
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
    const trigger = syncTriggerRef.current;
    const now = Date.now() % 100000;
    if (
      last &&
      Math.abs(last.x - bounds.x) < 5 &&
      Math.abs(last.y - bounds.y) < 5 &&
      Math.abs(last.width - bounds.width) < 5 &&
      Math.abs(last.height - bounds.height) < 5
    ) {
      console.log(
        `[XEVO-BOUNDS] BLOCKED (${trigger}) t=${now}`,
        "last:", last,
        "computed:", bounds,
        "deltas:", {
          dx: Math.abs(last.x - bounds.x),
          dy: Math.abs(last.y - bounds.y),
          dw: Math.abs(last.width - bounds.width),
          dh: Math.abs(last.height - bounds.height),
        }
      );
      return;
    }
    console.log(
      `[XEVO-BOUNDS] SYNC (${trigger}) t=${now}`,
      "computed:", bounds,
      "last:", last,
      "rect:", { l: rect.left, t: rect.top, w: rect.width, h: rect.height },
      "screen:", { sx: window.screenX, sy: window.screenY },
      "overlayH:", overlayH
    );
    lastBoundsRef.current = bounds;
    setWebviewBounds(tabId, bounds).catch((err) => {
      console.error("[XEVO-BOUNDS] Rust setWebviewBounds ERROR:", err, "for bounds:", bounds);
    });
  };

  const syncBounds = useCallback(() => syncBoundsRef.current(), []);

  // Show the active tab's webview with fresh bounds.
  const ensureWebviewVisible = useCallback(
    (attempt = 0) => {
      if (useUIStore.getState().viewportMode) return;
      if (isMinimizedRef.current) return;
      if (isChromeOverlayOpen()) return;
      const tabId = useWorkspacesStore.getState().workspaces[
        useWorkspacesStore.getState().activeWorkspaceId
      ]?.activeTabId;
      if (!tabId) return;
      // Guard: don't try to show a webview that hasn't been created yet.
      // The browser_create_tab command is called lazily on first navigation.
      if (!createdTabsRef.current.has(tabId)) {
        console.log("[XEVO-LIFECYCLE] ensureWebviewVisible — tabId", tabId, "not yet created, skipping");
        return;
      }
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

  useEffect(() => {
    if (!IS_TAURI) return;
    if (viewportMode) {
      lastBoundsRef.current = null;
      for (const tid of createdTabsRef.current) {
        hideTabWebview(tid).catch(() => {});
      }
      return;
    }

    ensureWebviewVisible();
  }, [ensureWebviewVisible, viewportMode]);

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
          useTabsStore.getState().touchTab(activeTabId);

          if (createdTabsRef.current.has(activeTabId)) {
            // Webview already exists — just navigate it
            await navigateTab(activeTabId, url);
          } else {
            // First navigation — create the webview.
            // Reserve slot synchronously BEFORE async call to prevent
            // duplicate creation from concurrent effects (hydration + tab switching).
            createdTabsRef.current.add(activeTabId);
            await createTab(activeTabId, url, bounds);
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
    let cancelled = false;
    let unUrl: (() => void) | null = null;
    let unLoading: (() => void) | null = null;
    let unTabInfo: (() => void) | null = null;
    let unBookmark: (() => void) | null = null;
    let unNewTab: (() => void) | null = null;
    let unInspectorData: (() => void) | null = null;

    onBookmarkRequest(() => {
      toggleBookmarkForActiveTab();
    }).then((fn) => {
      if (cancelled) { fn(); return; }
      unBookmark = fn;
    });

    onNewTabRequested((url) => {
      const wsId = useWorkspacesStore.getState().activeWorkspaceId;
      if (!wsId) return;
      const tabId = useTabsStore.getState().addTab(wsId, { url, title: "New Tab" });
      useWorkspacesStore.getState().addTabToWorkspace(wsId, tabId);
      useWorkspacesStore.getState().setActiveTab(wsId, tabId);
    }).then((fn) => {
      if (cancelled) { fn(); return; }
      unNewTab = fn;
    });

    onUrlChanged((tabId, url) => {
      const prevTab = useTabsStore.getState().tabs[tabId];
      const prevUrl = prevTab?.url;
      if (prevUrl && prevUrl !== url) {
        useTabsStore.getState().recordNavigation(tabId, prevUrl);
      }
      useTabsStore.getState().updateTab(tabId, { url });
      // Record to global history — use the tab's own workspace, not the active one
      const wsState = useWorkspacesStore.getState();
      const tab = useTabsStore.getState().tabs[tabId];
      const wsId = tab?.workspaceId ?? wsState.activeWorkspaceId;
      useHistoryStore.getState().addEntry({
        url,
        title: url.replace(/^https?:\/\/(www\.)?/, "").split("/")[0],
        favicon: null,
        timestamp: Date.now(),
        workspaceId: wsId,
      });
    }).then((fn) => {
      if (cancelled) { fn(); return; }
      unUrl = fn;
    });

    onLoadingChanged((tabId, loading) => {
      if (loading) {
        loadStartRef.current = Date.now();
        useTabsStore.getState().updateTab(tabId, { isLoading: true });
        const allRules = useHeadersStore.getState().rules;
        if (allRules.length > 0) {
          updateHeaderRules(allRules).catch(() => {});
        }
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
      if (cancelled) { fn(); return; }
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
      if (cancelled) { fn(); return; }
      unTabInfo = fn;
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
      if (cancelled) { fn(); return; }
      unInspectorData = fn;
    });



    return () => {
      cancelled = true;
      unUrl?.();
      unLoading?.();
      unTabInfo?.();
      unBookmark?.();
      unNewTab?.();
      unInspectorData?.();
    };
  }, []);

  // ── TAB SWITCHING: activate the target tab's webview ─────────────
  // No navigation! Just hide old + show new. State is preserved.
  useEffect(() => {
    if (!IS_TAURI) return;
    if (!activeTabId) return;

    const prevId = prevActiveTabIdRef.current;
    if (prevId && prevId !== activeTabId && createdTabsRef.current.has(prevId)) {
      setMemoryTarget(prevId, true).catch(() => {});
    }

    if (viewportMode) {
      lastBoundsRef.current = null;
      for (const tid of createdTabsRef.current) {
        hideTabWebview(tid).catch(() => {});
      }
      prevActiveTabIdRef.current = null;
      return;
    }

    const tabUrl = activeTab?.url ?? "";

    // Touch the tab to record last active time
    useTabsStore.getState().touchTab(activeTabId);

    if (!tabUrl) {
      // Empty tab -> hide the currently active webview so the HomePage shows.
      // We hide all browser webviews, and set all to low memory.
      for (const tid of createdTabsRef.current) {
        hideTabWebview(tid).catch(() => {});
        setMemoryTarget(tid, true).catch(() => {});
      }
      prevActiveTabIdRef.current = null;
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

    const setNormal = () => {
      setMemoryTarget(activeTabId!, false).catch(() => {});
    };

    const tab = tabs[activeTabId];
    if (tab?.discardedAt !== null) {
      // Tab was discarded — recreate the webview, then restore.
      // Reserve slot synchronously BEFORE async call.
      createdTabsRef.current.add(activeTabId);
      createTab(activeTabId, tabUrl, bounds)
        .then(() => {
          useTabsStore.getState().restoreTab(activeTabId);
          // Restore saved form state if available
          const updatedTab = useTabsStore.getState().tabs[activeTabId];
          if (updatedTab?.savedFormState) {
            restoreTabState(activeTabId, updatedTab.savedFormState)
              .then(() => {
                // Clear saved state after successful restore
                useTabsStore.getState().saveTabState(activeTabId, null);
              })
              .catch(() => {});
          }
          setNormal();
        })
        .catch(() => {
          createdTabsRef.current.delete(activeTabId);
        });
    } else if (createdTabsRef.current.has(activeTabId)) {
      // Tab has a live webview — hide old, show new. No destroy/recreate.
      if (prevId && prevId !== activeTabId) {
        hideTabWebview(prevId).catch(() => {});
      }
      showTabWebview(activeTabId, bounds)
        .then(() => {
          setNormal();
        })
        .catch(() => {});
    } else {
      // Tab has no webview yet (lazy creation) — create it.
      // Reserve slot synchronously BEFORE async call.
      createdTabsRef.current.add(activeTabId);
      createTab(activeTabId, tabUrl, bounds)
        .then(() => {
          setNormal();
        })
        .catch(() => {
          createdTabsRef.current.delete(activeTabId);
        });
    }

    prevActiveTabIdRef.current = activeTabId;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, viewportMode]);

  // ── TAB DISCARD TIMER: discard inactive tabs after 10 minutes ─────
  useEffect(() => {
    if (!IS_TAURI) return;

    const DISCARD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    const DISCARD_CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

    const interval = setInterval(() => {
      const now = Date.now();
      const tabsState = useTabsStore.getState().tabs;
      const currentActiveTabId = useWorkspacesStore.getState().workspaces[
        useWorkspacesStore.getState().activeWorkspaceId
      ]?.activeTabId;

      for (const [tabId, tab] of Object.entries(tabsState)) {
        // Skip: active tab, already discarded, pinned, no URL, still loading
        if (
          tabId === currentActiveTabId ||
          tab.discardedAt !== null ||
          tab.isPinned ||
          !tab.url ||
          tab.isLoading
        ) {
          continue;
        }

        // Check if this tab has been inactive for longer than the timeout
        if (now - tab.lastActiveAt > DISCARD_TIMEOUT_MS) {
          // Save tab state (scroll + form data) before destroying the webview
          saveTabState(tabId).catch(() => {});
          // Discard: close the webview, mark as discarded, remove from createdTabsRef
          closeTabWebview(tabId)
            .then(() => {
              useTabsStore.getState().discardTab(tabId);
              createdTabsRef.current.delete(tabId);
            })
            .catch(() => {});
        }
      }
    }, DISCARD_CHECK_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // Native user agent changes only apply to newly-created webviews.
  useEffect(() => {
    if (!IS_TAURI) return;

    const recreateForUserAgent = () => {
      console.log("[XEVO-LIFECYCLE] recreateForUserAgent — starting, createdTabs:", Array.from(createdTabsRef.current));
      const wsState = useWorkspacesStore.getState();
      const ws = wsState.workspaces[wsState.activeWorkspaceId];
      const activeTabId = ws ? getLiveWorkspaceActiveTab(ws, useTabsStore.getState().tabs)?.id : null;
      console.log("[XEVO-LIFECYCLE] recreateForUserAgent — activeTabId:", activeTabId);

      const createdIds = Array.from(createdTabsRef.current);
      createdTabsRef.current.clear();

      // Mark all non-active tabs as discarded so their store state is consistent
      const tabsState = useTabsStore.getState().tabs;
      for (const id of createdIds) {
        if (id !== activeTabId && tabsState[id]) {
          console.log("[XEVO-LIFECYCLE] recreateForUserAgent — discarding non-active tab:", id);
          // Save tab state before discarding
          saveTabState(id).catch(() => {});
          useTabsStore.getState().discardTab(id);
        }
      }

      console.log("[XEVO-LIFECYCLE] recreateForUserAgent — closing all", createdIds.length, "webviews:", createdIds);
      Promise.all(createdIds.map((id) => closeTabWebview(id).catch(() => {})))
        .then(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(resolve, 50);
            })
        )
        .then(() => {
          const wsState2 = useWorkspacesStore.getState();
          const ws2 = wsState2.workspaces[wsState2.activeWorkspaceId];
          const tab = getLiveWorkspaceActiveTab(
            ws2,
            useTabsStore.getState().tabs
          );
          if (!tab?.url) return;
          if (tab.discardedAt !== null) {
            useTabsStore.getState().restoreTab(tab.id);
          }
          const el = contentAreaRef.current;
          if (!el) return;
          const rect = el.getBoundingClientRect();
          if (rect.width < 10 || rect.height < 10) return;
          const ui = useUIStore.getState();
          const overlayH =
            ui.overlayPanel !== "none" ? ui.overlayHeight * rect.height : 0;
          const bounds = computeWebviewBounds(rect, overlayH);
          // Reserve slot synchronously BEFORE async call.
          createdTabsRef.current.add(tab.id);
          return createTab(tab.id, tab.url, bounds).catch(() => {
            createdTabsRef.current.delete(tab.id);
          });
        })
        .catch(() => {});
    };

    window.addEventListener("xevo:ua-changed", recreateForUserAgent);
    return () =>
      window.removeEventListener("xevo:ua-changed", recreateForUserAgent);
  }, [contentAreaRef]);

  // ── CAP CONCURRENT WEBVIEWS: enforce soft limit of maxConcurrentWebviews ──
  useEffect(() => {
    if (!IS_TAURI) return;

    const maxConcurrent = useSettingsStore.getState().settings.maxConcurrentWebviews;

    const interval = setInterval(() => {
      const liveCount = createdTabsRef.current.size;
      if (liveCount <= maxConcurrent) return;

      const tabsState = useTabsStore.getState().tabs;
      const currentActiveTabId = useWorkspacesStore.getState().workspaces[
        useWorkspacesStore.getState().activeWorkspaceId
      ]?.activeTabId;

      const candidates = Array.from(createdTabsRef.current)
        .filter((id) => id !== currentActiveTabId)
        .filter((id) => !tabsState[id]?.isPinned)
        .filter((id) => tabsState[id]?.discardedAt === null)
        .sort((a, b) => (tabsState[a]?.lastActiveAt ?? 0) - (tabsState[b]?.lastActiveAt ?? 0));

      const toDiscard = candidates.slice(0, liveCount - maxConcurrent);
      for (const tabId of toDiscard) {
        // Save tab state (scroll + form data) before destroying the webview
        saveTabState(tabId).catch(() => {});
        closeTabWebview(tabId)
          .then(() => {
            useTabsStore.getState().discardTab(tabId);
            createdTabsRef.current.delete(tabId);
          })
          .catch(() => {});
      }
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // ── ResizeObserver: sync bounds when content area or window resizes ──
  useEffect(() => {
    if (!IS_TAURI) return;
    const el = contentAreaRef.current;
    if (!el) return;
    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => { syncTriggerRef.current = "resizeObserver"; syncBounds(); }, 16);
    });
    observer.observe(el);
    observer.observe(document.documentElement);
    syncTriggerRef.current = "resizeObserverInitial";
    syncBounds();
    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      observer.disconnect();
    };
  }, [contentAreaRef, syncBounds]);

  // ── Window move + resize listeners ────────────────────────────────
  useEffect(() => {
    if (!IS_TAURI) return;
    let cancelled = false;
    let unmove: (() => void) | null = null;
    let unresize: (() => void) | null = null;

    getCurrentWindow()
      .onMoved(() => {
        const now = performance.now();
        if (now - lastMoveRef.current < 16) return;
        lastMoveRef.current = now;
        requestAnimationFrame(() => { syncTriggerRef.current = "onMoved"; syncBoundsRef.current(); });
      })
      .then((fn) => {
        if (cancelled) { fn(); return; }
        unmove = fn;
      });

    getCurrentWindow()
      .onResized(() => {
        if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = setTimeout(() => { syncTriggerRef.current = "onResized-50"; syncBoundsRef.current(); }, 50);
        if (longResizeTimerRef.current) clearTimeout(longResizeTimerRef.current);
        longResizeTimerRef.current = setTimeout(() => { syncTriggerRef.current = "onResized-500"; syncBoundsRef.current(); }, 500);
      })
      .then((fn) => {
        if (cancelled) { fn(); return; }
        unresize = fn;
      });

    return () => {
      cancelled = true;
      unmove?.();
      unresize?.();
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
      if (longResizeTimerRef.current) clearTimeout(longResizeTimerRef.current);
    };
  }, []);

  // ── Minimize state listener ──────────────────────────────────────
  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisten = listen<boolean>("xevo://minimize-state", (event) => {
      isMinimizedRef.current = event.payload;
      if (!event.payload) {
        // Just restored from minimize — force bounds sync.
        lastBoundsRef.current = null;
        requestAnimationFrame(() => { syncTriggerRef.current = "minRestore-rAF"; syncBoundsRef.current(); });
        setTimeout(() => {
          lastBoundsRef.current = null;
          syncTriggerRef.current = "minRestore-120";
          syncBoundsRef.current();
        }, 120);
        setTimeout(() => {
          lastBoundsRef.current = null;
          syncTriggerRef.current = "minRestore-500";
          syncBoundsRef.current();
        }, 500);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // ── Network entry listener ────────────────────────────────────────
  useEffect(() => {
    if (!IS_TAURI) return;
    const addEntry = useNetworkStore.getState().addEntry;
    const unlisten = onNetworkEntry((payload) => {
      addEntry({
        id: `net-${++_netEntryId}`,
        reasonPhrase: "",
        resourceType: "other",
        durationMs: 0,
        contentLength: -1,
        ...payload,
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // ── Force-sync from Rust (e.g. after Focused(true) restore) ──────
  useEffect(() => {
    if (!IS_TAURI) return;
    const unlisten = listen("xevo://force-sync", () => {
      console.log("[XEVO-BOUNDS] force-sync event received from Rust");
      lastBoundsRef.current = null;
      syncTriggerRef.current = "forceSync";
      syncBoundsRef.current();
    });
    return () => { unlisten.then((fn) => fn()); };
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
      console.log("[XEVO-BOUNDS] SYNC (sidebarToggle) computed:", bounds);
      repositionWebview(
        tab.id,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height
      ).catch((err) => {
        console.error("[XEVO-BOUNDS] sidebarToggle Rust ERROR:", err, "for bounds:", bounds);
      });
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
