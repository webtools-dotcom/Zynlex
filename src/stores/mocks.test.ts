import { beforeEach, describe, expect, it } from "vitest";
import { mockRuleFromEntry, useMocksStore } from "@/stores/mocks";
import type { NetworkLogEntry } from "@/stores/network";

const entry: NetworkLogEntry = {
  id: "net-1",
  tabId: "t",
  method: "GET",
  url: "http://localhost:8000/api/users?page=2",
  statusCode: 200,
  reasonPhrase: "OK",
  resourceType: "fetch",
  durationMs: 12,
  contentLength: 2,
  referrer: "",
  headers: [["content-type", "application/json; charset=utf-8"]],
  body: "[]",
  bodyTruncated: false,
  bodyEvicted: false,
};

describe("mocks", () => {
  beforeEach(() => useMocksStore.setState({ rulesByWs: {} }));

  it("seeds a mock from a captured response", () => {
    const rule = mockRuleFromEntry(entry);
    // Scheme stripped: Rust matches scheme-less, prefix-first.
    expect(rule.pattern).toBe("localhost:8000/api/users?page=2");
    expect(rule).toMatchObject({
      method: "GET",
      status: 200,
      contentType: "application/json; charset=utf-8",
      body: "[]",
      enabled: true,
    });
  });

  it("keeps rules per workspace", () => {
    const { addRule, updateRule, removeRule } = useMocksStore.getState();
    const rule = mockRuleFromEntry(entry);
    addRule("a", rule);
    updateRule("a", rule.id, { status: 500 });
    expect(useMocksStore.getState().rulesByWs.a[0].status).toBe(500);
    expect(useMocksStore.getState().rulesByWs.b).toBeUndefined();
    removeRule("a", rule.id);
    expect(useMocksStore.getState().rulesByWs.a).toEqual([]);
  });
});
