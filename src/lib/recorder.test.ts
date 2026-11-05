import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawEvent } from "./agentRecord";

// A fake page behind CDP: what the listener has buffered, and per element its
// backendNodeId, attributes and accessibility node.
const page = vi.hoisted(() => ({
  queue: [] as RawEvent[],
  nodes: {} as Record<number, { id: number; attrs: string[]; role: string; name: string }>,
  calls: [] as string[],
  capture: [] as boolean[],
}));
vi.mock("@/services/browser", () => ({
  setNetworkCapture: (on: boolean) => {
    page.capture.push(on);
    return Promise.resolve();
  },
  tabCdp: (_tab: string, method: string, params: Record<string, unknown>) => {
    page.calls.push(method);
    if (method === "Runtime.evaluate") {
      const ex = String(params.expression);
      if (ex.includes("drain()")) {
        return Promise.resolve({ result: { value: page.queue.splice(0) } });
      }
      const el = /\.el\((\d+)\)/.exec(ex);
      if (el) {
        return Promise.resolve({ result: page.nodes[+el[1]] ? { objectId: `obj-${el[1]}` } : {} });
      }
      return Promise.resolve({ result: {} });
    }
    if (method === "DOM.describeNode") {
      const n = page.nodes[Number(String(params.objectId).slice(4))];
      return Promise.resolve({ node: { backendNodeId: n.id, attributes: n.attrs } });
    }
    if (method === "Accessibility.getPartialAXTree") {
      const n = Object.values(page.nodes).find((x) => x.id === params.backendNodeId);
      return Promise.resolve({
        nodes: [
          {
            nodeId: "1",
            backendDOMNodeId: n?.id,
            role: { value: n?.role },
            name: { value: n?.name },
          },
        ],
      });
    }
    if (method === "Page.addScriptToEvaluateOnNewDocument") {
      return Promise.resolve({ identifier: "7" });
    }
    return Promise.resolve({});
  },
}));

import { recordingTool, startRecording, stopRecording, toggleRecording } from "./recorder";
import { useConsoleStore } from "@/stores/console";
import { type NetworkLogEntry, useNetworkStore } from "@/stores/network";
import { useRecordingStore } from "@/stores/recording";
import { useTabsStore } from "@/stores/tabs";
import { useUIStore } from "@/stores/ui";
import type { Tab } from "@/types";

const TAB = "aaaaaaaa-1";
const tab = (url: string): Tab => ({
  id: TAB,
  title: "Shop",
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
  lastActiveAt: 0,
});

const row = (id: string, method: string, url: string, statusCode: number): NetworkLogEntry => ({
  id,
  tabId: TAB,
  method,
  url,
  statusCode,
  reasonPhrase: "",
  resourceType: "fetch",
  durationMs: 5,
  contentLength: 0,
  referrer: "",
  headers: [],
  body: "",
  bodyTruncated: false,
  bodyEvicted: false,
});

let seq = 0;
function user(
  kind: RawEvent["kind"],
  node: { id: number; attrs?: string[]; role: string; name: string },
  extra: Partial<RawEvent> = {},
) {
  const s = ++seq;
  page.nodes[s] = { attrs: [], ...node };
  page.queue.push({ seq: s, t: Date.now(), kind, tag: "x", label: node.name, ...extra });
}

describe("recorder", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    await stopRecording();
    useRecordingStore.setState({ rec: null, active: false });
    page.queue = [];
    page.nodes = {};
    page.calls = [];
    page.capture = [];
    useTabsStore.setState({ tabs: { [TAB]: tab("http://localhost:5173/cart") } });
    useConsoleStore.setState({ entriesByTab: {}, logsByTab: {}, countsByTab: {} });
    useNetworkStore.setState({
      entriesByTab: { [TAB]: [row("net-1", "GET", "http://localhost:5173/old", 404)] },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says how to record when there is no recording", async () => {
    expect(await recordingTool()).toMatch(/No recording yet.*Record Steps for Agent/);
  });

  it("records steps with refs, collapses typing, drops passwords and attributes what they caused", async () => {
    await startRecording(TAB);
    expect(page.calls).toContain("Page.addScriptToEvaluateOnNewDocument");
    expect(page.capture).toEqual([true]);

    user("type", { id: 52, role: "textbox", name: "Email" }, { value: "a" });
    user("type", { id: 52, role: "textbox", name: "Email" }, { value: "a@b.co" });
    // The page script failed to flag it; the node's attributes still say password.
    user(
      "type",
      { id: 53, role: "textbox", name: "Password", attrs: ["type", "password"] },
      { value: "hunter2" },
    );
    vi.advanceTimersByTime(300);
    await vi.waitFor(() => expect(useRecordingStore.getState().rec?.steps).toHaveLength(2));

    vi.advanceTimersByTime(1000);
    user("click", { id: 41, role: "button", name: "Pay" });
    vi.advanceTimersByTime(100);
    // What existed before recording started is not news; new rows and errors are.
    useNetworkStore.getState().addEntry(row("net-2", "POST", "http://localhost:5173/api/pay", 500));
    useConsoleStore.getState().add({
      tabId: TAB,
      level: "error",
      source: "network",
      text: "Failed to load resource: the server responded with a status of 500 ()",
      url: "http://localhost:5173/api/pay",
      line: null,
    });
    useConsoleStore.getState().add({
      tabId: TAB,
      level: "error",
      source: "exception",
      text: "Uncaught TypeError: total is undefined\n    at pay.js:3",
      url: "http://localhost:5173/pay.js",
      line: 3,
    });
    vi.advanceTimersByTime(200);
    useTabsStore.getState().updateTab(TAB, { url: "http://localhost:5173/error" });

    const live = await recordingTool();
    expect(live).toContain("still recording");

    const done = await stopRecording();
    expect(done?.stoppedAt).not.toBeNull();
    expect(page.capture).toEqual([true, false]);
    expect(page.calls).toContain("Page.removeScriptToEvaluateOnNewDocument");

    const out = await recordingTool();
    expect(out.split("\n").slice(1, 4)).toEqual([
      '1. type textbox "Email" [e52] "a@b.co"',
      '2. type textbox "Password" [e53] (password, not recorded)',
      '3. click button "Pay" [e41] → /error, POST /api/pay 500, TypeError: total is undefined',
    ]);
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("/old");
  });

  it("stops by itself when the tab leaves localhost, and refuses non-local tabs", async () => {
    await startRecording(TAB);
    useTabsStore.getState().updateTab(TAB, { url: "https://example.com/" });
    await vi.waitFor(() => expect(useRecordingStore.getState().active).toBe(false));
    await expect(startRecording(TAB)).rejects.toThrow(/localhost/);
  });

  it("toggles from the palette with a toast", async () => {
    await toggleRecording(TAB);
    expect(useRecordingStore.getState().active).toBe(true);
    await toggleRecording(TAB);
    expect(useRecordingStore.getState().active).toBe(false);
    expect(useUIStore.getState().toasts.slice(-1)[0]?.message).toMatch(/Recorded 0 steps/);
  });
});
