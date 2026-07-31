import type { Tab, Workspace } from "@/types";

export function getLiveWorkspaceTabIds(
  workspace: Workspace | null | undefined,
  tabs: Record<string, Tab>,
): string[] {
  if (!workspace) return [];

  const seen = new Set<string>();
  const liveTabIds: string[] = [];
  let dups = 0;

  for (const tabId of workspace.tabIds) {
    if (seen.has(tabId)) {
      dups++;
      continue;
    }
    if (!tabs[tabId]) continue;
    seen.add(tabId);
    liveTabIds.push(tabId);
  }

  if (dups > 0 && import.meta.env.DEV) {
    console.warn(`[zynlex] ${dups} duplicate tabId(s) in workspace; ignored`);
  }

  return liveTabIds;
}

export function getLiveWorkspaceActiveTabId(
  workspace: Workspace | null | undefined,
  tabs: Record<string, Tab>,
): string | null {
  if (!workspace) return null;

  if (workspace.activeTabId && tabs[workspace.activeTabId]) {
    return workspace.activeTabId;
  }

  const liveTabIds = getLiveWorkspaceTabIds(workspace, tabs);
  return liveTabIds[liveTabIds.length - 1] ?? null;
}

export function getLiveWorkspaceActiveTab(
  workspace: Workspace | null | undefined,
  tabs: Record<string, Tab>,
): Tab | null {
  const activeTabId = getLiveWorkspaceActiveTabId(workspace, tabs);
  return activeTabId ? (tabs[activeTabId] ?? null) : null;
}
