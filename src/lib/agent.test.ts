import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useActiveScope", () => ({ getActiveTabId: () => null }));

// The dialog listener and every CDP call, so a test can open a dialog and see
// which calls reach the (paused) page.
const hooks = vi.hoisted(() => ({
  dialog: null as
    | null
    | ((e: { tabId: string; open: boolean; type?: string; message?: string }) => void),
  cdp: [] as string[],
  writes: [] as { name: string; text: string }[],
  status: null as null | ((s: { enabled: boolean; clients: string[] }) => void),
  /** When set, the page's accessibility tree; otherwise every CDP call fails (tab not loaded). */
  ax: null as null | object[],
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
  closeTabWebview: () => Promise.resolve(),
  agentWriteTemp: (name: string, text: string) => {
    hooks.writes.push({ name, text });
    return Promise.resolve(`C:\\Temp\\zynlex-agent\\zynlex-${name}.txt`);
  },
  tabCdp: (_tab: string, method: string) => {
    hooks.cdp.push(method);
    if (hooks.ax && method === "Accessibility.getFullAXTree") {
      return Promise.resolve({ nodes: hooks.ax });
    }
    return Promise.reject(new Error("tab not loaded"));
  },
}));

import {
  cut,
  dragPath,
  evalSource,
  findDevice,
  formatEvalValue,
  handleAgentCall,
  historyTarget,
  listenForAgents,
  parseWaitFor,
  resolveTab,
  runAgentTool,
  waitPending,
} from "./agent";
import { useConsoleStore } from "@/stores/console";
import { useHeadersStore } from "@/stores/headers";
import { type MockRule, useMocksStore } from "@/stores/mocks";
import { withoutAgentRules } from "@/stores/workspaceRules";
import { type NetworkLogEntry, useNetworkStore } from "@/stores/network";
import { useTabsStore } from "@/stores/tabs";
import type { Tab } from "@/types";
import { notePopup, popupMark, takePopups } from "./agentTabs";
import { cancelPause, PAUSE_HOLD_MS, PAUSED_REPLY, pauseAgent, resumeAgent } from "./agentPause";
import { useAgentStore } from "@/stores/agent";
import { useAgentActivityStore } from "@/stores/agentActivity";

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

  it("closes only tabs the agent opened", async () => {
    useTabsStore.setState((s) => ({
      tabs: {
        ...s.tabs,
        "dddddddd-4": tab("dddddddd-4", "http://localhost:5173/terms"),
        "eeeeeeee-5": tab("eeeeeeee-5", "https://accounts.example.com/oauth"),
      },
    }));
    const mark = popupMark();
    notePopup("aaaaaaaa-1", "dddddddd-4", "http://localhost:5173/terms");
    notePopup("aaaaaaaa-1", "eeeeeeee-5", "https://accounts.example.com/oauth");
    // What an act on aaaaaaaa-1 does after the click.
    expect(takePopups("aaaaaaaa-1", mark)).toHaveLength(2);

    expect(await runAgentTool("tabs", {})).toContain(
      'localhost:5173/terms "dddddddd-4" [dddddddd] (opened by you)',
    );
    await expect(runAgentTool("tabs", { close: "bbbb" })).rejects.toThrow("the developer's");
    await expect(runAgentTool("tabs", { close: "cccc" })).rejects.toThrow("No tab you opened");

    const out = await runAgentTool("tabs", { close: "dddd" });
    expect(out).toContain("Closed [dddddddd]");
    expect(useTabsStore.getState().tabs["dddddddd-4"]).toBeUndefined();
    // A non-localhost popup can't be used, but it can be closed.
    await runAgentTool("tabs", { close: "eeee" });
    expect(useTabsStore.getState().tabs["eeeeeeee-5"]).toBeUndefined();
    await expect(runAgentTool("tabs", { close: "dddd" })).rejects.toThrow("No tab you opened");
  });

  it("writes a body over 8 KB to a file and returns its head and the path", async () => {
    const big = `{"rows":[${"1,".repeat(6000)}1]}`;
    useNetworkStore.setState({
      entriesByTab: {
        "aaaaaaaa-1": [{ ...row("net-3", 200, "http://localhost:5173/api/rows"), body: big }],
      },
    });
    hooks.writes.length = 0;
    const out = await runAgentTool("network", { id: "net-3" });
    expect(hooks.writes).toHaveLength(1);
    expect(hooks.writes[0].text).toBe(big);
    expect(hooks.writes[0].name).toMatch(/^body-aaaaaaaa-net-3-\d+$/);
    expect(out).toContain(
      `… ${big.length - 8000} more chars; all of it is in C:\\Temp\\zynlex-agent\\`,
    );
    expect(out.length).toBeLessThan(8500);
  });

  it("rejects upload paths that aren't absolute before touching the page", async () => {
    hooks.cdp.length = 0;
    await expect(
      runAgentTool("act", { ref: "e4", action: "upload", files: ["photo.png"] }),
    ).rejects.toThrow("isn't an absolute path");
    await expect(runAgentTool("act", { ref: "e4", action: "upload" })).rejects.toThrow(
      "upload needs files",
    );
    expect(hooks.cdp).toEqual([]);
  });

  it("takes either an element or the whole page in a screenshot, not both", async () => {
    await expect(runAgentTool("screenshot", { ref: "e4", full: true })).rejects.toThrow(
      "Pass ref or full, not both.",
    );
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
    for (const tool of ["check", "snapshot", "screenshot", "eval", "wait_for"]) {
      const out = await runAgentTool(tool, {});
      expect(out).toContain('A confirm dialog is open: "Delete "Buy milk"?"');
      expect(out).toContain('action="accept"');
    }
    expect(await runAgentTool("act", { ref: "e5", action: "click" })).toContain("dialog is open");
    expect(await runAgentTool("act", { action: "back" })).toContain("dialog is open");
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

describe("eval", () => {
  it("runs code with a return as an async function body, else as an expression", () => {
    expect(evalSource("document.title")).toBe("document.title");
    expect(evalSource("await fetch('/api').then((r) => r.status)")).toBe(
      "await fetch('/api').then((r) => r.status)",
    );
    const body = evalSource("const r = await fetch('/api');\nreturn r.status;");
    expect(body.startsWith("(async () => {")).toBe(true);
    expect(body.endsWith("})()")).toBe(true);
  });

  it("formats values as compact JSON", () => {
    expect(formatEvalValue({ type: "object", value: { a: [1, 2], b: "x" } })).toBe(
      '{"a":[1,2],"b":"x"}',
    );
    expect(formatEvalValue({ type: "string", value: "hi" })).toBe('"hi"');
    expect(formatEvalValue({ type: "undefined" })).toBe("undefined");
    expect(formatEvalValue({ type: "number", unserializableValue: "NaN" })).toBe("NaN");
    expect(formatEvalValue({ type: "function", description: "function f() {}" })).toBe(
      "function f() {}",
    );
  });

  it("cuts long output with a note", () => {
    expect(cut("short", 4000)).toBe("short");
    const out = cut("x".repeat(5000), 4000);
    expect(out.startsWith("x".repeat(4000))).toBe(true);
    expect(out).toContain("1000 more chars cut");
  });

  it("needs code", async () => {
    await expect(runAgentTool("eval", {})).rejects.toThrow("Pass code");
  });
});

describe("back/forward", () => {
  const h = {
    currentIndex: 1,
    entries: [
      { id: 10, url: "http://localhost:5173/" },
      { id: 11, url: "http://localhost:5173/cart" },
      { id: 12, url: "https://pay.example.com/" },
    ],
  };

  it("picks the neighbouring entry", () => {
    expect(historyTarget(h, "back").id).toBe(10);
    expect(historyTarget({ ...h, currentIndex: 0 }, "forward").id).toBe(11);
  });

  it("refuses to run off the history or off localhost", () => {
    expect(() => historyTarget({ ...h, currentIndex: 0 }, "back")).toThrow("Nothing to go back");
    expect(() => historyTarget({ ...h, currentIndex: 2 }, "forward")).toThrow(
      "Nothing to go forward",
    );
    expect(() => historyTarget(h, "forward")).toThrow("would leave localhost");
  });
});

describe("drag", () => {
  it("moves in even steps that end on the target", () => {
    const path = dragPath({ x: 0, y: 0 }, { x: 100, y: 50 });
    expect(path).toHaveLength(5);
    expect(path[0]).toEqual({ x: 20, y: 10 });
    expect(path[4]).toEqual({ x: 100, y: 50 });
  });

  it("needs a target ref", async () => {
    await expect(runAgentTool("act", { action: "drag", ref: "e3" })).rejects.toThrow(
      "Expected a ref",
    );
  });
});

describe("wait_for", () => {
  it("validates conditions and caps the timeout", () => {
    expect(() => parseWaitFor({})).toThrow("Pass text");
    expect(() => parseWaitFor({ text: "Saved", timeout: -1 })).toThrow("seconds");
    expect(parseWaitFor({ text: "Saved" }).timeoutMs).toBe(10_000);
    expect(parseWaitFor({ url: "/done", timeout: 120 }).timeoutMs).toBe(30_000);
    expect(parseWaitFor({ gone: "Loading", timeout: 2.5 }).timeoutMs).toBe(2500);
  });

  it("lists what is still pending", () => {
    const spec = parseWaitFor({ text: "Saved", gone: "Loading", url: "/done" });
    expect(waitPending(spec, "Loading…", "http://localhost:5173/form")).toEqual([
      'text "Saved" to appear',
      'text "Loading" to disappear',
      'URL to contain "/done"',
    ]);
    expect(waitPending(spec, "Saved!", "http://localhost:5173/done")).toEqual([]);
  });
});

describe("take over (pause) and activity", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: { "aaaaaaaa-1": tab("aaaaaaaa-1", "http://localhost:5173/") } });
    useMocksStore.setState({ rulesByWs: {} });
    useHeadersStore.setState({ rulesByWs: {} });
    useConsoleStore.setState({ entriesByTab: {}, logsByTab: {}, countsByTab: {} });
    useAgentStore.setState({ enabled: true, clients: ["claude-code"], pausedAt: null, waiting: 0 });
    useAgentActivityStore.getState().clear();
  });

  it("holds a page action while paused, answers reads, and runs it on Resume with the takeover line", async () => {
    pauseAgent(Date.now() - 42_000);
    let out: string | null = null;
    const held = runAgentTool("mock", {
      action: "add",
      url: "localhost:5173/api/a",
      status: 500,
    }).then((t) => {
      out = t;
    });
    // Reads still answer.
    expect(await runAgentTool("mock", { action: "list" })).toContain("No mocks or header rules");
    expect(await runAgentTool("errors", {})).toContain("localhost:5173");
    await new Promise((r) => setTimeout(r, 5));
    expect(out).toBeNull();
    expect(useMocksStore.getState().rulesByWs.w ?? []).toHaveLength(0);

    resumeAgent();
    await held;
    const lines = (out as unknown as string).split("\n");
    expect(lines[0]).toBe(
      "The developer took over for 42 s and resumed; the page may have changed.",
    );
    expect(out).toContain("Added mock");
    expect(useMocksStore.getState().rulesByWs.w).toHaveLength(1);
  });

  it("after a takeover, shows what the developer changed since the agent's last snapshot", async () => {
    // Enough unchanged buttons that a diff is shorter than the page.
    const names = ["One", "Two", "Three", "Four", "Five", "Six"];
    const page = (button: string) => [
      {
        nodeId: "1",
        role: { value: "RootWebArea" },
        name: { value: "App" },
        childIds: ["2", ...names],
      },
      ...[["2", button], ...names.map((n) => [n, n])].map(([id, name], i) => ({
        nodeId: id,
        role: { value: "button" },
        name: { value: name },
        childIds: [],
        backendDOMNodeId: 12 + i,
      })),
    ];
    hooks.ax = page("Save");
    try {
      expect(await runAgentTool("snapshot", {})).toContain('button "Save"');
      pauseAgent(Date.now() - 7_000);
      const p = runAgentTool("mock", { action: "add", url: "localhost:5173/api/a" });
      hooks.ax = page("Saved!");
      resumeAgent();
      const lines = (await p).split("\n");
      expect(lines[0]).toMatch(/^The developer took over for 7 s and resumed/);
      expect(lines[1]).toBe("Page changes since your last look:");
      expect(lines.join("\n")).toContain('button "Saved!"');
      expect(lines[lines.length - 1]).toMatch(/Added mock/);
    } finally {
      hooks.ax = null;
    }
  });

  it("answers 'call again later' and doesn't run the call when the pause outlasts the hold", async () => {
    vi.useFakeTimers();
    try {
      pauseAgent();
      const p = runAgentTool("mock", { action: "add", url: "localhost:5173/api/a" });
      await vi.advanceTimersByTimeAsync(PAUSE_HOLD_MS);
      expect(await p).toBe(PAUSED_REPLY);
      cancelPause();
      expect(useMocksStore.getState().rulesByWs.w ?? []).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses held calls when the developer presses Stop", async () => {
    listenForAgents();
    pauseAgent();
    const p = runAgentTool("tabs", { close: "aaaaaaaa" });
    hooks.status?.({ enabled: false, clients: [] });
    await expect(p).rejects.toThrow(/stopped the agent/);
    expect(useAgentStore.getState().pausedAt).toBeNull();
  });

  it("records each call: tool, tab, summary, errors, and marks tabs it acted on", async () => {
    await handleAgentCall("errors", {});
    await handleAgentCall("mock", { action: "add", url: "localhost:5173/api/a", status: 404 });
    const bad = await handleAgentCall("act", { action: "click", ref: "e1", tab: "zz" });
    expect(bad.ok).toBe(false);
    const calls = useAgentActivityStore.getState().calls;
    expect(calls.map((c) => c.tool)).toEqual(["act", "mock", "errors"]);
    expect(calls[0]).toMatchObject({ tabId: null, error: 'No localhost tab "zz". Call tabs.' });
    expect(calls[0].summary).toBe("action=click ref=e1");
    expect(calls[1]).toMatchObject({
      tabId: "aaaaaaaa-1",
      tabLabel: "[aaaaaaaa] http://localhost:5173/",
      error: null,
      summary: "action=add url=localhost:5173/api/a status=404",
    });
    // A read doesn't mark the tab; the mock did.
    expect(useAgentActivityStore.getState().touched).toEqual({ "aaaaaaaa-1": calls[1].at });
  });

  it("records a held call that timed out as not run, without marking the tab", async () => {
    vi.useFakeTimers();
    try {
      pauseAgent();
      const p = handleAgentCall("mock", { action: "add", url: "localhost:5173/api/a" });
      await vi.advanceTimersByTimeAsync(PAUSE_HOLD_MS);
      expect((await p).text).toBe(PAUSED_REPLY);
      cancelPause();
    } finally {
      vi.useRealTimers();
    }
    const [c] = useAgentActivityStore.getState().calls;
    expect(c.note).toBe("paused, not run");
    expect(useAgentActivityStore.getState().touched).toEqual({});
  });
});
