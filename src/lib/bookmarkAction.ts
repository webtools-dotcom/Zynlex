/**
 * toggleBookmarkForActiveTab — shared Ctrl+D handler for the active tab.
 *
 * Called both from the main window's keydown listener (focus on the UI) and
 * from useWebviewBridge, which relays Ctrl+D pressed inside a tab's webview
 * (forwarded through Rust as `browser://bookmark-request`, since the page
 * has no direct path back to React). Keeping one function means the
 * workspace-scoping and toggle rules can't drift between the two triggers.
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
    useTabsStore.getState().tabs
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

  const isBookmarked = useBookmarksStore
    .getState()
    .isBookmarked(wsId, tab.url);

  if (isBookmarked) {
    useBookmarksStore.getState().removeBookmarkByUrl(wsId, tab.url);
    useUIStore
      .getState()
      .pushToast(`Removed bookmark: ${tab.title || tab.url}`, "info");
  } else {
    useBookmarksStore.getState().addBookmark(wsId, tab.url, tab.title);
    useUIStore
      .getState()
      .pushToast(`Bookmarked: ${tab.title || tab.url}`, "success");
  }

  useUIStore.getState().setActivePanel("bookmarks");
}
