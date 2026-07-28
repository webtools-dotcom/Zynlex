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
  /** The request's Referer header. WebView2 exposes no true initiator. */
  referrer: string;
  headers: Record<string, string>;
  body: string;
}

interface NetworkStore {
  entriesByTab: Record<string, NetworkLogEntry[]>;
  /** While paused, incoming entries are dropped — capture keeps running. */
  paused: boolean;
  /** When true, a page load does not clear the tab's log. */
  preserveLog: boolean;
  addEntry: (entry: NetworkLogEntry) => void;
  clearTab: (tabId: string) => void;
  clearAll: () => void;
  setPaused: (paused: boolean) => void;
  setPreserveLog: (preserve: boolean) => void;
}

const MAX_ENTRIES_PER_TAB = 500;

export const useNetworkStore = create<NetworkStore>()((set) => ({
  entriesByTab: {},
  paused: false,
  preserveLog: false,
  setPaused: (paused) => set({ paused }),
  setPreserveLog: (preserveLog) => set({ preserveLog }),
  addEntry: (entry) =>
    set((s) => {
      if (s.paused) return s;
      const tab = s.entriesByTab[entry.tabId] ?? [];
      const next = [...tab, entry].slice(-MAX_ENTRIES_PER_TAB);
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

export function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const RESOURCE_TYPE_LABELS: Record<string, string> = {
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

export function resourceTypeLabel(rt: string): string {
  return RESOURCE_TYPE_LABELS[rt] ?? rt;
}
