import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useActiveScope", () => ({ getActiveTabId: () => null }));

// The dialog listener and every CDP call, so a test can open a dialog and see
// which calls reach the (paused) page.
const hooks = vi.hoisted(() => ({
  dialog: null as
    | null
    | ((e: { tabId: string; open: boolean; type?: string; message?: string }) => void),
  cdp: [] as string[],
  status: null as null | ((s: { enabled: boolean; clients: string[] }) => void),
}));
vi.mock("@/services/browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAgentStatus: () => Promise.resolve({ enabled: true, clients: [] }),
  onAgentStatus: (cb: typeof hooks.status) => {
    hooks.status = cb;
    return Promise.resolve(() => {});
  },
  onAgentRequest: () => Promise.resolve(() => {}),
  onDialog: (cb: typeof hooks.dialog) => {
    hooks.dialog = cb;
    return Promise.resolve(() => {});
  },
  tabCdp: (_tab: string, method: string) => {
    hooks.cdp.push(method);
    return Promise.reject(new Error("tab not loaded"));
  },
}));

import { findDevice, listenForAgents, resolveTab, runAgentTool } from "./agent";
import { useConsoleStore } from "@/stores/console";
import { useHeadersStore } from "@/stores/headers";
import { type MockRule, useMocksStore } from "@/stores/mocks";
import { withoutAgentRules } from "@/stores/workspaceRules";
import { type NetworkLogEntry, useNetworkStore } from "@/stores/network";
import { useTabsStore } from "@/stores/tabs";
import type { Tab } from "@/types";

const tab = (id: string, url: string, lastActiveAt = 0): Tab => ({
  id,
  title: id,
  url,
  favicon: null,
  isLoading: false,
  isPinned: false,
  workspaceId: "w",
  createdAt: 0,
  savedFormState: null,
  zoom: 1,
  canGoBack: false,
  canGoForward: false,
  loadTime: null,
  discardedAt: null,
  lastActiveAt,
});

const row = (id: string, statusCode: number, url: string): NetworkLogEntry => ({
  id,
  tabId: "aaaaaaaa-1",
  method: "POST",
  url,
  statusCode,
  reasonPhrase: "",
  resourceType: "fetch",
  durationMs: 12,
  contentLength: 0,
  referrer: "",
  headers: [],
  body: "",
  bodyTruncated: false,
  bodyEvicted: false,
});

const error = (text: string, source = "exception") =>
  useConsoleStore.getState().add({
    tabId: "aaaaaaaa-1",
    level: "error",
    source,
    text,
    url: source === "network" ? text : "http://localhost:5173/app.js",
    line: 3,
  });

describe("agent tools", () => {
  beforeEach(() => {
    useTabsStore.setState({
      tabs: {
        "aaaaaaaa-1": tab("aaaaaaaa-1", "http://localhost:5173/", 2),
        "bbbbbbbb-2": tab("bbbbbbbb-2", "http://localhost:3000/", 1),
        "cccccccc-3": tab("cccccccc-3", "https://mail.example.com/", 9),
      },
    });
    useConsoleStore.setState({ entriesByTab: {}, logsByTab: {}, countsByTab: {} });
    useNetworkStore.setState({ entriesByTab: {} });
  });

  it("only ever resolves localhost tabs", () => {
    expect(resolveTab("bbbb").id).toBe("bbbbbbbb-2");
    // Most recently used localhost tab, even though a non-local one is newer.
    expect(resolveTab(undefined).id).toBe("aaaaaaaa-1");
    expect(() => resolveTab("cccc")).toThrow(/No localhost tab/);
  });

  it("lists localhost tabs and only counts the rest", async () => {
    const out = await runAgentTool("tabs", {});
    expect(out).toContain("http://localhost:5173/");
    expect(out).not.toContain("mail.example.com");
    expect(out).toContain("1 other tabs hidden");
  });

  it("check reports only what's new since the previous check", async () => {
    error("TypeError: first");
    const first = await runAgentTool("check", {});
    expect(first).toContain("First check");
    expect(first).toContain("TypeError: first");

    expect(await runAgentTool("check", {})).toContain("No new errors");

    // Same ms as the cursor would be missed by a Date.now() cursor.
    error("TypeError: second");
    const third = await runAgentTool("check", {});
    expect(third).toContain("TypeError: second");
    expect(third).not.toContain("TypeError: first");
  });

  it("doesn't list a failed request twice when both logs have it", async () => {
    const url = "http://localhost:5173/api/coupon";
    error(url, "network");
    error("http://localhost:5173/api/down", "network");
    useNetworkStore.setState({
      entriesByTab: {
        "aaaaaaaa-1": [
          row("net-7", 500, url),
          row("net-8", 404, "http://localhost:5173/favicon.ico"),
        ],
      },
    });
    const out = await runAgentTool("errors", {});
    expect(out).toContain("2 failed requests:");
    expect(out).toContain("net-7 POST 500");
    expect(out).toContain("/api/down");
    expect(out).not.toContain("favicon");
  });

  it("network hides assets unless asked and returns one request by id", async () => {
    useNetworkStore.setState({
      entriesByTab: {
        "aaaaaaaa-1": [
          { ...row("net-1", 200, "http://localhost:5173/main.js"), resourceType: "script" },
          { ...row("net-2", 200, "http://localhost:5173/api/cart"), body: '{"items":[]}' },
        ],
      },
    });
    const list = await runAgentTool("network", {});
    expect(list).toContain("net-2");
    expect(list).not.toContain("main.js");
    expect(await runAgentTool("network", { all: true })).toContain("main.js");
    expect(await runAgentTool("network", { id: "net-2" })).toContain('{"items":[]}');
  });

  it("reports an open dialog instead of calling into the paused page", async () => {
    listenForAgents();
    hooks.dialog?.({
      tabId: "aaaaaaaa-1",
      open: true,
      type: "confirm",
      message: 'Delete "Buy milk"?',
    });
    hooks.cdp.length = 0;
    for (const tool of ["check", "snapshot", "screenshot"]) {
      const out = await runAgentTool(tool, {});
      expect(out).toContain('A confirm dialog is open: "Delete "Buy milk"?"');
      expect(out).toContain('action="accept"');
    }
    expect(await runAgentTool("act", { ref: "e5", action: "click" })).toContain("dialog is open");
    expect(hooks.cdp).toEqual([]);
    // Reads that don't need the page still work.
    expect(await runAgentTool("errors", {})).not.toContain("dialog");

    hooks.dialog?.({ tabId: "aaaaaaaa-1", open: false });
    await expect(runAgentTool("act", { action: "dismiss" })).rejects.toThrow("No dialog is open");
  });
});

describe("console levels", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: { "aaaaaaaa-1": tab("aaaaaaaa-1", "http://localhost:5173/") } });
    useConsoleStore.setState({ entriesByTab: {}, logsByTab: {}, countsByTab: {} });
    useNetworkStore.setState({ entriesByTab: {} });
  });

  const log = (level: "info" | "log" | "warning", text: string) =>
    useConsoleStore.getState().add({
      tabId: "aaaaaaaa-1",
      level,
      source: "console",
      text,
      url: "http://localhost:5173/app.js",
      line: 1,
    });

  it("errors adds lower levels only when asked", async () => {
    error("TypeError: boom");
    log("warning", "deprecated");
    log("info", "ready");
    log("log", "cart = 3");
    const plain = await runAgentTool("errors", {});
    expect(plain).toContain("TypeError: boom");
    expect(plain).not.toContain("deprecated");
    expect(plain).not.toContain("ready");
    expect(plain).toContain('pass level="warning"');

    // The old flag still works.
    expect(await runAgentTool("errors", { warnings: true })).toContain("deprecated");

    const info = await runAgentTool("errors", { level: "info" });
    expect(info).toContain("deprecated");
    expect(info).toContain("info: ready");
    expect(info).not.toContain("cart = 3");

    const all = await runAgentTool("errors", { level: "log" });
    expect(all).toContain("2 log/info messages:");
    expect(all).toContain("cart = 3");

    await expect(runAgentTool("errors", { level: "debug" })).rejects.toThrow(/level must be/);
  });

  it("says why there are no log messages", async () => {
    expect(await runAgentTool("errors", { level: "log" })).toContain(
      "recorded only while an agent is connected",
    );
  });
});

describe("mock tool", () => {
  const devMock: MockRule = {
    id: "dev00000-mock",
    pattern: "localhost:5173/api/orders",
    method: "",
    status: 200,
    contentType: "",
    body: "[]",
    delayMs: 0,
    enabled: true,
  };

  beforeEach(() => {
    useTabsStore.setState({
      tabs: {
        "aaaaaaaa-1": tab("aaaaaaaa-1", "http://localhost:5173/"),
        "dddddddd-4": { ...tab("dddddddd-4", "http://localhost:4000/"), workspaceId: "other" },
      },
    });
    useMocksStore.setState({ rulesByWs: { w: [devMock] } });
    useHeadersStore.setState({ rulesByWs: {} });
  });

  const idOf = (out: string) => /(?:mock|rule) ([0-9a-f]{8})/.exec(out)?.[1] as string;

  it("adds a mock ahead of the developer's, in the tab's workspace, marked as the agent's", async () => {
    const out = await runAgentTool("mock", {
      action: "add",
      url: "localhost:5173/api/orders",
      method: "post",
      status: 500,
      body: '{"error":"down"}',
      delay: 300,
    });
    expect(out).toMatch(
      /Added mock [0-9a-f]{8}: POST localhost:5173\/api\/orders now answers 500 after 300ms/,
    );
    const rules = useMocksStore.getState().rulesByWs.w;
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ method: "POST", status: 500, delayMs: 300, agent: true });
    expect(rules[1]).toBe(devMock);
    expect(useMocksStore.getState().rulesByWs.other).toBeUndefined();
  });

  it("adds a header rule when given a header", async () => {
    const out = await runAgentTool("mock", {
      action: "add",
      url: "localhost:5173/api",
      header: "Authorization",
      value: "Bearer test",
    });
    expect(out).toContain("Added header rule");
    expect(useHeadersStore.getState().rulesByWs.w[0]).toMatchObject({
      pattern: "localhost:5173/api",
      name: "Authorization",
      value: "Bearer test",
      agent: true,
    });
  });

  it("refuses catch-alls and bad statuses", async () => {
    await expect(runAgentTool("mock", { action: "add", url: "*" })).rejects.toThrow(/catch-all/);
    await expect(runAgentTool("mock", { action: "add" })).rejects.toThrow(/catch-all/);
    await expect(
      runAgentTool("mock", { action: "add", url: "localhost:5173/x", status: 99 }),
    ).rejects.toThrow(/status/);
    await expect(
      runAgentTool("mock", { action: "add", url: "localhost:5173/x", header: "X-A" }),
    ).rejects.toThrow(/value/);
  });

  it("lists both kinds, telling the agent's from the developer's", async () => {
    await runAgentTool("mock", { action: "add", url: "localhost:5173/api/a", status: 404 });
    await runAgentTool("mock", {
      action: "add",
      url: "localhost:5173/",
      header: "X-A",
      value: "1",
    });
    const out = await runAgentTool("mock", { action: "list" });
    expect(out).toContain("ANY 404 localhost:5173/api/a (yours)");
    expect(out).toContain("dev00000 ANY 200 localhost:5173/api/orders (developer's)");
    expect(out).toContain("localhost:5173/ → X-A: 1 (yours)");
    expect(await runAgentTool("mock", { action: "list", tab: "dddd" })).toContain(
      "No mocks or header rules",
    );
  });

  it("removes and clears only the agent's own rules", async () => {
    const id = idOf(await runAgentTool("mock", { action: "add", url: "localhost:5173/a" }));
    await runAgentTool("mock", { action: "add", url: "localhost:5173/b" });
    await runAgentTool("mock", {
      action: "add",
      url: "localhost:5173/",
      header: "X-A",
      value: "1",
    });
    await expect(runAgentTool("mock", { action: "remove", id: "dev00000" })).rejects.toThrow(
      /developer's/,
    );
    expect(await runAgentTool("mock", { action: "remove", id })).toContain(`Removed mock ${id}`);
    expect(await runAgentTool("mock", { action: "clear" })).toContain("Removed your 2 rules");
    expect(useMocksStore.getState().rulesByWs.w).toEqual([devMock]);
    expect(useHeadersStore.getState().rulesByWs.w).toEqual([]);
  });

  it("never persists the agent's rules", async () => {
    await runAgentTool("mock", { action: "add", url: "localhost:5173/a" });
    // The persist middleware's partialize (no storage under Vitest, so called directly).
    const saved = withoutAgentRules(useMocksStore.getState().rulesByWs);
    expect(saved).toEqual({ w: [devMock] });
  });

  it("drops the agent's rules when the last agent disconnects", async () => {
    listenForAgents();
    // Let the initial getAgentStatus (no clients) land first.
    await new Promise((r) => setTimeout(r, 0));
    hooks.status?.({ enabled: true, clients: ["claude-code"] });
    await runAgentTool("mock", { action: "add", url: "localhost:5173/a" });
    await runAgentTool("mock", { action: "add", url: "localhost:4000/", tab: "dddd" });
    hooks.status?.({ enabled: true, clients: [] });
    expect(useMocksStore.getState().rulesByWs).toEqual({ w: [devMock], other: [] });
  });
});

describe("findDevice", () => {
  it("matches device names loosely, preferring an exact name", () => {
    expect(findDevice("iPhone 16")?.label).toBe("iPhone 16");
    expect(findDevice("iphone16")?.label).toBe("iPhone 16");
    expect(findDevice("iPhone 16 Pro")?.label).toBe("iPhone 16 Pro");
    expect(findDevice("ipad")?.label).toBe("iPad");
    expect(findDevice("pixel")?.label).toBe("Pixel 9");
    expect(findDevice("nokia 3310")).toBeUndefined();
  });

  it("gives phones their touch and mobile flags", () => {
    const d = findDevice("Pixel 9");
    expect(d?.mobile).toBe(true);
    expect(d?.touch).toBe(true);
    expect(d?.width).toBeLessThan(500);
  });
});
