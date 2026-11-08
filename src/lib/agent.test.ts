import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isLoopbackUrl } from "@/lib/url";

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
  requests: [] as ((r: { id: number; tool: string; args: object | null }) => void)[],
  replies: [] as number[],
  /** `agent_ready` calls, and how many request listeners existed at each. */
  ready: [] as number[],
  /** When set, the page's accessibility tree; otherwise every CDP call fails (tab not loaded). */
  ax: null as null | object[],
  /** When set, answers other CDP calls (undefined: fail as "tab not loaded"). */
  answer: null as null | ((method: string, params: { functionDeclaration?: string }) => unknown),
  /** What `port_owners` answers, and the ports it was last asked about. */
  owners: [] as object[],
  ownerPorts: [] as number[],
}));
vi.mock("@/services/browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAgentStatus: () => Promise.resolve({ enabled: true, clients: [] }),
  onAgentStatus: (cb: typeof hooks.status) => {
    hooks.status = cb;
    return Promise.resolve(() => {});
  },
  onAgentRequest: (cb: (typeof hooks.requests)[number]) => {
    hooks.requests.push(cb);
    return Promise.resolve(() => {});
  },
  agentReady: () => {
    hooks.ready.push(hooks.requests.length);
    return Promise.resolve();
  },
  agentReply: (id: number) => {
    hooks.replies.push(id);
    return Promise.resolve();
  },
  onDialog: (cb: typeof hooks.dialog) => {
    hooks.dialog = cb;
    return Promise.resolve(() => {});
  },
  closeTabWebview: () => Promise.resolve(),
  agentWriteTemp: (name: string, text: string) => {
    hooks.writes.push({ name, text });
    return Promise.resolve(`C:\\Temp\\zynlex-agent\\zynlex-${name}.txt`);
  },
  portOwners: (ports: number[]) => {
    hooks.ownerPorts = ports;
    return Promise.resolve(hooks.owners);
  },
  tabCdp: (_tab: string, method: string, params?: { functionDeclaration?: string }) => {
    hooks.cdp.push(method);
    if (hooks.ax && method === "Accessibility.getFullAXTree") {
      return Promise.resolve({ nodes: hooks.ax });
    }
    const answer = hooks.answer?.(method, params ?? {});
    if (answer !== undefined) return Promise.resolve(answer);
    return Promise.reject(new Error("tab not loaded"));
  },
}));

import { useAgentStore } from "@/stores/agent";
import { useAgentActivityStore } from "@/stores/agentActivity";
import { useAgentFlagsStore } from "@/stores/agentFlags";
import { useConsoleStore } from "@/stores/console";
import { useHeadersStore } from "@/stores/headers";
import { type MockRule, useMocksStore } from "@/stores/mocks";
import { type NetworkLogEntry, useNetworkStore } from "@/stores/network";
import { useServersStore } from "@/stores/servers";
import { useTabsStore } from "@/stores/tabs";
import { withoutAgentRules } from "@/stores/workspaceRules";
import type { Tab } from "@/types";
import {
  cut,
  downloadLines,
  dragPath,
  errorLine,
  evalSource,
  findDevice,
  formatEvalValue,
  HIDDEN,
  handleAgentCall,
  historyTarget,
  listenForAgents,
  MARK,
  ownerText,
  parseWaitFor,
  QUIET_PROBE,
  resolveTab,
  runAgentTool,
  TAKES_TEXT,
  vitalsText,
  waitPending,
} from "./agent";
import { cancelPause, PAUSE_HOLD_MS, PAUSED_REPLY, pauseAgent, resumeAgent } from "./agentPause";
import { notePopup, popupMark, takePopups } from "./agentTabs";
import { forgetTab, notePageLoad } from "./errorGroups";

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
    forgetTab("aaaaaaaa-1");
  });

  it("only ever resolves localhost tabs", () => {
    expect(resolveTab("bbbb").id).toBe("bbbbbbbb-2");
    // Most recently used localhost tab, even though a non-local one is newer.
    expect(resolveTab(undefined).id).toBe("aaaaaaaa-1");
    expect(() => resolveTab("cccc")).toThrow(/No tab "cccc" you can use/);
  });

  it("lists localhost tabs and only counts the rest", async () => {
    const out = await runAgentTool("tabs", {});
    expect(out).toContain("http://localhost:5173/");
    expect(out).not.toContain("mail.example.com");
    expect(out).toContain("1 other tabs hidden");
  });

  it("says which process and folder serve each tab and idle dev server", async () => {
    useServersStore.setState({
      servers: [
        { port: 5174, isAlive: true, protocol: "http", title: "Vite" } as never,
        { port: 5173, isAlive: true, protocol: "http", title: "Shop" } as never,
      ],
    });
    const now = Date.now();
    hooks.owners = [
      {
        port: 5173,
        pid: 41,
        name: "node.exe",
        exe: "C:\\node.exe",
        cwd: "D:\\work\\shop",
        startedMs: now - 2 * 3600_000,
      },
      {
        port: 5174,
        pid: 9,
        name: "node.exe",
        exe: "C:\\node.exe",
        cwd: "D:\\old\\shop",
        startedMs: now - 3 * 86400_000,
      },
    ];
    const out = await runAgentTool("tabs", {});
    hooks.owners = [];
    useServersStore.setState({ servers: [] });
    expect(hooks.ownerPorts).toEqual([5173, 3000, 5174]);
    expect(out).toContain(
      '"aaaaaaaa-1" [aaaaaaaa]\n    served by node.exe in D:\\work\\shop (pid 41, up 2h)',
    );
    // The tab on :3000 has no listener: no line, no guess.
    expect(out).toContain("[bbbbbbbb]\n1 dev servers without a tab:");
    expect(out).toContain(
      'http://localhost:5174 "Vite"\n    served by node.exe in D:\\old\\shop (pid 9, up 3d)',
    );
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

  it("check groups repeats, and shows one already reported only as +N", async () => {
    error("TypeError: x is undefined");
    await runAgentTool("check", {});
    for (let i = 0; i < 3; i++) error("TypeError: x is undefined");
    expect(await runAgentTool("check", {})).toContain(
      "1 errors:\n  TypeError: x is undefined at /app.js:3 (+3)",
    );
    // A reload clears the store, not the agent's log.
    useConsoleStore.getState().clearTab("aaaaaaaa-1");
    notePageLoad("aaaaaaaa-1");
    error("TypeError: x is undefined");
    expect(await runAgentTool("errors", {})).toMatch(
      /TypeError: x is undefined at \/app\.js:3 \(×5 since \d\d:\d\d, across 2 page loads\)/,
    );
  });

  it("gives an agent what the page logged before it connected, once", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      listenForAgents();
      // Its initial status read (no agents) lands first, as in the app.
      await Promise.resolve();
      vi.setSystemTime(1_000_000);
      hooks.status?.({ enabled: true, clients: [] });
      error("TypeError: from before");
      notePageLoad("aaaaaaaa-1");
      error("http://localhost:5173/api/me", "network");
      vi.setSystemTime(2_000_000);
      hooks.status?.({ enabled: true, clients: ["claude-code"] });
      vi.setSystemTime(3_000_000);
      error("TypeError: after");
      const first = await runAgentTool("errors", {});
      expect(first).toContain(
        "Before you connected:\n1 errors:\n  TypeError: from before at /app.js:3\n1 failed requests:\n",
      );
      expect(first).toContain("Since you connected:\n1 errors:\n  TypeError: after");
      const second = await runAgentTool("check", {});
      expect(second).not.toContain("Before you connected");
      expect(second).toContain("No new errors");
    } finally {
      hooks.status?.({ enabled: true, clients: [] });
      vi.useRealTimers();
    }
  });

  it("doesn't list a failed request twice when both logs have it", async () => {
    // Connected first, so both failures are "since you connected", not split by a clock tick.
    hooks.status?.({ enabled: true, clients: ["claude-code"] });
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
    hooks.status?.({ enabled: true, clients: [] });
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

  it("lists WebSockets with their frame counts, and a socket's id gives its frames", async () => {
    const now = Date.now();
    useNetworkStore.setState({
      socketsByTab: {
        "aaaaaaaa-1": [
          {
            id: "ws-4",
            socket: "7.1",
            url: "ws://localhost:5173/live",
            state: "open",
            error: "",
            openedAt: now - 10_000,
            sent: 1,
            received: 2,
            frames: [
              { dir: "sent", at: now - 3000, data: '{"subscribe":"orders"}' },
              { dir: "received", at: now - 2000, data: '{"orders":\n 6}' },
              { dir: "received", at: now, data: "x".repeat(400) },
            ],
          },
          {
            id: "ws-5",
            socket: "7.2",
            url: "ws://localhost:5173/bad",
            state: "error",
            error: "Invalid frame header",
            openedAt: now,
            sent: 0,
            received: 0,
            frames: [],
          },
        ],
      },
    });
    const list = await runAgentTool("network", {});
    expect(list).toContain("WebSockets (↑ sent, ↓ received; pass id for the frames):");
    expect(list).toContain("  ws-4 open ws://localhost:5173/live ↑1 ↓2");
    expect(await runAgentTool("network", { failed: true })).toContain(
      "  ws-5 error: Invalid frame header ws://localhost:5173/bad ↑0 ↓0",
    );
    expect(await runAgentTool("network", { match: "live" })).not.toContain("ws-5");
    const frames = await runAgentTool("network", { id: "ws-4" });
    expect(frames).toContain('  ↑ 3s ago {"subscribe":"orders"}');
    // One line per frame, cut.
    expect(frames).toContain('  ↓ 2s ago {"orders": 6}');
    expect(frames).toContain(`  ↓ 0s ago ${"x".repeat(300)}…`);
    expect(await runAgentTool("network", { id: "ws-5" })).toContain("No frames yet.");
    useNetworkStore.setState({ socketsByTab: {} });
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

  describe("refs and text fields, checked before acting", () => {
    // A page with one button, e12 "Save". `hidden` is what the page says
    // about a ref that isn't in it (null: it can't even be resolved);
    // `takesText` what it says when asked whether e12 takes text.
    const fake = (hidden: string | null, takesText = "") => {
      hooks.cdp.length = 0;
      hooks.ax = [
        { nodeId: "1", role: { value: "RootWebArea" }, name: { value: "App" }, childIds: ["2"] },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "Save" },
          childIds: [],
          backendDOMNodeId: 12,
        },
      ];
      hooks.answer = (method, p) => {
        if (method === "Runtime.evaluate") return { result: { value: 1 } };
        if (method === "DOM.resolveNode")
          return hidden == null ? undefined : { object: { objectId: "o" } };
        if (method === "Runtime.callFunctionOn") {
          const fn = p.functionDeclaration ?? "";
          if (fn.includes("isContentEditable")) return { result: { value: takesText } };
          if (fn.includes("isConnected")) return { result: { value: hidden } };
        }
        return undefined;
      };
    };
    const clicked = () => hooks.cdp.includes("Input.dispatchMouseEvent");
    afterEach(() => {
      hooks.ax = null;
      hooks.answer = null;
      useAgentFlagsStore.setState({ flags: [] });
    });

    it("won't click a ref that isn't in the page, and says why", async () => {
      fake("");
      await expect(runAgentTool("act", { action: "click", ref: "e99" })).rejects.toThrow(
        /^e99 isn't in the page's outline: it's from an older page, or not something to act on\. Nothing was done\.[\s\S]*button "Save" \[e12\]/,
      );
      fake("visibility: hidden");
      await expect(runAgentTool("act", { action: "click", ref: "e99" })).rejects.toThrow(
        "e99 is hidden (visibility: hidden)",
      );
      fake(null);
      await expect(
        runAgentTool("act", {
          steps: [
            { action: "click", ref: "e12" },
            { action: "click", ref: "e99" },
          ],
        }),
      ).rejects.toThrow(/^Stale ref e99: that element is gone\. Current page:/);
      // Checked before anything touched the page, the good first step included.
      expect(clicked()).toBe(false);
    });

    it("lets through a ref the developer flagged, even one the outline leaves out", async () => {
      fake("");
      useAgentFlagsStore
        .getState()
        .add({ tabId: "aaaaaaaa-1", ref: "e99", role: "div", name: "", note: "this does nothing" });
      expect(await runAgentTool("snapshot", {})).toContain("Developer flagged e99");
      // Past the ref check: it fails later, aiming at a box the fake page lacks.
      await expect(runAgentTool("act", { action: "click", ref: "e99" })).rejects.not.toThrow(
        /outline/,
      );
    });

    it("won't type into something that takes no text", async () => {
      fake("", "a button");
      await expect(runAgentTool("act", { action: "type", ref: "e12", text: "hi" })).rejects.toThrow(
        "e12 is a button, so type can't put text in it. Nothing was done.",
      );
      fake("", "a <select>");
      await expect(
        runAgentTool("act", { action: "type", ref: "e12", text: "Pro" }),
      ).rejects.toThrow(
        "e12 is a <select>, so type can't put text in it. Nothing was done. Use action=select.",
      );
      expect(hooks.cdp).not.toContain("Input.insertText");
    });
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

  it("checks every step of a batch before touching the page", async () => {
    hooks.cdp.length = 0;
    const bad = [
      { ref: "e4", action: "click" },
      { ref: "e5", action: "smash" },
    ];
    await expect(runAgentTool("act", { steps: bad })).rejects.toThrow(
      'Step 2: Unknown action "smash".',
    );
    await expect(
      runAgentTool("act", { steps: [{ ref: "e4", action: "click" }, { action: "type" }] }),
    ).rejects.toThrow("Step 2: Expected a ref");
    // A stray top-level action next to steps is ignored: the steps' own check still runs.
    await expect(
      runAgentTool("act", { action: "click", steps: [{ ref: "e4", action: "smash" }] }),
    ).rejects.toThrow('Step 1: Unknown action "smash".');
    await expect(runAgentTool("act", { steps: [] })).rejects.toThrow("steps takes 1 to 10");
    const eleven = Array.from({ length: 11 }, () => ({ ref: "e4", action: "click" }));
    await expect(runAgentTool("act", { steps: eleven })).rejects.toThrow("steps takes 1 to 10");
    expect(hooks.cdp).toEqual([]);
  });

  it("takes either an element or the whole page in a screenshot, not both", async () => {
    await expect(runAgentTool("screenshot", { ref: "e4", full: true })).rejects.toThrow(
      "Pass ref or full, not both.",
    );
  });

  it("answers each request once, even with two listeners (StrictMode's double mount)", async () => {
    hooks.requests.length = 0;
    hooks.replies.length = 0;
    listenForAgents();
    listenForAgents();
    expect(hooks.requests).toHaveLength(2);
    for (const cb of hooks.requests) cb({ id: 4242, tool: "tabs", args: {} });
    await vi.waitFor(() => expect(hooks.replies).toContain(4242));
    await new Promise((r) => setTimeout(r, 20));
    expect(hooks.replies.filter((id) => id === 4242)).toHaveLength(1);
  });

  it("tells the app it's ready only once the request listener is up", async () => {
    hooks.requests.length = 0;
    hooks.ready.length = 0;
    listenForAgents();
    await vi.waitFor(() => expect(hooks.ready).toEqual([1]));
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

  it("starts the next reply on a flagged tab with the flag, once", async () => {
    const flags = useAgentFlagsStore.getState();
    flags.clear();
    const flag = { ref: "e15", role: "button", name: "Apply", note: "does nothing on mobile" };
    flags.add({ tabId: "aaaaaaaa-1", ...flag });
    flags.add({ tabId: "bbbbbbbb-2", ...flag, ref: "e9", note: "" });

    // A failed call leaves the flag queued.
    await expect(runAgentTool("screenshot", { ref: "e4", full: true })).rejects.toThrow();
    // A call on another tab doesn't take it.
    const other = await runAgentTool("errors", { tab: "bbbb" });
    expect(other.split("\n")[0]).toBe('Developer flagged e9 button "Apply"');
    expect(other).not.toContain("e15");

    const out = await runAgentTool("errors", {});
    expect(out.split("\n")[0]).toBe('Developer flagged e15 button "Apply": does nothing on mobile');
    expect(await runAgentTool("errors", {})).not.toContain("Developer flagged");
    expect(useAgentFlagsStore.getState().flags).toEqual([]);
  });

  it("delivers every tab's flags to tabs, naming the tab", async () => {
    const flags = useAgentFlagsStore.getState();
    flags.clear();
    flags.add({ tabId: "bbbbbbbb-2", ref: "e3", role: "link", name: "Docs", note: "404s" });
    const out = await runAgentTool("tabs", {});
    expect(out.split("\n")[0]).toBe('Developer flagged e3 link "Docs" in [bbbbbbbb]: 404s');
    expect(out).toContain("Tabs you can use");
    expect(await runAgentTool("tabs", {})).not.toContain("Developer flagged");
  });
});

describe("console levels", () => {
  beforeEach(() => {
    useTabsStore.setState({ tabs: { "aaaaaaaa-1": tab("aaaaaaaa-1", "http://localhost:5173/") } });
    useConsoleStore.setState({ entriesByTab: {}, logsByTab: {}, countsByTab: {} });
    useNetworkStore.setState({ entriesByTab: {} });
    forgetTab("aaaaaaaa-1");
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
    expect(historyTarget(h, "back", isLoopbackUrl).id).toBe(10);
    expect(historyTarget({ ...h, currentIndex: 0 }, "forward", isLoopbackUrl).id).toBe(11);
  });

  it("refuses to run off the history or off localhost", () => {
    expect(() => historyTarget({ ...h, currentIndex: 0 }, "back", isLoopbackUrl)).toThrow(
      "Nothing to go back",
    );
    expect(() => historyTarget({ ...h, currentIndex: 2 }, "forward", isLoopbackUrl)).toThrow(
      "Nothing to go forward",
    );
    expect(() => historyTarget(h, "forward", isLoopbackUrl)).toThrow("would leave your scope");
  });
});

describe("vitalsText", () => {
  const base = {
    lcp: 1240,
    lcpEl: "img#hero",
    cls: 0.031,
    inp: null,
    slowInteractions: 0,
    longTasks: 0,
    longest: 0,
    ttfb: 38,
    load: 910,
  };

  it("rates each number by web.dev's thresholds, on one line", () => {
    expect(vitalsText(base)).toBe(
      "Vitals: LCP 1.2 s (good, img#hero) · CLS 0.03 (good) · INP: no interaction over 104 ms · no long tasks · TTFB 38 ms, load 910 ms",
    );
    expect(
      vitalsText({
        ...base,
        lcp: 4600,
        lcpEl: "",
        cls: 0.2,
        inp: 260,
        slowInteractions: 1,
        longTasks: 3,
        longest: 412,
        ttfb: null,
        load: null,
      }),
    ).toBe(
      "Vitals: LCP 4.6 s (poor) · CLS 0.20 (needs improvement) · INP 260 ms (needs improvement, worst of 1 slow interaction) · 3 long tasks, longest 412 ms",
    );
    expect(vitalsText({ ...base, lcp: null })).toContain(
      "LCP not recorded (the tab was hidden while loading, or nothing painted)",
    );
  });
});

describe("ownerText", () => {
  it("says so when a process can't be read, and lists both owners of a split port", () => {
    const o = { port: 80, exe: null, cwd: null, startedMs: null };
    expect(ownerText([{ ...o, pid: 7, name: "" }], 0)).toBe(
      "pid 7 (another user's or elevated, can't read it)",
    );
    expect(
      ownerText(
        [
          { ...o, pid: 4, name: "System" },
          { ...o, pid: 8, name: "python.exe", startedMs: 0 },
        ],
        45_000,
      ),
    ).toBe("System (pid 4); python.exe (pid 8, up 45s)");
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

/** Just enough DOM to run the in-page scripts in Node. */
interface FakeNode {
  tag: string;
  style: { cssText: string };
  attrs: Record<string, string>;
  textContent: string;
  __zynlexMark?: boolean;
  shadow?: { mode: string; kids: FakeNode[] };
}

function fakePage() {
  const onPage: FakeNode[] = [];
  const timers: (() => void)[] = [];
  const createElement = (tag: string) => {
    const n: FakeNode & Record<string, unknown> = {
      tag,
      style: { cssText: "" },
      attrs: {},
      textContent: "",
      setAttribute: (k: string, v: string) => {
        n.attrs[k] = v;
      },
      attachShadow: ({ mode }: { mode: string }) => {
        const kids: FakeNode[] = [];
        n.shadow = { mode, kids };
        return { append: (...k: FakeNode[]) => kids.push(...k) };
      },
      remove: () => onPage.splice(onPage.indexOf(n), 1),
      animate: (frames: object[], opts: object) => {
        n.animation = { frames, opts };
      },
    };
    return n;
  };
  const doc = {
    createElement,
    documentElement: { append: (n: FakeNode) => onPage.push(n) },
    defaultView: { frameElement: null, setTimeout: (f: () => void) => timers.push(f) },
  };
  const element = (rect: object) => ({ ownerDocument: doc, getBoundingClientRect: () => rect });
  return { onPage, timers, element };
}

describe("action marks", () => {
  const mark = (el: object, o: object) => new Function(`return ${MARK}`)().call(el, o);
  const rect = { left: 10, top: 50, width: 80, height: 20, bottom: 70 };

  it("draws an outline, a label and the pointer, out of the page's way, then removes itself", () => {
    const page = fakePage();
    expect(mark(page.element(rect), { label: "agent: click", ms: 1200, x: 50, y: 60 })).toBe(true);
    const [host] = page.onPage;
    expect(host.tag).toBe("zynlex-agent-mark");
    expect(host.__zynlexMark).toBe(true);
    // Hidden from the snapshot, no layout, input goes through.
    expect(host.attrs["aria-hidden"]).toBe("true");
    expect(host.style.cssText).toContain("position:fixed");
    expect(host.style.cssText).toContain("pointer-events:none");
    expect(host.shadow?.mode).toBe("closed");
    // Every style is set from script, none in a <style> element: a page's CSP
    // can block <style> but not these.
    const kids = host.shadow?.kids ?? [];
    expect(kids.map((k) => k.tag)).toEqual(["div", "div", "div"]);
    const [box, label, dot] = kids;
    for (const k of kids) expect(k.style.cssText).toMatch(/^position:fixed;pointer-events:none;/);
    expect(box.style.cssText).toContain("left:10px;top:50px;width:80px;height:20px");
    expect(label.textContent).toBe("agent: click");
    expect(label.style.cssText).toContain("top:28px");
    expect(dot.style.cssText).toContain("left:42px;top:52px");
    expect((host as { animation?: { opts: object } }).animation?.opts).toEqual({
      duration: 1200,
      fill: "forwards",
    });
    expect(page.timers).toHaveLength(1);
    page.timers[0]();
    expect(page.onPage).toEqual([]);
  });

  it("puts the label under an element at the top, and no pointer for keyboard actions", () => {
    const page = fakePage();
    mark(page.element({ ...rect, top: 4, bottom: 24 }), { label: "agent: type", ms: 1200 });
    const kids = page.onPage[0].shadow?.kids ?? [];
    expect(kids).toHaveLength(2);
    expect(kids[1].style.cssText).toContain("top:30px");
  });

  it("draws nothing for an element with no box", () => {
    const page = fakePage();
    expect(mark(page.element({ ...rect, width: 0, height: 0 }), { label: "x", ms: 1 })).toBe(false);
    expect(mark({}, { label: "x", ms: 1 })).toBe(false);
    expect(page.onPage).toEqual([]);
  });

  it("doesn't let a mark coming and going hold up settling", () => {
    let now = 0;
    let observe: (recs: object[]) => void = () => {};
    class Observer {
      constructor(cb: typeof observe) {
        observe = cb;
      }
      observe() {}
    }
    const win: Record<string, unknown> = {};
    const probe = () =>
      new Function(
        "window",
        "document",
        "MutationObserver",
        "performance",
        `return ${QUIET_PROBE}`,
      )(win, { readyState: "complete" }, Observer, { now: () => now }) as { quietMs: number };
    probe();
    now = 100;
    const ours = { __zynlexMark: true };
    observe([{ type: "childList", addedNodes: [ours], removedNodes: [] }]);
    observe([{ type: "childList", addedNodes: [], removedNodes: [ours] }]);
    expect(probe().quietMs).toBe(100);
    observe([
      { type: "childList", addedNodes: [], removedNodes: [ours] },
      { type: "attributes", addedNodes: [], removedNodes: [] },
    ]);
    now = 150;
    expect(probe().quietMs).toBe(50);
    observe([{ type: "childList", addedNodes: [{}], removedNodes: [] }]);
    expect(probe().quietMs).toBe(0);
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
    const bad = await handleAgentCall("act", {
      action: "click",
      ref: "e1",
      tab: "zz",
      why: "open the menu",
    });
    expect(bad.ok).toBe(false);
    const calls = useAgentActivityStore.getState().calls;
    expect(calls.map((c) => c.tool)).toEqual(["act", "mock", "errors"]);
    expect(calls[0]).toMatchObject({ tabId: null, error: 'No tab "zz" you can use. Call tabs.' });
    expect(calls[0].summary).toBe("action=click ref=e1");
    expect(calls[0]).toMatchObject({ why: "open the menu", what: "", outcome: "" });
    expect(calls[1]).toMatchObject({
      tabId: "aaaaaaaa-1",
      tabLabel: "[aaaaaaaa] http://localhost:5173/",
      error: null,
      summary: "action=add url=localhost:5173/api/a status=404",
    });
    // A read doesn't mark the tab; the mock did.
    expect(useAgentActivityStore.getState().touched).toEqual({ "aaaaaaaa-1": calls[1].at });
  });

  it("records the error itself, not the first step that worked or a takeover note", async () => {
    expect(
      errorLine(
        [
          'Typed "a" into textbox "Email" [e2]',
          "Step 2 (click) failed: e9 is hidden (visibility: hidden): it's in the page",
          "Page changes:",
        ].join("\n"),
      ),
    ).toBe("Step 2 (click) failed: e9 is hidden (visibility: hidden): it's in the page");
    expect(errorLine("No dialog is open in this tab.")).toBe("No dialog is open in this tab.");

    pauseAgent();
    const p = handleAgentCall("act", { action: "click", ref: "e1", tab: "zz" });
    resumeAgent();
    const { ok, text } = await p;
    expect(ok).toBe(false);
    // The agent gets the takeover note first; the panel shows the error.
    expect(text).toMatch(/^The developer took over/);
    expect(useAgentActivityStore.getState().calls[0]).toMatchObject({
      error: 'No tab "zz" you can use. Call tabs.',
      note: "ran after takeover",
    });
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

describe("downloads an action started", () => {
  const item = (tabId: string, startedAt: number, status: "active" | "done" | "failed") => ({
    id: String(startedAt),
    url: "http://localhost:5173/report.csv",
    filename: "report.csv",
    path: "C:\\Downloads\\report.csv",
    status,
    startedAt,
    tabId,
  });

  it("names this tab's downloads since the action, oldest first, with where they went", () => {
    // The store keeps the newest first.
    const items = [
      item("t1", 30, "active"),
      item("t2", 25, "done"),
      item("t1", 20, "done"),
      item("t1", 5, "done"),
    ];
    expect(downloadLines(items, "t1", 10)).toEqual([
      "Downloaded report.csv to C:\\Downloads\\report.csv",
      "Downloading report.csv to C:\\Downloads\\report.csv (not finished when this reply was sent)",
    ]);
    expect(downloadLines([item("t1", 20, "failed")], "t1", 10)).toEqual([
      "Download failed: report.csv (http://localhost:5173/report.csv)",
    ]);
    expect(downloadLines(items, "t3", 0)).toEqual([]);
  });
});

describe("TAKES_TEXT", () => {
  const takes = (el: object) => new Function(`return ${TAKES_TEXT}`)().call(el);
  const el = (localName: string, extra: object = {}) => ({
    localName,
    isContentEditable: false,
    getAttribute: () => null,
    ...extra,
  });

  it("lets text fields through and names everything else", () => {
    expect(takes(el("input"))).toBe("");
    expect(takes(el("input", { type: "email" }))).toBe("");
    expect(takes(el("textarea"))).toBe("");
    expect(takes(el("div", { isContentEditable: true }))).toBe("");
    expect(takes(el("input", { type: "checkbox" }))).toBe("an input of type checkbox");
    expect(takes(el("input", { readOnly: true }))).toBe("read-only");
    expect(takes(el("textarea", { disabled: true }))).toBe("disabled");
    expect(takes(el("select"))).toBe("a <select>");
    expect(takes(el("button"))).toBe("a button");
    expect(takes(el("div", { getAttribute: () => "button" }))).toBe("a button");
    expect(takes(el("div", { getAttribute: () => "textbox" }))).toBe(
      "a <div> (role textbox) that isn't editable",
    );
    expect(takes({})).toBe("not an element");
  });
});

describe("hidden elements", () => {
  const why = (el: object) => new Function(`return ${HIDDEN}`)().call(el);
  const el = (o: { shown?: boolean; visible?: boolean; w?: number; connected?: boolean }) => ({
    isConnected: o.connected ?? true,
    nodeType: 1,
    checkVisibility: (opts?: { visibilityProperty?: boolean }) =>
      opts?.visibilityProperty ? (o.shown ?? true) && (o.visible ?? true) : (o.shown ?? true),
    getBoundingClientRect: () => ({ width: o.w ?? 10, height: 10 }),
  });

  it("tells hidden from gone, so the agent isn't sent to re-snapshot for nothing", () => {
    expect(why(el({}))).toBe("");
    expect(why(el({ connected: false }))).toBe("gone");
    expect(why(el({ shown: false }))).toBe("display: none, on it or an ancestor");
    expect(why(el({ visible: false }))).toBe("visibility: hidden");
    expect(why(el({ w: 0 }))).toBe("zero size");
    // A text node asks its element.
    expect(why({ isConnected: true, nodeType: 3, parentElement: el({ visible: false }) })).toBe(
      "visibility: hidden",
    );
  });
});
