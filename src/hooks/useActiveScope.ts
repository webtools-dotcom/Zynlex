/**
 * The two ids everything scopes to: the active workspace, and its active tab.
 *
 * Deliberately does NOT import stores/ui — the ui store imports *this* to stamp
 * an owner id onto per-scope UI state, and the derived "is it open here?"
 * helpers live there, next to the state they read.
 */
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { getLiveWorkspaceActiveTabId } from "@/lib/workspaceTabs";

export function getActiveWorkspaceId(): string {
  return useWorkspacesStore.getState().activeWorkspaceId;
}

export function getActiveTabId(): string | null {
  const ws = useWorkspacesStore.getState();
  return getLiveWorkspaceActiveTabId(
    ws.workspaces[ws.activeWorkspaceId],
    useTabsStore.getState().tabs,
  );
}

export function useActiveTabId(): string | null {
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const tabs = useTabsStore((s) => s.tabs);
  return getLiveWorkspaceActiveTabId(workspaces[activeWorkspaceId], tabs);
}
