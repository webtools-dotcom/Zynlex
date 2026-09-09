/**
 * toggleBookmarkForActiveTab — shared Ctrl+D handler for the active tab.
 *
 * Called from both shortcut paths: the main window's keydown listener (focus on
 * the UI) and handleShortcut() in useKeyboardShortcuts (Ctrl+D pressed inside a
 * tab's webview, forwarded natively as `zynlex://shortcut`). Keeping one
 * function means the workspace-scoping and toggle rules can't drift between the
 * two triggers.
 */
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useBookmarksStore } from "@/stores/bookmarks";
import { useUIStore } from "@/stores/ui";
import { getLiveWorkspaceActiveTabId } from "@/lib/workspaceTabs";

export function toggleBookmarkForActiveTab(): void {
  const wsState = useWorkspacesStore.getState();
  const wsId = wsState.activeWorkspaceId;
  const activeTabId = getLiveWorkspaceActiveTabId(
    wsState.workspaces[wsId],
    useTabsStore.getState().tabs,
  );

  if (!activeTabId) {
    useUIStore.getState().pushToast("No active tab to bookmark", "info");
    return;
  }

  const tab = useTabsStore.getState().tabs[activeTabId];
  if (!tab || !tab.url) {
    useUIStore.getState().pushToast("No URL to bookmark", "info");
    return;
  }

  const isBookmarked = useBookmarksStore.getState().isBookmarked(wsId, tab.url);

  if (isBookmarked) {
    useBookmarksStore.getState().removeBookmarkByUrl(wsId, tab.url);
    useUIStore.getState().pushToast(`Removed bookmark: ${tab.title || tab.url}`, "info");
  } else {
    useBookmarksStore.getState().addBookmark(wsId, tab.url, tab.title);
    useUIStore.getState().pushToast(`Bookmarked: ${tab.title || tab.url}`, "success");
  }

  useUIStore.getState().setActivePanel("bookmarks");
}
