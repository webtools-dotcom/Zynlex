import { beforeEach, describe, expect, it } from "vitest";
import { type AgentFlag, useAgentFlagsStore } from "@/stores/agentFlags";
import { describePicked, flagLine, withFlags } from "./agentFlags";

const flag = (over: Partial<AgentFlag> = {}): AgentFlag => ({
  id: 1,
  tabId: "aaaaaaaa-1",
  ref: "e15",
  role: "button",
  name: "Apply",
  note: "does nothing on mobile",
  ...over,
});

describe("flag queue", () => {
  beforeEach(() => useAgentFlagsStore.setState({ flags: [], pick: null }));

  it("hands each flag over once, per tab, oldest first", () => {
    const s = useAgentFlagsStore.getState();
    s.add({ tabId: "a", ref: "e1", role: "button", name: "", note: "first" });
    s.add({ tabId: "b", ref: "e2", role: "link", name: "", note: "other tab" });
    s.add({ tabId: "a", ref: "e3", role: "button", name: "", note: "second" });

    expect(s.take(["a"]).map((f) => f.note)).toEqual(["first", "second"]);
    expect(s.take(["a"])).toEqual([]);
    expect(useAgentFlagsStore.getState().flags.map((f) => f.tabId)).toEqual(["b"]);
    expect(s.take([])).toEqual([]);
    expect(s.take(["a", "b"]).map((f) => f.ref)).toEqual(["e2"]);
  });

  it("gives each flag its own id and clears all", () => {
    const s = useAgentFlagsStore.getState();
    s.add({ tabId: "a", ref: "e1", role: "button", name: "", note: "" });
    s.add({ tabId: "a", ref: "e1", role: "button", name: "", note: "" });
    const [x, y] = useAgentFlagsStore.getState().flags;
    expect(x.id).not.toBe(y.id);
    s.clear();
    expect(useAgentFlagsStore.getState().flags).toEqual([]);
  });
});

describe("reply prefix", () => {
  it("reads like a sentence an agent can act on", () => {
    expect(flagLine(flag())).toBe('Developer flagged e15 button "Apply": does nothing on mobile');
    expect(flagLine(flag({ name: "", note: "" }))).toBe("Developer flagged e15 button");
    expect(flagLine(flag(), true)).toBe(
      'Developer flagged e15 button "Apply" in [aaaaaaaa]: does nothing on mobile',
    );
  });

  it("keeps a flag on one line and cuts long text", () => {
    const line = flagLine(
      flag({ name: "Save\n  draft", note: `wrong\ncolour ${"x".repeat(400)}` }),
    );
    expect(line).not.toContain("\n");
    expect(line).toContain('"Save draft"');
    expect(line.endsWith("…")).toBe(true);
    expect(line.length).toBeLessThan(400);
  });

  it("goes before the reply, one line per flag", () => {
    expect(withFlags("body", [])).toBe("body");
    expect(withFlags("body", [flag(), flag({ ref: "e2", note: "" })])).toBe(
      'Developer flagged e15 button "Apply": does nothing on mobile\nDeveloper flagged e2 button "Apply"\nbody',
    );
  });
});

describe("describePicked", () => {
  const ax = (nodeId: string, role: string, extra: object = {}) => ({
    nodeId,
    role: { value: role },
    ...extra,
  });

  it("names the control a click inside it meant", () => {
    const nodes = [
      ax("1", "main", { backendDOMNodeId: 2, childIds: ["2"] }),
      ax("2", "button", { backendDOMNodeId: 15, name: { value: "Apply" }, childIds: ["3"] }),
      ax("3", "generic", { backendDOMNodeId: 16, ignored: true }),
    ];
    expect(describePicked(nodes, 16, "svg")).toEqual({ ref: "e15", role: "button", name: "Apply" });
  });

  it("follows parentId when childIds are missing", () => {
    const nodes = [
      ax("3", "StaticText", { backendDOMNodeId: 30, parentId: "2" }),
      ax("2", "link", { backendDOMNodeId: 20, name: { value: "Docs" } }),
    ];
    expect(describePicked(nodes, 30)).toEqual({ ref: "e20", role: "link", name: "Docs" });
  });

  it("falls back to the element itself, by tag when its role is vague", () => {
    const nodes = [ax("1", "heading", { backendDOMNodeId: 7, name: { value: "Cart" } })];
    expect(describePicked(nodes, 7, "h2")).toEqual({ ref: "e7", role: "heading", name: "Cart" });
    const div = [ax("1", "generic", { backendDOMNodeId: 8 })];
    expect(describePicked(div, 8, "div")).toEqual({ ref: "e8", role: "div", name: "" });
    expect(describePicked([], 9)).toEqual({ ref: "e9", role: "element", name: "" });
  });
});
