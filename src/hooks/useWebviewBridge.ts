/**
 * useWebviewBridge — manages the per-tab child webview bridge (see
 * docs/architecture.md for the process model). Creates webviews lazily on
 * first navigation, hides/shows on tab switch (no reload, state preserved),
 * closes on tab close, keeps bounds synced with the content area, subscribes
 * to per-tab events from Rust, and exposes navigate/goBack/goForward/reload.
 */
import { useEffect, useRef, useCallback, useMemo } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import {
  useUIStore,
  isApiTesterOpen,
  isViewportMode,
  useApiTesterOpen,
  useViewportMode,
} from "@/stores/ui";
import { getActiveTabId } from "@/hooks/useActiveScope";
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
  onHistoryState,
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
import { getLiveWorkspaceActiveTab, getLiveWorkspaceActiveTabId } from "@/lib/workspaceTabs";
import { useNetworkStore } from "@/stores/network";
import { useHeadersStore } from "@/stores/headers";
import { setHeaderRules } from "@/services/browser";
import { titleFromUrl } from "@/lib/url";

let _netEntryId = 0;

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

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
  contentAreaRef: React.RefObject<HTMLDivElement | null>,
): BrowserBounds | null {
  const el = contentAreaRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return null;
  // Only the API Tester belonging to the *current* workspace steals height —
  // one left open in another workspace isn't on screen here.
  const overlayH = isApiTesterOpen() ? useUIStore.getState().overlayHeight * rect.height : 0;
  return computeWebviewBounds(rect, overlayH);
}

/** Any React chrome overlay that must sit above the OS-level browser webview. */
function isChromeOverlayOpen(): boolean {
  const ui = useUIStore.getState();
  return ui.commandPaletteOpen || ui.shortcutHelpOpen || ui.settingsPanelOpen;
}

export function useWebviewBridge(contentAreaRef: React.RefObject<HTMLDivElement | null>) {
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const tabs = useTabsStore((s) => s.tabs);
  const updateTab = useTabsStore((s) => s.updateTab);

  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);
  const activeTabId = activeTab?.id ?? null;
  const viewportMode = useViewportMode();

  // Track last bounds to avoid redundant Rust calls
  const lastBoundsRef = useRef<BrowserBounds | null>(null);
  // Track when loading started so we can report load time on completion.
  const loadStartRef = useRef<number | null>(null);
  const createdTabsRef = useRef<Set<string>>(new Set());
  const prevActiveTabIdRef = useRef<string | null>(null);
  // Bumped on every tab-switch attempt. An async show/create that resolves after
  // a newer switch started is stale — its result must not be applied, or a
  // slow operation can leave the previous tab's webview on top of the current one.
  const switchSeqRef = useRef(0);

  // ── Ref-based syncBounds ──────────────────────────────────────────
  const syncBoundsRef = useRef<() => void>(() => {});
  syncBoundsRef.current = () => {
    if (!IS_TAURI) return;
    if (isViewportMode()) return;
    const tabId = getActiveTabId();
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
      console.error("[zynlex] setWebviewBounds failed:", err);
    });
  };

  const syncBounds = useCallback(() => syncBoundsRef.current(), []);

  // ── Ref-based reconcileVisibility ─────────────────────────────────
  /**
   * Force the native layer back in step with whatever tab is active *now*.
   *
   * Every show path is asynchronous, and Rust calls `show()` on the webview
   * before the JS promise resolves. So a slow `browser_create_tab` can land
   * after the user has already switched away, painting the old tab's webview
   * over the new tab's page. The symptom: click + while a page is still
   * opening, and the new tab's content area keeps showing the old site until
   * you close the old tab entirely.
   *
   * The switch effect's sequence guard cannot fix this on its own — by the time
   * a superseded promise resolves, Rust has already shown the webview. Nor can
   * the empty-tab branch's hide loop, which fires *before* the webview exists
   * and so finds nothing to hide.
   *
   * The fix is to re-assert after any operation that may have shown something:
   * if the active tab has no webview it is entitled to show — a new empty tab,
   * or one not created yet — then nothing may be visible.
   *
   * A ref, not a useCallback, for the same reason syncBounds is one: it is
   * called from effects whose dependency arrays must not grow.
   */
  const reconcileVisibilityRef = useRef<() => void>(() => {});

  // Show the active tab's webview with fresh bounds.
  const ensureWebviewVisible = useCallback(
    (attempt = 0) => {
      if (isViewportMode()) return;
      if (isChromeOverlayOpen()) return;
      const tabId = getActiveTabId();
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
      showTabWebview(tabId, bounds).catch((err) => {
        console.error("[zynlex] showTabWebview failed:", err);
      });
    },
    [contentAreaRef],
  );

  reconcileVisibilityRef.current = () => {
    if (!IS_TAURI) return;
    if (isViewportMode()) return;
    const tabId = getActiveTabId();
    const tab = tabId ? useTabsStore.getState().tabs[tabId] : null;
    if (!tabId || !tab?.url || !createdTabsRef.current.has(tabId)) {
      // Nothing is entitled to be on screen. Hide everything rather than
      // trusting that whatever Rust last showed was the right thing.
      for (const tid of createdTabsRef.current) {
        hideTabWebview(tid).catch(() => {});
      }
      return;
    }
    // showTabWebview hides every other browser webview in Rust, so showing the
    // right one is also what hides a wrongly-shown one.
    ensureWebviewVisible();
  };

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
      const displayTitle = titleFromUrl(url);
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
          // Rust shows the new webview before this promise resolves, so a slow
          // create can land after the user has already opened or switched to
          // another tab — leaving the old page composited over the new one.
          reconcileVisibilityRef.current();
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
    [activeTabId, updateTab, contentAreaRef],
  );

  const goBack = useCallback(async () => {
    if (!IS_TAURI) return;
    const tabId = activeTabId ?? getActiveTabId();
    if (!tabId) return;
    await webviewGoBack(tabId);
  }, [activeTabId]);

  const goForward = useCallback(async () => {
    if (!IS_TAURI) return;
    const tabId = activeTabId ?? getActiveTabId();
    if (!tabId) return;
    await webviewGoForward(tabId);
  }, [activeTabId]);

  const reload = useCallback(
    async (overrideTabId?: string) => {
      if (!IS_TAURI) return;
      const tabId = overrideTabId ?? activeTabId ?? getActiveTabId();
      if (!tabId) return;
      await webviewReload(tabId);
    },
    [activeTabId],
  );

  const stopLoadingAction = useCallback(async () => {
    if (!IS_TAURI) return;
    const tabId = activeTabId ?? getActiveTabId();
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
    let unHistory: (() => void) | null = null;
    let unNewTab: (() => void) | null = null;
    let unInspectorData: (() => void) | null = null;

    onNewTabRequested((url) => {
      const wsId = useWorkspacesStore.getState().activeWorkspaceId;
      if (!wsId) return;
      const tabId = useTabsStore.getState().addTab(wsId, { url, title: "New Tab" });
      useWorkspacesStore.getState().addTabToWorkspace(wsId, tabId);
      useWorkspacesStore.getState().setActiveTab(wsId, tabId);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unNewTab = fn;
    });

    onUrlChanged((tabId, url) => {
      useTabsStore.getState().updateTab(tabId, { url });
      // Record to global history — use the tab's own workspace, not the active one
      const wsState = useWorkspacesStore.getState();
      const tab = useTabsStore.getState().tabs[tabId];
      const wsId = tab?.workspaceId ?? wsState.activeWorkspaceId;
      useHistoryStore.getState().addEntry({
        url,
        title: titleFromUrl(url),
        favicon: null,
        timestamp: Date.now(),
        workspaceId: wsId,
      });
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unUrl = fn;
    });

    onLoadingChanged((tabId, loading) => {
      if (loading) {
        loadStartRef.current = Date.now();
        // loadTime belongs to the page that is finishing, not the one starting —
        // clear it so the status bar doesn't show the previous page's number
        // while the new one loads. (Was a side effect of recordNavigation.)
        useTabsStore.getState().updateTab(tabId, { isLoading: true, loadTime: null });
        // Fires on reload too, not just fresh navigation — so the network log
        // resets per page load instead of accumulating for the tab's whole
        // lifetime (it was hitting the 500-entry cap after a handful of reloads).
        if (!useNetworkStore.getState().preserveLog) {
          useNetworkStore.getState().clearTab(tabId);
        }
      } else {
        const elapsed = loadStartRef.current !== null ? Date.now() - loadStartRef.current : null;
        loadStartRef.current = null;
        useTabsStore.getState().updateTab(tabId, {
          isLoading: false,
          loadTime: elapsed,
        });

        // Restore scroll/form state captured when this tab was discarded. It has to
        // happen here, not when createTab resolves: that resolves as soon as the
        // webview exists, long before the document it is navigating to has loaded,
        // and writing scroll position into a blank document does nothing.
        const saved = useTabsStore.getState().tabs[tabId]?.savedFormState;
        if (saved) {
          restoreTabState(tabId, saved)
            .then(() => useTabsStore.getState().saveTabState(tabId, null))
            .catch(() => {});
        }
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
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
      if (cancelled) {
        fn();
        return;
      }
      unTabInfo = fn;
    });

    onHistoryState((tabId, canGoBack, canGoForward) => {
      useTabsStore.getState().updateTab(tabId, { canGoBack, canGoForward });
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unHistory = fn;
    });

    // Inspector data from browser_eval_inspector
    onInspectorData((event) => {
      const store = useInspectorStore.getState();
      store.setIsLoading(false);

      // Ignore data from tabs that are not currently active
      const wsState = useWorkspacesStore.getState();
      const activeTabId = getLiveWorkspaceActiveTabId(
        wsState.workspaces[wsState.activeWorkspaceId],
        useTabsStore.getState().tabs,
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
      if (cancelled) {
        fn();
        return;
      }
      unInspectorData = fn;
    });

    return () => {
      cancelled = true;
      unUrl?.();
      unLoading?.();
      unTabInfo?.();
      unHistory?.();
      unNewTab?.();
      unInspectorData?.();
    };
  }, []);

  // ── TAB SWITCHING: activate the target tab's webview ─────────────
  // No navigation! Just hide old + show new. State is preserved.
  useEffect(() => {
    if (!IS_TAURI) return;
    if (!activeTabId) return;

    // Claim this switch. Any async work below checks the seq before applying, so
    // a superseded switch can't stomp a newer one.
    const seq = ++switchSeqRef.current;
    const isStale = () => switchSeqRef.current !== seq;

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

    const setNormal = () => {
      setMemoryTarget(activeTabId!, false).catch(() => {});
      // Per-tab zoom memory: a recreated webview starts at 100%, and a live one
      // may have been zoomed while another tab was showing.
      const zoom = useTabsStore.getState().tabs[activeTabId!]?.zoom ?? 1;
      if (zoom !== 1) setTabZoom(activeTabId!, zoom).catch(() => {});
    };

    // A superseded switch must not apply its result — and since the newer switch
    // may already have finished, reconcile to whatever tab is actually active now.
    const settle = () => {
      if (isStale()) {
        // Not just "show the right tab" — the right tab may be an empty one
        // with nothing to show, in which case the superseded create/show has
        // left a webview on screen that has to be hidden.
        reconcileVisibilityRef.current();
        return;
      }
      setNormal();
    };

    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const runSwitch = (attempt: number) => {
      if (isStale()) return;

      // Bounds are unmeasurable (<10px) while layout settles — most reliably right
      // after a minimize/restore. Bailing outright used to strand the switch
      // forever: nothing hid the old webview, nothing showed the new one, and the
      // effect never re-ran because its deps hadn't changed. Retry instead, same
      // bounded pattern as ensureWebviewVisible.
      const bounds = getActiveBounds(contentAreaRef);
      if (!bounds) {
        if (attempt < 8) {
          retryTimer = setTimeout(() => runSwitch(attempt + 1), 50);
        }
        return;
      }

      // Hide the outgoing webview on every path, not just the live-webview one.
      // Tab webviews are siblings under the same window, so an un-hidden one stays
      // on top and keeps rendering while the tab bar shows a different tab.
      if (prevId && prevId !== activeTabId && createdTabsRef.current.has(prevId)) {
        hideTabWebview(prevId).catch(() => {});
      }

      // Read fresh, not from the effect's closure — on a retry the captured
      // `tabs` snapshot may be stale.
      const tab = useTabsStore.getState().tabs[activeTabId];
      if (tab?.discardedAt !== null) {
        // Tab was discarded — recreate the webview, then restore.
        // Reserve slot synchronously BEFORE async call.
        createdTabsRef.current.add(activeTabId);
        createTab(activeTabId, tabUrl, bounds)
          .then(() => {
            useTabsStore.getState().restoreTab(activeTabId);
            settle();
          })
          .catch(() => {
            createdTabsRef.current.delete(activeTabId);
          });
      } else if (createdTabsRef.current.has(activeTabId)) {
        // Tab has a live webview — just show it. No destroy/recreate.
        showTabWebview(activeTabId, bounds)
          .then(settle)
          .catch(() => {});
      } else {
        // Tab has no webview yet (lazy creation) — create it.
        // Reserve slot synchronously BEFORE async call.
        createdTabsRef.current.add(activeTabId);
        createTab(activeTabId, tabUrl, bounds)
          .then(settle)
          .catch(() => {
            createdTabsRef.current.delete(activeTabId);
          });
      }

      prevActiveTabIdRef.current = activeTabId;
    };

    runSwitch(0);

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [activeTabId, viewportMode]);

  // ── Prune the live-webview set when tabs disappear ────────────────
  // createdTabsRef records which tabs have a webview. Ids are added on create and
  // removed on discard, but tab *close* happens in four different places (the tab
  // bar's ×, ctrl+w, the tab context menu, and deleting a whole workspace) and none
  // of them can reach this ref. Left unpruned the set only grows, which broke the
  // concurrency cap below — it reads `.size` as the live count, so closing tabs
  // inflated the number and made the cap discard real, in-use background tabs to
  // get under a limit it was never over. It also meant every tab switch fired a
  // hideTabWebview IPC call for each long-dead id.
  //
  // Deriving it from the store instead of patching the four call sites means any
  // close path added later is covered for free: a tab that is gone from the store
  // cannot have a live webview.
  useEffect(() => {
    if (!IS_TAURI) return;
    return useTabsStore.subscribe((state) => {
      for (const id of createdTabsRef.current) {
        if (!state.tabs[id]) createdTabsRef.current.delete(id);
      }
    });
  }, []);

  // Capture-then-close, shared by all three discard paths (the inactivity timer,
  // the concurrency cap, and a user-agent change). The capture has to be awaited:
  // every site used to fire `saveTabState(id).catch(…)` and then destroy the
  // webview on the next line, so there was never a webview left to read from.
  const discardWebviewRef = useRef<(tabId: string) => Promise<void>>(async () => {});
  discardWebviewRef.current = async (tabId: string) => {
    try {
      // Bounded, because the close below now waits on this. The capture runs as
      // ExecuteScript on the page's own JS thread and `eval_json` awaits it with
      // no timeout, so a tab wedged in a busy loop would never resolve — and that
      // is exactly the tab discard exists to reclaim. Give up on the state rather
      // than on the discard.
      const json = await Promise.race([
        saveTabState(tabId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
      if (json) useTabsStore.getState().saveTabState(tabId, json);
    } catch {
      // Capture failed — discard anyway. Losing scroll position is much cheaper
      // than leaking the webview this was called to reclaim.
    }
    try {
      await closeTabWebview(tabId);
      useTabsStore.getState().discardTab(tabId);
      createdTabsRef.current.delete(tabId);
    } catch {
      // Leave it in createdTabsRef: the webview may still be alive.
    }
  };

  // ── TAB DISCARD TIMER: discard inactive tabs after 10 minutes ─────
  useEffect(() => {
    if (!IS_TAURI) return;

    const DISCARD_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    const DISCARD_CHECK_INTERVAL_MS = 60 * 1000; // Check every minute

    const interval = setInterval(() => {
      const now = Date.now();
      const tabsState = useTabsStore.getState().tabs;
      const currentActiveTabId = getActiveTabId();

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

        if (now - tab.lastActiveAt > DISCARD_TIMEOUT_MS) {
          void discardWebviewRef.current(tabId);
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
      const activeTabId = ws
        ? getLiveWorkspaceActiveTab(ws, useTabsStore.getState().tabs)?.id
        : null;

      const createdIds = Array.from(createdTabsRef.current);
      createdTabsRef.current.clear();

      // Mark all non-active tabs as discarded so their store state is consistent.
      // Captures are awaited before anything is closed — a webview that is already
      // gone has no scroll position left to read.
      const tabsState = useTabsStore.getState().tabs;
      const toCapture = createdIds.filter((id) => id !== activeTabId && tabsState[id]);

      Promise.all(
        toCapture.map(async (id) => {
          try {
            const json = await saveTabState(id);
            if (json) useTabsStore.getState().saveTabState(id, json);
          } catch {
            // Capture failed — discard anyway.
          }
          useTabsStore.getState().discardTab(id);
        }),
      )
        .then(() => Promise.all(createdIds.map((id) => closeTabWebview(id).catch(() => {}))))
        .then(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(resolve, 50);
            }),
        )
        .then(() => {
          const wsState2 = useWorkspacesStore.getState();
          const ws2 = wsState2.workspaces[wsState2.activeWorkspaceId];
          const tab = getLiveWorkspaceActiveTab(ws2, useTabsStore.getState().tabs);
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

    window.addEventListener("zynlex:ua-changed", recreateForUserAgent);
    return () => window.removeEventListener("zynlex:ua-changed", recreateForUserAgent);
  }, [contentAreaRef]);

  // ── CAP CONCURRENT WEBVIEWS: enforce soft limit of maxConcurrentWebviews ──
  useEffect(() => {
    if (!IS_TAURI) return;

    const interval = setInterval(() => {
      // Read per tick, not once at mount: the effect's dep array is empty, so a
      // value captured out here stayed frozen at whatever it was when the bridge
      // mounted and Settings changes did nothing until restart.
      const maxConcurrent = useSettingsStore.getState().settings.maxConcurrentWebviews;
      const liveCount = createdTabsRef.current.size;
      if (liveCount <= maxConcurrent) return;

      const tabsState = useTabsStore.getState().tabs;
      const currentActiveTabId = getActiveTabId();

      const candidates = Array.from(createdTabsRef.current)
        .filter((id) => id !== currentActiveTabId)
        .filter((id) => !tabsState[id]?.isPinned)
        .filter((id) => tabsState[id]?.discardedAt === null)
        .sort((a, b) => (tabsState[a]?.lastActiveAt ?? 0) - (tabsState[b]?.lastActiveAt ?? 0));

      const toDiscard = candidates.slice(0, liveCount - maxConcurrent);
      for (const tabId of toDiscard) {
        void discardWebviewRef.current(tabId);
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
    window.addEventListener("zynlex:maximize-changed", onMaxChanged);
    return () => window.removeEventListener("zynlex:maximize-changed", onMaxChanged);
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
      }),
    );
    track(
      onDownloadFinished(({ url, path, success }) => {
        useDownloadsStore.getState().finish(url, path, success);
      }),
    );

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => {
        fn();
      });
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
      const rulesByTab: Record<
        string,
        ReturnType<typeof useHeadersStore.getState>["rulesByWs"][string]
      > = {};
      for (const tab of Object.values(useTabsStore.getState().tabs)) {
        const rules = rulesByWs[tab.workspaceId];
        if (rules?.length) rulesByTab[tab.id] = rules;
      }
      setHeaderRules(rulesByTab).catch((err) =>
        console.error("[zynlex] Failed to sync header rules:", err),
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
        console.error("[zynlex] setWebviewBounds failed (sidebar toggle):", err);
      });
    }, 80);
    return () => clearTimeout(timer);
  }, [sidebarOpen]);

  // ── Hide/show webview when chrome overlays open ──────────────────
  const commandPaletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const shortcutHelpOpen = useUIStore((s) => s.shortcutHelpOpen);
  const settingsPanelOpen = useUIStore((s) => s.settingsPanelOpen);
  const apiTesterOpen = useApiTesterOpen();
  useEffect(() => {
    if (!IS_TAURI) return;
    const overlayOpen = commandPaletteOpen || shortcutHelpOpen || settingsPanelOpen;
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
  }, [apiTesterOpen, syncBounds]);

  // ── Sync bounds when overlay is drag-resized ─────────────────────
  // rAF-throttled, not debounced — same reasoning as the ResizeObserver sync
  // above: a setTimeout debounce resets on every fire during a continuous
  // drag and never actually runs until the drag stops, so the webview visibly
  // lags/snaps under the panel instead of tracking it live.
  const overlayHeight = useUIStore((s) => s.overlayHeight);
  useEffect(() => {
    if (!IS_TAURI) return;
    if (!isApiTesterOpen()) return;
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
      resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
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
    [navigate, goBack, goForward, reload, syncBounds, stopLoadingAction],
  );
}
