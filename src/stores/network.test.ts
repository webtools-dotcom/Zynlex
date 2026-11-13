/**
 * The network log is bounded twice over: a cap on entries per tab, and a much
 * smaller cap on how many of those keep their response body. Rust ships up to
 * 64 KB per body, so without the second cap a busy tab retained tens of MB of
 * strings for as long as it lived.
 *
 * Eviction happens on the single entry crossing the boundary rather than by
 * rescanning the list, which is what makes the arithmetic worth pinning down.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { WebSocketEvent } from "@/services/browser";
import {
  applySocketEvent,
  MAX_FRAMES,
  type NetworkLogEntry,
  type SocketLog,
  useNetworkStore,
  withBody,
} from "@/stores/network";

describe("WebSocket log", () => {
  const ev = (
    kind: WebSocketEvent["kind"],
    extra: Partial<WebSocketEvent> = {},
  ): WebSocketEvent => ({
    tabId: "t",
    socket: "7.1",
    kind,
    ...extra,
  });

  it("follows a socket from created to closed, counting frames and keeping the latest", () => {
    let list: SocketLog[] = [];
    list = applySocketEvent(list, ev("created", { url: "ws://localhost:5173/live" }), 1);
    expect(list[0]).toMatchObject({ state: "connecting", url: "ws://localhost:5173/live" });
    list = applySocketEvent(list, ev("open", { status: 101 }), 2);
    for (let i = 0; i < MAX_FRAMES + 5; i++) {
      list = applySocketEvent(list, ev(i % 2 ? "sent" : "received", { data: `f${i}` }), 10 + i);
    }
    list = applySocketEvent(list, ev("closed"), 99);
    const [s] = list;
    expect(list).toHaveLength(1);
    expect(s).toMatchObject({ state: "closed", sent: 27, received: 28 });
    expect(s.frames).toHaveLength(MAX_FRAMES);
    expect(s.frames[s.frames.length - 1]).toEqual({
      dir: "received",
      at: 10 + MAX_FRAMES + 4,
      data: `f${MAX_FRAMES + 4}`,
    });
  });

  it("starts a log for a socket first seen mid-stream, and records errors", () => {
    let list = applySocketEvent([], ev("received", { data: "hi" }), 5);
    expect(list[0]).toMatchObject({ state: "open", url: "", received: 1 });
    list = applySocketEvent(list, ev("error", { data: "Invalid frame header" }), 6);
    expect(list[0]).toMatchObject({ state: "error", error: "Invalid frame header" });
    // Refused: created, then closed, never open.
    let refused = applySocketEvent([], ev("created", { url: "ws://localhost:7799/" }), 1);
    refused = applySocketEvent(refused, ev("closed"), 2);
    expect(refused[0]).toMatchObject({ state: "error", error: "closed before it opened" });
    // A server that answers the upgrade with anything but 101.
    let notFound = applySocketEvent([], ev("open", { status: 404 }), 1);
    notFound = applySocketEvent(notFound, ev("closed"), 2);
    expect(notFound[0]).toMatchObject({ state: "error", error: "handshake answered 404" });
  });

  it("lives with the tab's other entries: cleared with them, ignored while paused", () => {
    const store = useNetworkStore.getState();
    store.addSocketEvent(ev("created", { url: "ws://x" }));
    expect(useNetworkStore.getState().socketsByTab.t).toHaveLength(1);
    store.clearTab("t");
    expect(useNetworkStore.getState().socketsByTab.t).toBeUndefined();
    store.setPaused(true);
    store.addSocketEvent(ev("created", { url: "ws://x" }));
    store.setPaused(false);
    expect(useNetworkStore.getState().socketsByTab.t).toBeUndefined();
  });
});

/** Mirrors BODIES_KEPT in the store — not exported, so restated here. */
const BODIES_KEPT = 50;

function makeEntry(n: number, tabId = "tab-1"): NetworkLogEntry {
  return {
    id: `net-${n}`,
    tabId,
    method: "GET",
    url: `https://example.com/${n}`,
    statusCode: 200,
    reasonPhrase: "OK",
    resourceType: "fetch",
    durationMs: 1,
    contentLength: 10,
    referrer: "",
    headers: [["Content-Type", "application/json"]],
    body: `body-${n}`,
    bodyTruncated: false,
    bodyEvicted: false,
  };
}

function add(count: number, tabId = "tab-1") {
  for (let n = 1; n <= count; n++) {
    useNetworkStore.getState().addEntry(makeEntry(n, tabId));
  }
}

beforeEach(() => {
  useNetworkStore.setState({ entriesByTab: {}, paused: false, preserveLog: false });
});

describe("withBody", () => {
  const bare = { ...makeEntry(1), body: "", bodyId: 7 };

  it("fetches the body Rust kept for the entry", async () => {
    const calls: [string, number][] = [];
    const full = await withBody(bare, async (tabId, bodyId) => {
      calls.push([tabId, bodyId]);
      return '{"ok":true}';
    });
    expect(calls).toEqual([["tab-1", 7]]);
    expect(full.body).toBe('{"ok":true}');
    expect(full.bodyEvicted).toBe(false);
  });

  it("marks the entry evicted when Rust no longer has the body, or the call fails", async () => {
    expect((await withBody(bare, async () => null)).bodyEvicted).toBe(true);
    const failed = await withBody(bare, async () => {
      throw new Error("ipc");
    });
    expect(failed.bodyEvicted).toBe(true);
    expect(failed.body).toBe("");
  });

  it("asks for nothing when there is no body to fetch", async () => {
    const never = async () => {
      throw new Error("should not be called");
    };
    const noBody = { ...bare, bodyId: 0 };
    const evicted = { ...bare, bodyEvicted: true };
    expect(await withBody(noBody, never)).toBe(noBody);
    expect(await withBody(evicted, never)).toBe(evicted);
  });

  it("an entry that aged out of the window is marked evicted without a fetch", () => {
    for (let n = 1; n <= BODIES_KEPT + 1; n++) {
      useNetworkStore.getState().addEntry({ ...makeEntry(n), body: "", bodyId: n });
    }
    const [oldest, next] = useNetworkStore.getState().entriesByTab["tab-1"];
    expect(oldest.bodyEvicted).toBe(true);
    expect(next.bodyEvicted).toBe(false);
  });
});

describe("response body eviction", () => {
  it("keeps every body while under the limit", () => {
    add(BODIES_KEPT);
    const entries = useNetworkStore.getState().entriesByTab["tab-1"];
    expect(entries).toHaveLength(BODIES_KEPT);
    expect(entries.every((e) => e.body !== "")).toBe(true);
    expect(entries.some((e) => e.bodyEvicted)).toBe(false);
  });

  it("keeps bodies for exactly the newest N, and marks the rest evicted", () => {
    add(200);
    const entries = useNetworkStore.getState().entriesByTab["tab-1"];
    const withBody = entries.filter((e) => e.body !== "");

    expect(entries).toHaveLength(200);
    expect(withBody).toHaveLength(BODIES_KEPT);
    // The newest ones, not an arbitrary window.
    expect(withBody[0].id).toBe(`net-${200 - BODIES_KEPT + 1}`);
    expect(withBody[withBody.length - 1].id).toBe("net-200");
    // Everything older says why its body is gone, rather than looking like a
    // response that never had one.
    expect(entries.filter((e) => e.bodyEvicted)).toHaveLength(200 - BODIES_KEPT);
  });

  it("keeps metadata on evicted entries", () => {
    add(100);
    const oldest = useNetworkStore.getState().entriesByTab["tab-1"][0];
    expect(oldest.body).toBe("");
    expect(oldest.bodyEvicted).toBe(true);
    // The list view reads all of these — losing them would blank the row.
    expect(oldest.url).toBe("https://example.com/1");
    expect(oldest.statusCode).toBe(200);
    expect(oldest.headers).toHaveLength(1);
  });

  it("evicts per tab, not globally", () => {
    add(60, "tab-1");
    add(10, "tab-2");
    const a = useNetworkStore.getState().entriesByTab["tab-1"];
    const b = useNetworkStore.getState().entriesByTab["tab-2"];
    expect(a.filter((e) => e.body !== "")).toHaveLength(BODIES_KEPT);
    // Ten entries in their own tab are nowhere near the limit.
    expect(b.every((e) => e.body !== "")).toBe(true);
  });
});

describe("entry cap and clearing", () => {
  it("caps entries per tab and keeps the newest", () => {
    add(520);
    const entries = useNetworkStore.getState().entriesByTab["tab-1"];
    expect(entries).toHaveLength(500);
    expect(entries[entries.length - 1].id).toBe("net-520");
    expect(entries[0].id).toBe("net-21");
  });

  it("drops entries while paused", () => {
    useNetworkStore.getState().setPaused(true);
    add(5);
    expect(useNetworkStore.getState().entriesByTab["tab-1"]).toBeUndefined();
  });

  it("clearTab removes only that tab's entries", () => {
    add(3, "tab-1");
    add(3, "tab-2");
    useNetworkStore.getState().clearTab("tab-1");
    expect(useNetworkStore.getState().entriesByTab["tab-1"]).toBeUndefined();
    expect(useNetworkStore.getState().entriesByTab["tab-2"]).toHaveLength(3);
  });
});
