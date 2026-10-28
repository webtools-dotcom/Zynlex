import { beforeEach, describe, expect, it } from "vitest";
import { useConsoleStore } from "@/stores/console";

const msg = (
  over: Partial<Parameters<ReturnType<typeof useConsoleStore.getState>["add"]>[0]> = {},
) => ({
  tabId: "t1",
  level: "error" as const,
  source: "exception",
  text: "TypeError: x is undefined",
  url: "http://localhost:3000/app.js",
  line: 10,
  ...over,
});

describe("console store", () => {
  beforeEach(() => useConsoleStore.setState({ entriesByTab: {}, countsByTab: {} }));

  it("counts errors, warnings and failed requests apart", () => {
    const { add } = useConsoleStore.getState();
    add(msg());
    add(msg({ level: "warning", source: "console", text: "deprecated" }));
    add(msg({ source: "network", text: "Failed to load resource: 500" }));
    expect(useConsoleStore.getState().countsByTab.t1).toEqual({
      errors: 1,
      warnings: 1,
      failed: 1,
    });
  });

  it("collapses a repeated message but still counts every one", () => {
    const { add } = useConsoleStore.getState();
    for (let i = 0; i < 5; i++) add(msg());
    const s = useConsoleStore.getState();
    expect(s.entriesByTab.t1).toHaveLength(1);
    expect(s.entriesByTab.t1[0].count).toBe(5);
    expect(s.countsByTab.t1.errors).toBe(5);
  });

  it("keeps counting past the entry cap", () => {
    const { add } = useConsoleStore.getState();
    for (let i = 0; i < 400; i++) add(msg({ text: `e${i}` }));
    const s = useConsoleStore.getState();
    expect(s.entriesByTab.t1).toHaveLength(300);
    expect(s.countsByTab.t1.errors).toBe(400);
  });

  it("clears one tab only", () => {
    const { add, clearTab } = useConsoleStore.getState();
    add(msg());
    add(msg({ tabId: "t2" }));
    clearTab("t1");
    const s = useConsoleStore.getState();
    expect(s.countsByTab.t1).toBeUndefined();
    expect(s.countsByTab.t2.errors).toBe(1);
  });
});
