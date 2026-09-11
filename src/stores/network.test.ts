/**
 * The network log is bounded twice over: a cap on entries per tab, and a much
 * smaller cap on how many of those keep their response body. Rust ships up to
 * 64 KB per body, so without the second cap a busy tab retained tens of MB of
 * strings for as long as it lived.
 *
 * Eviction happens on the single entry crossing the boundary rather than by
 * rescanning the list, which is what makes the arithmetic worth pinning down.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useNetworkStore, type NetworkLogEntry } from "@/stores/network";

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
