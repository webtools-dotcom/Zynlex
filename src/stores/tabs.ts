import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";
import type { Tab, NewTabOptions } from "@/types";
import { useNetworkStore } from "@/stores/network";

function genId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function buildTab(workspaceId: string, opts: NewTabOptions = {}): Tab {
  return {
    id: genId(),
    title: opts.url ? opts.url : "New Tab",
    url: opts.url ?? "",
    favicon: opts.favicon ?? null,
    isLoading: false,
    isPinned: opts.isPinned ?? false,
    isMuted: opts.isMuted ?? false,
    workspaceId,
    createdAt: Date.now(),
    savedFormState: null,
    zoom: 1,
    historyBack: [],
    historyForward: [],
    loadTime: null,
    discardedAt: null,
    lastActiveAt: Date.now(),
  };
}

interface TabsStore {
  tabs: Record<string, Tab>;
  lastClosedTab: Tab | null;
  addTab: (workspaceId: string, opts?: NewTabOptions) => string;
  closeTab: (tabId: string) => void;
  updateTab: (tabId: string, updates: Partial<Tab>) => void;
  duplicateTab: (tabId: string, targetWorkspaceId: string) => string;
  pinTab: (tabId: string) => void;
  setLoading: (tabId: string, val: boolean) => void;
  setFavicon: (tabId: string, favicon: string) => void;
  recordNavigation: (tabId: string, fromUrl: string) => void;
  popBack: (tabId: string) => string | null;
  popForward: (tabId: string) => string | null;
  clearLastClosedTab: () => void;
  discardTab: (tabId: string) => void;
  restoreTab: (tabId: string) => void;
  touchTab: (tabId: string) => void;
  saveTabState: (tabId: string, formState: string | null) => void;
}

/**
 * Fields that survive a restart. Deliberately excludes every transient field
 * (isLoading, discardedAt, lastActiveAt, history stacks, loadTime,
 * savedFormState) — persisting live tab state is what produced the v0.9
 * black-screen bug family.
 */
type TabSnapshot = Pick<
  Tab,
  "id" | "url" | "title" | "favicon" | "isPinned" | "workspaceId" | "createdAt" | "zoom"
>;

export const useTabsStore = create<TabsStore>()(
  persist(
    immer((set, get) => ({
      tabs: {},
      lastClosedTab: null,

      addTab: (workspaceId, opts = {}) => {
        const tab = buildTab(workspaceId, opts);
        set((s) => { s.tabs[tab.id] = tab; });
        return tab.id;
      },

      closeTab: (tabId) => {
        set((s) => {
          if (s.tabs[tabId]) {
            s.lastClosedTab = { ...s.tabs[tabId] };
            delete s.tabs[tabId];
          }
        });
        // Tab is genuinely gone (not discarded) — its network log has no more use.
        useNetworkStore.getState().clearTab(tabId);
      },

      updateTab: (tabId, updates) => {
        set((s) => {
          if (s.tabs[tabId]) Object.assign(s.tabs[tabId], updates);
        });
      },

      duplicateTab: (tabId, targetWorkspaceId) => {
        const src = get().tabs[tabId];
        if (!src) return "";
        const tab = buildTab(targetWorkspaceId, {
          url: src.url,
          title: src.title,
          favicon: src.favicon ?? undefined,
        });
        set((s) => { s.tabs[tab.id] = tab; });
        return tab.id;
      },

      pinTab: (tabId) => {
        set((s) => {
          if (s.tabs[tabId]) s.tabs[tabId].isPinned = !s.tabs[tabId].isPinned;
        });
      },

      setLoading: (tabId, val) => {
        set((s) => { if (s.tabs[tabId]) s.tabs[tabId].isLoading = val; });
      },

      setFavicon: (tabId, favicon) => {
        set((s) => { if (s.tabs[tabId]) s.tabs[tabId].favicon = favicon; });
      },

      recordNavigation: (tabId, fromUrl) => {
        if (!fromUrl) return;
        set((s) => {
          const tab = s.tabs[tabId];
          if (!tab) return;
          const back = tab.historyBack ?? [];
          if (back.length > 0 && back[back.length - 1] === fromUrl) return;
          back.push(fromUrl);
          while (back.length > 50) back.shift();
          tab.historyBack = back;
          tab.historyForward = [];
          tab.loadTime = null;
        });
      },

      popBack: (tabId) => {
        let prevUrl: string | null = null;
        set((s) => {
          const tab = s.tabs[tabId];
          if (!tab) return;
          const back = tab.historyBack ?? [];
          if (back.length === 0) return;
          prevUrl = back[back.length - 1];
          back.pop();
          const forward = tab.historyForward ?? [];
          forward.unshift(tab.url);
          tab.historyBack = back;
          tab.historyForward = forward;
          tab.url = prevUrl;
        });
        return prevUrl;
      },

      popForward: (tabId) => {
        let nextUrl: string | null = null;
        set((s) => {
          const tab = s.tabs[tabId];
          if (!tab) return;
          const forward = tab.historyForward ?? [];
          if (forward.length === 0) return;
          nextUrl = forward[0];
          forward.shift();
          const back = tab.historyBack ?? [];
          back.push(tab.url);
          tab.historyBack = back;
          tab.historyForward = forward;
          tab.url = nextUrl;
        });
        return nextUrl;
      },

      clearLastClosedTab: () => set((s) => { s.lastClosedTab = null; }),

      discardTab: (tabId) => {
        set((s) => {
          const tab = s.tabs[tabId];
          if (tab) {
            s.tabs[tabId] = { ...tab, discardedAt: Date.now() };
          }
        });
      },

      restoreTab: (tabId) => {
        set((s) => {
          const tab = s.tabs[tabId];
          if (tab) {
            s.tabs[tabId] = { ...tab, discardedAt: null };
          }
        });
      },

      touchTab: (tabId) => {
        set((s) => {
          const tab = s.tabs[tabId];
          if (tab) {
            s.tabs[tabId] = { ...tab, lastActiveAt: Date.now() };
          }
        });
      },

      saveTabState: (tabId, formState) => {
        set((s) => {
          const tab = s.tabs[tabId];
          if (tab) {
            s.tabs[tabId] = {
              ...tab,
              savedFormState: formState,
            };
          }
        });
      },
    })),
    {
      name: "xevo-session",
      partialize: (s) => ({
        // Only tabs that actually went somewhere — an empty "New Tab" is not
        // worth restoring, and restoring one would show HomePage anyway.
        tabs: Object.fromEntries(
          Object.values(s.tabs)
            .filter((t) => !!t.url)
            .map((t): [string, TabSnapshot] => [
              t.id,
              {
                id: t.id,
                url: t.url,
                title: t.title,
                favicon: t.favicon,
                isPinned: t.isPinned,
                workspaceId: t.workspaceId,
                createdAt: t.createdAt,
                zoom: t.zoom,
              },
            ])
        ),
      }) as unknown as TabsStore,
      /**
       * Every restored tab is born *discarded*: it has a URL and title so it
       * renders in the tab bar, but no webview. useWebviewBridge already knows
       * how to materialise a discarded tab on activation (built for the
       * 10-minute inactivity discard), so exactly one webview — the active
       * tab's — is created at boot.
       */
      merge: (persisted, current) => {
        const saved =
          (persisted as { tabs?: Record<string, Partial<Tab>> } | undefined)?.tabs ?? {};
        const tabs: Record<string, Tab> = {};
        for (const [id, t] of Object.entries(saved)) {
          if (!t?.url || typeof t.workspaceId !== "string") continue;
          tabs[id] = {
            ...buildTab(t.workspaceId, { url: t.url }),
            ...t,
            id,
            isLoading: false,
            savedFormState: null,
            historyBack: [],
            historyForward: [],
            loadTime: null,
            lastActiveAt: Date.now(),
            discardedAt: Date.now(),
          };
        }
        return { ...current, tabs };
      },
    }
  )
);
