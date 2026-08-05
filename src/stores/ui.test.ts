/**
 * The owner-id scoping rule: a panel opened in one workspace/tab must not be
 * open in another, and must come back when you return. Store level only — the
 * components just render on these booleans.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore, isApiTesterOpen, isViewportMode, isFindOpen } from "@/stores/ui";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";

const WS_A = "ws-default";
let wsB: string;
let tab1: string;
let tab2: string;

beforeEach(() => {
  useTabsStore.setState({ tabs: {} });
  useWorkspacesStore.setState({
    workspaces: {
      [WS_A]: {
        id: WS_A,
        name: "A",
        color: "#000",
        icon: "🌐",
        createdAt: 0,
        tabIds: [],
        activeTabId: null,
      },
    },
    workspaceOrder: [WS_A],
    activeWorkspaceId: WS_A,
  });

  const ws = useWorkspacesStore.getState();
  wsB = ws.createWorkspace("B");

  const tabs = useTabsStore.getState();
  tab1 = tabs.addTab(WS_A, { url: "https://one.test" });
  tab2 = tabs.addTab(WS_A, { url: "https://two.test" });
  ws.addTabToWorkspace(WS_A, tab1);
  ws.addTabToWorkspace(WS_A, tab2);
  ws.setActiveTab(WS_A, tab1);

  useUIStore.setState({ apiTesterWsId: null, viewportTabId: null, findTabId: null });
});

describe("api tester is scoped to its workspace", () => {
  it("does not follow you to another workspace, and returns when you come back", () => {
    useUIStore.getState().openApiTester();
    expect(isApiTesterOpen()).toBe(true);

    useWorkspacesStore.getState().setActiveWorkspace(wsB);
    expect(isApiTesterOpen()).toBe(false);

    useWorkspacesStore.getState().setActiveWorkspace(WS_A);
    expect(isApiTesterOpen()).toBe(true);
  });
});

describe("viewport mode is scoped to its tab", () => {
  it("does not follow you to another tab, and returns when you come back", () => {
    useUIStore.getState().enterViewportMode();
    expect(isViewportMode()).toBe(true);

    useWorkspacesStore.getState().setActiveTab(WS_A, tab2);
    expect(isViewportMode()).toBe(false);

    useWorkspacesStore.getState().setActiveTab(WS_A, tab1);
    expect(isViewportMode()).toBe(true);
  });

  it("switching workspace also turns it off", () => {
    useUIStore.getState().enterViewportMode();
    useWorkspacesStore.getState().setActiveWorkspace(wsB);
    expect(isViewportMode()).toBe(false);
  });
});

describe("find bar is scoped to its tab", () => {
  it("does not follow you to another tab", () => {
    useUIStore.getState().openFind();
    useUIStore.getState().setFindQuery("needle");
    expect(isFindOpen()).toBe(true);

    useWorkspacesStore.getState().setActiveTab(WS_A, tab2);
    expect(isFindOpen()).toBe(false);
  });

  it("closing clears the query so the next tab never inherits it", () => {
    useUIStore.getState().openFind();
    useUIStore.getState().setFindQuery("needle");
    useUIStore.getState().closeFind();
    expect(useUIStore.getState().findQuery).toBe("");
    expect(isFindOpen()).toBe(false);
  });
});

describe("a dead owner id is simply never open", () => {
  it("closing the tab that owned viewport mode leaves it off, with no cleanup", () => {
    useUIStore.getState().enterViewportMode();
    useWorkspacesStore.getState().removeTabFromWorkspace(WS_A, tab1);
    useTabsStore.getState().closeTab(tab1);
    expect(isViewportMode()).toBe(false);
  });
});
