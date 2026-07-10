import { create } from "zustand";

export interface NetworkLogEntry {
  id: string;
  tabId: string;
  method: string;
  url: string;
  statusCode: number;
  reasonPhrase: string;
  resourceType: string;
  durationMs: number;
  contentLength: number;
  headers: Record<string, string>;
  body: string;
}

interface NetworkStore {
  entriesByTab: Record<string, NetworkLogEntry[]>;
  addEntry: (entry: NetworkLogEntry) => void;
  clearTab: (tabId: string) => void;
  clearAll: () => void;
}

const MAX_ENTRIES_PER_TAB = 500;

export const useNetworkStore = create<NetworkStore>()((set) => ({
  entriesByTab: {},
  addEntry: (entry) =>
    set((s) => {
      const tab = s.entriesByTab[entry.tabId] ?? [];
      const next = [...tab, entry];
      if (next.length > MAX_ENTRIES_PER_TAB) {
        next.splice(0, next.length - MAX_ENTRIES_PER_TAB);
      }
      return {
        entriesByTab: {
          ...s.entriesByTab,
          [entry.tabId]: next,
        },
      };
    }),
  clearTab: (tabId) =>
    set((s) => {
      const next = { ...s.entriesByTab };
      delete next[tabId];
      return { entriesByTab: next };
    }),
  clearAll: () => set({ entriesByTab: {} }),
}));

export function formatSize(bytes: number): string {
  if (bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function resourceTypeLabel(rt: string): string {
  const labels: Record<string, string> = {
    document: "Doc",
    stylesheet: "CSS",
    image: "Img",
    media: "Media",
    font: "Font",
    script: "JS",
    xhr: "XHR",
    fetch: "Fetch",
    websocket: "WS",
    manifest: "Manifest",
    ping: "Ping",
    other: "Other",
  };
  return labels[rt] ?? rt;
}

export function entryIsError(e: NetworkLogEntry): boolean {
  return e.statusCode >= 400;
}

export function entryIsSlow(e: NetworkLogEntry, threshold = 1000): boolean {
  return e.durationMs > threshold;
}

export function entryIsApi(e: NetworkLogEntry): boolean {
  return e.resourceType === "xhr" || e.resourceType === "fetch";
}
