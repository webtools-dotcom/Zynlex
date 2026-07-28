import { describe, expect, it } from "vitest";
import {
  getLiveWorkspaceActiveTab,
  getLiveWorkspaceActiveTabId,
  getLiveWorkspaceTabIds,
} from "./workspaceTabs";
import type { Tab, Workspace } from "@/types";

function makeTab(id: string): Tab {
  return {
    id,
    title: id,
    url: `https://${id}.example.com`,
    favicon: null,
    isLoading: false,
    isPinned: false,
    workspaceId: "ws-1",
    createdAt: 0,
    savedFormState: null,
    zoom: 1,
    historyBack: [],
    historyForward: [],
    loadTime: null,
    discardedAt: null,
    lastActiveAt: 0,
  };
}

function makeWorkspace(tabIds: string[], activeTabId: string | null): Workspace {
  return {
    id: "ws-1",
    name: "Test",
    color: "#000",
    icon: "🌐",
    createdAt: 0,
    tabIds,
    activeTabId,
  };
}

describe("getLiveWorkspaceTabIds", () => {
  it("returns an empty array for a missing workspace", () => {
    expect(getLiveWorkspaceTabIds(null, {})).toEqual([]);
    expect(getLiveWorkspaceTabIds(undefined, {})).toEqual([]);
  });

  it("drops tabIds that have no matching tab", () => {
    const tabs = { a: makeTab("a") };
    const ws = makeWorkspace(["a", "b"], null);
    expect(getLiveWorkspaceTabIds(ws, tabs)).toEqual(["a"]);
  });

  it("drops duplicate tabIds, keeping the first occurrence", () => {
    const tabs = { a: makeTab("a"), b: makeTab("b") };
    const ws = makeWorkspace(["a", "b", "a"], null);
    expect(getLiveWorkspaceTabIds(ws, tabs)).toEqual(["a", "b"]);
  });
});

describe("getLiveWorkspaceActiveTabId", () => {
  it("returns null for a missing workspace", () => {
    expect(getLiveWorkspaceActiveTabId(null, {})).toBeNull();
  });

  it("returns activeTabId when it points at a live tab", () => {
    const tabs = { a: makeTab("a"), b: makeTab("b") };
    const ws = makeWorkspace(["a", "b"], "b");
    expect(getLiveWorkspaceActiveTabId(ws, tabs)).toBe("b");
  });

  it("falls back to the last live tab when activeTabId is stale", () => {
    const tabs = { a: makeTab("a"), b: makeTab("b") };
    const ws = makeWorkspace(["a", "b"], "closed-tab");
    expect(getLiveWorkspaceActiveTabId(ws, tabs)).toBe("b");
  });

  it("returns null when the workspace has no live tabs", () => {
    const ws = makeWorkspace(["a"], "a");
    expect(getLiveWorkspaceActiveTabId(ws, {})).toBeNull();
  });
});

describe("getLiveWorkspaceActiveTab", () => {
  it("returns the full Tab object for the active tab", () => {
    const tabs = { a: makeTab("a") };
    const ws = makeWorkspace(["a"], "a");
    expect(getLiveWorkspaceActiveTab(ws, tabs)).toEqual(tabs.a);
  });

  it("returns null when there is no live active tab", () => {
    expect(getLiveWorkspaceActiveTab(null, {})).toBeNull();
  });
});
