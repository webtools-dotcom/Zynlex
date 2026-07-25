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
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useUIStore } from "@/stores/ui";
import {
  createTab,
  navigateTab,
  setWebviewBounds,
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
  setMemoryTarget,
  setTabZoom,
  saveTabState,
  restoreTabState,
  onNetworkEntry,
  onDownloadStarted,
  onDownloadFinished,
  type BrowserBounds,
} from "@/services/browser";
import { useDownloadsStore } from "@/stores/downloads";
import { useSettingsStore } from "@/stores/settings";
import { useHistoryStore } from "@/stores/history";
import { useInspectorStore } from "@/stores/inspector";
import type { MetaInfo, CookieEntry, StorageEntry } from "@/types";
import {
  getLiveWorkspaceActiveTab,
  getLiveWorkspaceActiveTabId,
} from "@/lib/workspaceTabs";
import { toggleBookmarkForActiveTab } from "@/lib/bookmarkAction";
import { useNetworkStore } from "@/stores/network";
import { useHeadersStore } from "@/stores/headers";
import { setHeaderRules } from "@/services/browser";

let _netEntryId = 0;

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Computes the webview's bounds from the content area's DOMRect.
 *
 * These are WINDOW-RELATIVE (main window client area), not screen
 * coordinates: tab webviews are child webviews created via Rust's
 * `Window::add_child`, and Tauri positions those relative to the parent
 * window's top-left corner. So a DOMRect — already relative to the same
 * client area — maps across directly.
 *
 * The old per-edge WEBVIEW_EDGE_INSET calibration is gone. It was
 * compensating for `window.screenX/screenY` vs. the DWM extended frame
 * (Windows 10/11 windows carry a ~7px invisible resize border — that was
 * the `right: 7.5`), which only mattered while we were converting to
 * screen coordinates. Child webviews never leave client space.
 */
function computeWebviewBounds(rect: DOMRect, overlayH: number): BrowserBounds {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top + overlayH),
    width: Math.round(Math.max(1, rect.width)),
    height: Math.round(Math.max(1, rect.height - overlayH)),
  };
}

/**
 * The getBoundingClientRect → overlay-height → computeWebviewBounds sequence,
 * factored out since every bounds-sync call site repeated it verbatim.
 * Returns null when there's no content area yet or it's too small to
 * measure (matches every call site's existing early-return threshold).
 */
function getActiveBounds(
  contentAreaRef: React.RefObject<HTMLDivElement | null>
): BrowserBounds | null {
  const el = contentAreaRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return null;
  const ui = useUIStore.getState();
  const overlayH = ui.overlayPanel !== "none" ? ui.overlayHeight * rect.height : 0;
  return computeWebviewBounds(rect, overlayH);
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
  // Track which tabs have been created (have a webview).
  const createdTabsRef = useRef<Set<string>>(new Set());
  const prevActiveTabIdRef = useRef<string | null>(null);

  // ── Ref-based syncBounds ──────────────────────────────────────────
  const syncBoundsRef = useRef<() => void>(() => {});
  syncBoundsRef.current = () => {
    if (!IS_TAURI) return;
    if (useUIStore.getState().viewportMode) return;
    const tabId = useWorkspacesStore.getState().workspaces[
      useWorkspacesStore.getState().activeWorkspaceId
    ]?.activeTabId;
    if (!tabId) return;
    const bounds = getActiveBounds(contentAreaRef);
    if (!bounds) return;
    const last = lastBoundsRef.current;
    if (
      last &&
      Math.abs(last.x - bounds.x) < 1 &&
      Math.abs(last.y - bounds.y) < 1 &&
      Math.abs(last.width - bounds.width) < 1 &&
      Math.abs(last.height - bounds.height) < 1
    ) {
      return;
    }
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
      if (isChromeOverlayOpen()) return;
      const tabId = useWorkspacesStore.getState().workspaces[
        useWorkspacesStore.getState().activeWorkspaceId
      ]?.activeTabId;
      if (!tabId) return;
      // Guard: don't try to show a webview that hasn't been created yet.
      // The browser_create_tab command is called lazily on first navigation.
      if (!createdTabsRef.current.has(tabId)) {
        return;
      }
      if (!contentAreaRef.current) return;
      const bounds = getActiveBounds(contentAreaRef);
      if (!bounds) {
        if (attempt < 8) {
          setTimeout(() => ensureWebviewVisible(attempt + 1), 50);
        }
        return;
      }
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
      const bounds = getActiveBounds(contentAreaRef);
      if (!bounds) return;
      const displayTitle = url
        .replace(/^https?:\/\/(www\.)?/, "")
        .split("/")[0];
      let reservedNewSlot = false;
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
            reservedNewSlot = true;
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
        // If createTab failed, release the reserved slot — otherwise the tab
        // is marked "created" with no webview behind it, permanently blank.
        if (reservedNewSlot && activeTabId) {
          createdTabsRef.current.delete(activeTabId);
        }
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
        // Fires on reload too, not just fresh navigation — so the network log
        // resets per page load instead of accumulating for the tab's whole
        // lifetime (it was hitting the 500-entry cap after a handful of reloads).
        if (!useNetworkStore.getState().preserveLog) {
          useNetworkStore.getState().clearTab(tabId);
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

      // Ignore data from tabs that are not currently active
      const wsState = useWorkspacesStore.getState();
      const activeTabId = getLiveWorkspaceActiveTabId(
        wsState.workspaces[wsState.activeWorkspaceId],
        useTabsStore.getState().tabs
      );
      if (event.tabId !== activeTabId) return;

      // event.data arrives as an already-parsed object (Rust sends serde_json::Value,
      // not a JSON string) — no JSON.parse needed here.
      const parsed = event.data;
      if (parsed.error) {
        store.setError(parsed.error);
        return;
      }
      store.setError(null);

      switch (event.dataType) {
        case "meta":
          store.setMeta(parsed as unknown as MetaInfo);
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
    const bounds = getActiveBounds(contentAreaRef);
    if (!bounds) return;

    const setNormal = () => {
      setMemoryTarget(activeTabId!, false).catch(() => {});
      // Per-tab zoom memory: a recreated webview starts at 100%, and a live one
      // may have been zoomed while another tab was showing.
      const zoom = useTabsStore.getState().tabs[activeTabId!]?.zoom ?? 1;
      if (zoom !== 1) setTabZoom(activeTabId!, zoom).catch(() => {});
    };

    // Hide the outgoing webview on every path, not just the live-webview one.
    // Tab webviews are siblings under the same window, so an un-hidden one stays
    // on top and keeps rendering while the tab bar shows a different tab.
    if (prevId && prevId !== activeTabId && createdTabsRef.current.has(prevId)) {
      hideTabWebview(prevId).catch(() => {});
    }

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
      // Tab has a live webview — just show it. No destroy/recreate.
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
      const wsState = useWorkspacesStore.getState();
      const ws = wsState.workspaces[wsState.activeWorkspaceId];
      const activeTabId = ws ? getLiveWorkspaceActiveTab(ws, useTabsStore.getState().tabs)?.id : null;

      const createdIds = Array.from(createdTabsRef.current);
      createdTabsRef.current.clear();

      // Mark all non-active tabs as discarded so their store state is consistent
      const tabsState = useTabsStore.getState().tabs;
      for (const id of createdIds) {
        if (id !== activeTabId && tabsState[id]) {
          // Save tab state before discarding
          saveTabState(id).catch(() => {});
          useTabsStore.getState().discardTab(id);
        }
      }

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
          const bounds = getActiveBounds(contentAreaRef);
          if (!bounds) return;
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
  // rAF-throttled, not debounced: a debounce (clearTimeout+setTimeout) resets on
  // every observer fire, so during a continuous drag it never actually runs — the
  // chrome resizes live while the page sits still, then snaps once you stop. A
  // rAF throttle instead coalesces bursts to one sync per frame and still fires
  // on every frame throughout the drag.
  useEffect(() => {
    if (!IS_TAURI) return;
    const el = contentAreaRef.current;
    if (!el) return;
    let rafId: number | null = null;
    const observer = new ResizeObserver(() => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        syncBounds();
      });
    });
    observer.observe(el);
    observer.observe(document.documentElement);
    syncBounds();
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [contentAreaRef, syncBounds]);

  // ── Maximize/restore: drop the bounds guard so the fallback fires ──
  // The Rust on_window_event resync is the primary fix for the maximize-freeze
  // (child webviews don't auto-resize with the parent). This is the JS fallback:
  // when maximize state flips, clear lastBoundsRef so the <1px guard in
  // syncBounds can't suppress the re-push, then force one sync after layout
  // settles.
  useEffect(() => {
    if (!IS_TAURI) return;
    const onMaxChanged = () => {
      lastBoundsRef.current = null;
      setTimeout(() => syncBoundsRef.current(), 60);
    };
    window.addEventListener("xevo:maximize-changed", onMaxChanged);
    return () => window.removeEventListener("xevo:maximize-changed", onMaxChanged);
  }, []);

  // Window move/resize following is GONE, and deliberately so.
  //
  // Tab webviews used to be top-level *owner* windows positioned in screen
  // coordinates, so every window move had to be observed here and replayed
  // to Rust — the onMoved listener that never fired for maximize/unmaximize
  // (SWP_NOMOVE), the throttle, the double resize timers, the minimize-state
  // and force-sync listeners, and the maximize-transition lastBoundsRef reset.
  //
  // They are child webviews inside the main window now, so Windows moves,
  // clips, hides and restores them with the parent. The ResizeObserver above
  // still handles *layout* changes (sidebar, overlay panel, window resize
  // changing the content area) — that is a different thing from window moves.

  // ── Network entry listener ────────────────────────────────────────
  useEffect(() => {
    if (!IS_TAURI) return;
    let cancelled = false;
    const addEntry = useNetworkStore.getState().addEntry;
    const unlisten = onNetworkEntry((payload) => {
      if (cancelled) return;
      addEntry({
        id: `net-${++_netEntryId}`,
        ...payload,
      });
    });
    return () => {
      cancelled = true;
      unlisten.then((fn) => fn());
    };
  }, []);

  // ── Download listeners ────────────────────────────────────────────
  useEffect(() => {
    if (!IS_TAURI) return;
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];
    const track = (p: Promise<UnlistenFn>) =>
      p.then((fn) => {
        if (cancelled) fn();
        else unlisteners.push(fn);
      });

    track(
      onDownloadStarted(({ url, destination }) => {
        useDownloadsStore.getState().start(url, destination);
        useUIStore.getState().pushToast(`Downloading ${destination.split(/[\\/]/).pop()}`, "info");
      })
    );
    track(
      onDownloadFinished(({ url, path, success }) => {
        useDownloadsStore.getState().finish(url, path, success);
      })
    );

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  // ── Header rules sync: resolve each tab's own workspace's rules and push the
  // whole per-tab map to Rust. Keyed by tabId (not the active workspace) so a
  // background tab from an inactive workspace never picks up another
  // workspace's rules. ──
  useEffect(() => {
    if (!IS_TAURI) return;
    const sync = () => {
      const { rulesByWs } = useHeadersStore.getState();
      const rulesByTab: Record<string, ReturnType<typeof useHeadersStore.getState>["rulesByWs"][string]> = {};
      for (const tab of Object.values(useTabsStore.getState().tabs)) {
        const rules = rulesByWs[tab.workspaceId];
        if (rules?.length) rulesByTab[tab.id] = rules;
      }
      setHeaderRules(rulesByTab).catch((err) =>
        console.error("Failed to sync header rules:", err)
      );
    };
    sync();
    const unsubHeaders = useHeadersStore.subscribe(sync);
    const unsubTabs = useTabsStore.subscribe(sync);
    return () => {
      unsubHeaders();
      unsubTabs();
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
      const bounds = getActiveBounds(contentAreaRef);
      if (!bounds) return;
      setWebviewBounds(tab.id, {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }).catch((err) => {
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
  // rAF-throttled, not debounced — same reasoning as the ResizeObserver sync
  // above: a setTimeout debounce resets on every fire during a continuous
  // drag and never actually runs until the drag stops, so the webview visibly
  // lags/snaps under the panel instead of tracking it live.
  const overlayHeight = useUIStore((s) => s.overlayHeight);
  useEffect(() => {
    if (!IS_TAURI) return;
    const ui = useUIStore.getState();
    if (ui.overlayPanel === "none") return;
    const wsState = useWorkspacesStore.getState();
    const ws = wsState.workspaces[wsState.activeWorkspaceId];
    const tab = getLiveWorkspaceActiveTab(ws, useTabsStore.getState().tabs);
    if (!tab?.url) return;
    const rafId = requestAnimationFrame(() => syncBounds());
    return () => cancelAnimationFrame(rafId);
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
