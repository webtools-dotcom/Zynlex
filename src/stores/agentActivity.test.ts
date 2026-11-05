import { beforeEach, describe, expect, it } from "vitest";
import { firstLine, MAX_CALLS, summarizeCall, useAgentActivityStore } from "./agentActivity";

const call = (n: number, tabId: string | null = "t1") => ({
  at: n,
  tool: "act",
  tabId,
  tabLabel: "[t1] http://localhost:5173/",
  summary: `action=click ref=e${n}`,
  error: null,
  ms: 3,
  note: null,
});

beforeEach(() => useAgentActivityStore.getState().clear());

describe("agent activity store", () => {
  it("keeps the newest calls first, at most MAX_CALLS", () => {
    const { record } = useAgentActivityStore.getState();
    for (let i = 1; i <= MAX_CALLS + 5; i++) record(call(i), false);
    const { calls } = useAgentActivityStore.getState();
    expect(calls).toHaveLength(MAX_CALLS);
    expect(calls[0].at).toBe(MAX_CALLS + 5);
    expect(calls[MAX_CALLS - 1].at).toBe(6);
    expect(new Set(calls.map((c) => c.id)).size).toBe(MAX_CALLS);
  });

  it("marks a tab only when the call acted on it", () => {
    const { record } = useAgentActivityStore.getState();
    record(call(1, "read"), false);
    record(call(2, "acted"), true);
    record(call(3, null), true);
    expect(useAgentActivityStore.getState().touched).toEqual({ acted: 2 });
    record(call(7, "acted"), true);
    expect(useAgentActivityStore.getState().touched.acted).toBe(7);
  });

  it("clears the list and the markers", () => {
    useAgentActivityStore.getState().record(call(1), true);
    useAgentActivityStore.getState().clear();
    expect(useAgentActivityStore.getState()).toMatchObject({ calls: [], touched: {} });
  });
});

describe("summarizeCall", () => {
  it("puts the arguments on one line, leaving out tab and empty values", () => {
    expect(summarizeCall({ action: "click", ref: "e12", tab: "aaaa", text: "" })).toBe(
      "action=click ref=e12",
    );
    expect(summarizeCall({ action: "type", ref: "e4", text: "hello world" })).toBe(
      'action=type ref=e4 text="hello world"',
    );
    expect(summarizeCall({ reload: true, timeout: 5 })).toBe("reload=true timeout=5");
  });

  it("stays short and on one line", () => {
    const out = summarizeCall({ code: `document.title\n${"x".repeat(200)}`, more: "y".repeat(80) });
    expect(out).not.toContain("\n");
    expect(out.length).toBeLessThanOrEqual(90);
  });

  it("takes an error's first line", () => {
    expect(firstLine('No localhost tab "zz". Call tabs.\nmore')).toBe(
      'No localhost tab "zz". Call tabs.',
    );
  });
});
