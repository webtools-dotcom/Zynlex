import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/browser", () => ({ closeTabWebview: vi.fn(() => Promise.resolve()) }));

import { closeTabWebview } from "@/services/browser";
import { useTabsStore } from "@/stores/tabs";
import { useWorkspacesStore } from "@/stores/workspaces";
import { closeTab, openTab, reopenLastClosedTab } from "./tabActions";

const WS_A = "ws-a";
const WS_B = "ws-b";

beforeEach(() => {
  useTabsStore.setState({ tabs: {}, lastClosedTab: null });
  useWorkspacesStore.setState({
    workspaces: {
      [WS_A]: {
        id: WS_A,
        name: "A",
        icon: "",
        color: "",
        createdAt: 0,
        tabIds: [],
        activeTabId: null,
      },
      [WS_B]: {
        id: WS_B,
        name: "B",
        icon: "",
        color: "",
        createdAt: 0,
        tabIds: [],
        activeTabId: null,
      },
    },
    workspaceOrder: [WS_A, WS_B],
    activeWorkspaceId: WS_A,
  });
});

describe("tabActions", () => {
  it("opens into the active workspace, activated, keeping the given title", () => {
    const id = openTab({ url: "http://localhost:3000", title: "My App" });
    const ws = useWorkspacesStore.getState().workspaces[WS_A];
    expect(ws.tabIds).toEqual([id]);
    expect(ws.activeTabId).toBe(id);
    expect(useTabsStore.getState().tabs[id].title).toBe("My App");
  });

  it("closes a background workspace's tab from its own workspace, not the active one", () => {
    const id = openTab({ url: "http://x" }, { wsId: WS_B, activate: false });
    closeTab(id);
    expect(useWorkspacesStore.getState().workspaces[WS_B].tabIds).toEqual([]);
    expect(useTabsStore.getState().tabs[id]).toBeUndefined();
    expect(closeTabWebview).toHaveBeenCalledWith(id);
  });

  it("reopens the last closed tab once", () => {
    closeTab(openTab({ url: "http://x", title: "X" }));
    reopenLastClosedTab();
    reopenLastClosedTab();
    const tabs = Object.values(useTabsStore.getState().tabs);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].title).toBe("X");
  });
});
