import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { MetaInfo, CookieEntry, StorageEntry } from "@/types";

export type InspectorSubTab = "meta" | "cookies" | "storage";

interface InspectorStore {
  meta: MetaInfo | null;
  cookies: CookieEntry[];
  localStorageItems: StorageEntry[];
  sessionStorageItems: StorageEntry[];
  isLoading: boolean;
  lastTabId: string | null;
  error: string | null;
  activeSubTab: InspectorSubTab;

  setMeta: (meta: MetaInfo) => void;
  setCookies: (cookies: CookieEntry[]) => void;
  setLocalStorage: (items: StorageEntry[]) => void;
  setSessionStorage: (items: StorageEntry[]) => void;
  setIsLoading: (v: boolean) => void;
  setLastTabId: (id: string) => void;
  setError: (msg: string | null) => void;
  setActiveSubTab: (tab: InspectorSubTab) => void;
  clearAll: () => void;
}

export const useInspectorStore = create<InspectorStore>()(
  immer((set) => ({
    meta: null,
    cookies: [],
    localStorageItems: [],
    sessionStorageItems: [],
    isLoading: false,
    lastTabId: null,
    error: null,
    activeSubTab: "meta",

    setMeta: (meta) =>
      set((s) => {
        s.meta = meta;
      }),

    setCookies: (cookies) =>
      set((s) => {
        s.cookies = cookies;
      }),

    setLocalStorage: (items) =>
      set((s) => {
        s.localStorageItems = items;
      }),

    setSessionStorage: (items) =>
      set((s) => {
        s.sessionStorageItems = items;
      }),

    setIsLoading: (v) =>
      set((s) => {
        s.isLoading = v;
      }),

    setLastTabId: (id) =>
      set((s) => {
        s.lastTabId = id;
      }),

    setError: (msg) =>
      set((s) => {
        s.error = msg;
      }),

    setActiveSubTab: (tab) =>
      set((s) => {
        s.activeSubTab = tab;
      }),

    clearAll: () =>
      set((s) => {
        s.meta = null;
        s.cookies = [];
        s.localStorageItems = [];
        s.sessionStorageItems = [];
        s.lastTabId = null;
        s.error = null;
      }),
  })),
);
