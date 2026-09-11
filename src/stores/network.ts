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
  /** A list, not a map — repeated headers (notably `Set-Cookie`) are the point. */
  headers: [string, string][];
  body: string;
  /** Body hit the 64 KB capture cap and this is the leading slice. */
  bodyTruncated: boolean;
  /** Body was dropped to reclaim memory — see `BODIES_KEPT`. */
  bodyEvicted: boolean;
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

/**
 * How many entries keep their response body. Rust ships up to 64 KB per response,
 * so 500 of them is ~32 MB of strings per tab, retained for as long as the tab
 * lives. The metadata is what the list view shows; a body is only ever looked at
 * for a handful of recent requests, so the rest are dropped as they age out.
 */
const BODIES_KEPT = 50;

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
      // Evict exactly the one entry that just aged past the window, rather than
      // re-scanning the list on every request.
      const evictAt = next.length - 1 - BODIES_KEPT;
      if (evictAt >= 0 && next[evictAt].body) {
        next[evictAt] = { ...next[evictAt], body: "", bodyEvicted: true };
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
