import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { NetworkLogEntry } from "@/types";

const MAX_ENTRIES_PER_TAB = 200;

interface NetworkStore {
  entriesByTab: Record<string, NetworkLogEntry[]>;
  isCapturing: boolean;
  methodFilter: string | null;
  urlFilter: string;

  addEntry: (entry: NetworkLogEntry) => void;
  clearTab: (tabId: string) => void;
  clearAll: () => void;
  setIsCapturing: (v: boolean) => void;
  setMethodFilter: (method: string | null) => void;
  setUrlFilter: (url: string) => void;
}

export const useNetworkStore = create<NetworkStore>()(
  immer((set) => ({
    entriesByTab: {},
    isCapturing: true,
    methodFilter: null,
    urlFilter: "",

    addEntry: (entry) =>
      set((s) => {
        if (!s.isCapturing) return;
        const tabId = entry.tabId;
        if (!s.entriesByTab[tabId]) {
          s.entriesByTab[tabId] = [];
        }
        s.entriesByTab[tabId].unshift(entry);
        if (s.entriesByTab[tabId].length > MAX_ENTRIES_PER_TAB) {
          s.entriesByTab[tabId] = s.entriesByTab[tabId].slice(
            0,
            MAX_ENTRIES_PER_TAB
          );
        }
      }),

    clearTab: (tabId) =>
      set((s) => {
        s.entriesByTab[tabId] = [];
      }),

    clearAll: () =>
      set((s) => {
        s.entriesByTab = {};
      }),

    setIsCapturing: (v) =>
      set((s) => {
        s.isCapturing = v;
      }),

    setMethodFilter: (method) =>
      set((s) => {
        s.methodFilter = method;
      }),

    setUrlFilter: (url) =>
      set((s) => {
        s.urlFilter = url;
      }),
  }))
);

export function getFilteredEntries(
  state: NetworkStore,
  tabId: string
): NetworkLogEntry[] {
  const entries = state.entriesByTab[tabId] ?? [];
  return entries.filter((e) => {
    if (state.methodFilter) {
      if (
        state.methodFilter === "FETCH" &&
        e.entryType !== "fetch"
      )
        return false;
      if (
        state.methodFilter === "XHR" &&
        e.entryType !== "xhr"
      )
        return false;
      if (
        state.methodFilter !== "FETCH" &&
        state.methodFilter !== "XHR" &&
        e.method !== state.methodFilter
      )
        return false;
    }
    if (
      state.urlFilter &&
      !e.url.toLowerCase().includes(state.urlFilter.toLowerCase())
    )
      return false;
    return true;
  });
}
