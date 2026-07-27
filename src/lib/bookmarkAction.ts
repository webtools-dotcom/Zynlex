/**
 * toggleBookmarkForActiveTab — shared bookmark action for the active tab.
 *
 * Called from two places:
 *   1. The main window's global keydown listener (useKeyboardShortcuts.ts)
 *      when Ctrl+D fires while the user is focused on the main window
 *      (e.g. address bar or sidebar).
 *   2. The webview's injected keydown listener (XEVO_BOOKMARK_SCRIPT in
 *      src-tauri/src/commands/browser.rs) when Ctrl+D fires while the user
 *      is focused on the page content. The webview invokes
 *      `browser_bookmark_request`, Rust emits `browser://bookmark-request`,
 *      and useWebviewBridge listens for it and calls this function.
 *
 * Both paths converge here so the bookmarking rules (workspace scoping,
 * toggle behavior, side-effect feedback) stay in a single place.
 *
 * The function pushes a toast, switches the sidebar to the Bookmarks panel,
 * and updates the lastAddedId for the green ring highlight.
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
