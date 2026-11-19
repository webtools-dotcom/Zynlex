import { create } from "zustand";
import {
  clearNetworkBodies,
  getNetworkBody,
  setNetworkPaused,
  type WebSocketEvent,
} from "@/services/browser";

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
  /** Empty in the store: the text stays in Rust until `withBody` fetches it. */
  body: string;
  /** What `withBody` fetches by. Absent or 0 = the response had no body. */
  bodyId?: number;
  /** Body hit the 64 KB capture cap and this is the leading slice. */
  bodyTruncated: boolean;
  /** Set by `withBody` when Rust no longer has the body (it keeps the newest 50 per tab). */
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
  /**
   * The newest requests that can change something on a server (not GET, HEAD
   * or OPTIONS), across page loads: a page load clears the tab's log, and a
   * script that failed after a navigation still has to say what it sent.
   */
  writes: NetworkWrite[];
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
const MAX_WRITES = 50;

/** One request in `writes`; `n` is the number in its entry's `net-N` id. */
export interface NetworkWrite {
  n: number;
  tabId: string;
  method: string;
  url: string;
  status: number;
  mocked: boolean;
}

const READS = new Set(["GET", "HEAD", "OPTIONS"]);
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
 * The entry with its response body filled in, for the places that read one: the
 * detail pane, copy as cURL/fetch, "Mock this", and the agent's `network id`.
 *
 * The bodies live in Rust, which keeps the newest 50 per tab (net.rs). A body it
 * no longer has comes back marked evicted. The store does not try to predict
 * that: it used to mark every entry older than the newest 50 *requests*, so a
 * page that keeps sending images and analytics pings (which have no body)
 * pushed real bodies out of reach long before Rust had dropped them.
 */
export async function withBody(
  entry: NetworkLogEntry,
  fetchBody: typeof getNetworkBody = getNetworkBody,
): Promise<NetworkLogEntry> {
  if (!entry.bodyId || entry.bodyEvicted || entry.body) return entry;
  const body = await fetchBody(entry.tabId, entry.bodyId).catch(() => null);
  return body === null ? { ...entry, bodyEvicted: true } : { ...entry, body };
}

export const useNetworkStore = create<NetworkStore>()((set) => ({
  entriesByTab: {},
  socketsByTab: {},
  writes: [],
  paused: false,
  preserveLog: false,
  setPaused: (paused) => {
    // Rust stops keeping bodies too, so the ones on screen stay readable.
    setNetworkPaused(paused).catch(() => {});
    set({ paused });
  },
  setPreserveLog: (preserveLog) => set({ preserveLog }),
  addEntry: (entry) =>
    set((s) => {
      if (s.paused) return s;
      const tab = s.entriesByTab[entry.tabId] ?? [];
      const next = [...tab, entry].slice(-MAX_ENTRIES_PER_TAB);
      const write: NetworkWrite = {
        n: Number(entry.id.slice(4)) || 0,
        tabId: entry.tabId,
        method: entry.method,
        url: entry.url,
        status: entry.statusCode,
        mocked: !!entry.mocked,
      };
      return {
        entriesByTab: {
          ...s.entriesByTab,
          [entry.tabId]: next,
        },
        ...(READS.has(entry.method.toUpperCase())
          ? {}
          : { writes: [...s.writes, write].slice(-MAX_WRITES) }),
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
  clearTab: (tabId) => {
    clearNetworkBodies(tabId).catch(() => {});
    set((s) => {
      const next = { ...s.entriesByTab };
      delete next[tabId];
      const sockets = { ...s.socketsByTab };
      delete sockets[tabId];
      return { entriesByTab: next, socketsByTab: sockets };
    });
  },
  clearAll: () => {
    clearNetworkBodies().catch(() => {});
    set({ entriesByTab: {}, socketsByTab: {} });
  },
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
