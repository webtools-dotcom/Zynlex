/**
 * Tab open/close, shared by every entry point (tab bar, shortcuts, command
 * palette, context menu, sidebar panels, home page, new-window requests).
 *
 * Each is three calls across two stores plus the native webview, and they used
 * to be spelled out by hand at ~20 call sites — which is how a close path ends
 * up forgetting the webview, or an open path forgetting to activate the tab.
 */
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { closeTabWebview } from "@/services/browser";
import type { NewTabOptions } from "@/types";

/** Open a tab in `wsId` (default: the active workspace). Returns its id. */
export function openTab(
  opts: NewTabOptions = {},
  { wsId = useWorkspacesStore.getState().activeWorkspaceId, activate = true } = {},
): string {
  const id = useTabsStore.getState().addTab(wsId, opts);
  useWorkspacesStore.getState().addTabToWorkspace(wsId, id);
  if (activate) useWorkspacesStore.getState().setActiveTab(wsId, id);
  return id;
}

/** Close a tab: workspace membership, tab record, and its native webview. */
export function closeTab(tabId: string): void {
  const wsId = useTabsStore.getState().tabs[tabId]?.workspaceId;
  if (wsId) useWorkspacesStore.getState().removeTabFromWorkspace(wsId, tabId);
  useTabsStore.getState().closeTab(tabId);
  closeTabWebview(tabId).catch(() => {});
}

/** Ctrl+Shift+T. */
export function reopenLastClosedTab(): void {
  const last = useTabsStore.getState().lastClosedTab;
  if (!last) return;
  openTab({ url: last.url, title: last.title });
  useTabsStore.getState().clearLastClosedTab();
}
