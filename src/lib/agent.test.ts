import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useActiveScope", () => ({ getActiveTabId: () => null }));

// The dialog listener and every CDP call, so a test can open a dialog and see
// which calls reach the (paused) page.
const hooks = vi.hoisted(() => ({
  dialog: null as
    | null
    | ((e: { tabId: string; open: boolean; type?: string; message?: string }) => void),
  cdp: [] as string[],
}));
vi.mock("@/services/browser", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getAgentStatus: () => Promise.resolve({ enabled: true, clients: [] }),
  onAgentStatus: () => Promise.resolve(() => {}),
  onAgentRequest: () => Promise.resolve(() => {}),
  onDialog: (cb: typeof hooks.dialog) => {
    hooks.dialog = cb;
    return Promise.resolve(() => {});
  },
  closeTabWebview: () => Promise.resolve(),
  tabCdp: (_tab: string, method: string) => {
    hooks.cdp.push(method);
    return Promise.reject(new Error("tab not loaded"));
  },
}));

import { useConsoleStore } from "@/stores/console";
import { type NetworkLogEntry, useNetworkStore } from "@/stores/network";
import { useTabsStore } from "@/stores/tabs";
import type { Tab } from "@/types";
import { findDevice, listenForAgents, resolveTab, runAgentTool } from "./agent";
import { notePopup, popupMark, takePopups } from "./agentTabs";

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
    useConsoleStore.setState({ entriesByTab: {}, countsByTab: {} });
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
