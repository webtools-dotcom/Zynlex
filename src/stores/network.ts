import { create } from "zustand";
import type { WebSocketEvent } from "@/services/browser";

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
  /** Served by a mock rule, never reached the network. */
  mocked?: boolean;
}

/** One WebSocket frame, newest last. */
interface SocketFrame {
  dir: "sent" | "received";
  at: number;
  data: string;
}

/** A tab's WebSocket and its latest frames (CDP Network.webSocket*, see net.rs). */
export interface SocketLog {
  /** "ws-3": what the agent passes as `network id`. */
  id: string;
  /** CDP's requestId. */
  socket: string;
  url: string;
  state: "connecting" | "open" | "closed" | "error";
  /** The last frame error, if any. */
  error: string;
  openedAt: number;
  sent: number;
  received: number;
  /** The last MAX_FRAMES frames. */
  frames: SocketFrame[];
}

interface NetworkStore {
  entriesByTab: Record<string, NetworkLogEntry[]>;
  socketsByTab: Record<string, SocketLog[]>;
  /** While paused, incoming entries are dropped — capture keeps running. */
  paused: boolean;
  /** When true, a page load does not clear the tab's log. */
  preserveLog: boolean;
  addEntry: (entry: NetworkLogEntry) => void;
  addSocketEvent: (e: WebSocketEvent) => void;
  clearTab: (tabId: string) => void;
  clearAll: () => void;
  setPaused: (paused: boolean) => void;
  setPreserveLog: (preserve: boolean) => void;
}

const MAX_ENTRIES_PER_TAB = 500;
/** Sockets kept per tab (oldest dropped) and frames kept per socket. */
const MAX_SOCKETS = 20;
export const MAX_FRAMES = 50;
let socketSeq = 0;

/** A socket's log after one event; a frame for a socket never seen starts one. */
export function applySocketEvent(list: SocketLog[], e: WebSocketEvent, now: number): SocketLog[] {
  const i = list.findIndex((x) => x.socket === e.socket);
  const cur: SocketLog =
    i >= 0
      ? list[i]
      : {
          id: `ws-${++socketSeq}`,
          socket: e.socket,
          url: e.url ?? "",
          state: "connecting",
          error: "",
          openedAt: now,
          sent: 0,
          received: 0,
          frames: [],
        };
  let next = cur;
  if (e.kind === "open") {
    // Only 101 Switching Protocols opens a socket; anything else is a refused upgrade.
    next =
      e.status === 101
        ? { ...cur, state: "open" }
        : { ...cur, state: "error", error: `handshake answered ${e.status || "nothing"}` };
  } else if (e.kind === "closed") {
    // A refused connection sends no error event, only this: it never opened.
    next =
      cur.state === "error"
        ? cur
        : cur.state === "connecting"
          ? { ...cur, state: "error", error: "closed before it opened" }
          : { ...cur, state: "closed" };
  } else if (e.kind === "error") next = { ...cur, state: "error", error: e.data ?? "" };
  else if (e.kind === "sent" || e.kind === "received") {
    next = {
      ...cur,
      // Frames prove it's open even when the handshake event was missed.
      state: cur.state === "connecting" ? "open" : cur.state,
      [e.kind]: cur[e.kind] + 1,
      frames: [...cur.frames, { dir: e.kind, at: now, data: e.data ?? "" }].slice(-MAX_FRAMES),
    };
  } else if (e.kind === "created" && e.url) next = { ...cur, url: e.url };
  return i >= 0 ? list.map((x, j) => (j === i ? next : x)) : [...list, next].slice(-MAX_SOCKETS);
}

/**
 * How many entries keep their response body. Rust ships up to 64 KB per response,
 * so 500 of them is ~32 MB of strings per tab, retained for as long as the tab
 * lives. The metadata is what the list view shows; a body is only ever looked at
 * for a handful of recent requests, so the rest are dropped as they age out.
 */
const BODIES_KEPT = 50;

export const useNetworkStore = create<NetworkStore>()((set) => ({
  entriesByTab: {},
  socketsByTab: {},
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
  addSocketEvent: (e) =>
    set((s) =>
      s.paused
        ? s
        : {
            socketsByTab: {
              ...s.socketsByTab,
              [e.tabId]: applySocketEvent(s.socketsByTab[e.tabId] ?? [], e, Date.now()),
            },
          },
    ),
  clearTab: (tabId) =>
    set((s) => {
      const next = { ...s.entriesByTab };
      delete next[tabId];
      const sockets = { ...s.socketsByTab };
      delete sockets[tabId];
      return { entriesByTab: next, socketsByTab: sockets };
    }),
  clearAll: () => set({ entriesByTab: {}, socketsByTab: {} }),
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
