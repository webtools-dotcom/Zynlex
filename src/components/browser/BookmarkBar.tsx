/**
 * BookmarkBar — root-level bookmarks of the active workspace, as a thin strip
 * under the toolbar. Mounted in RootLayout above the content row, so showing it
 * shrinks the content area and the existing ResizeObserver re-syncs the child
 * webview bounds; nothing here talks to Rust.
 */
import { Folder } from "lucide-react";
import { useState } from "react";
import { useBookmarksStore } from "@/stores/bookmarks";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import type { Bookmark } from "@/types";

export function BookmarkBar() {
  const bookmarks = useBookmarksStore((s) => s.bookmarks);
  const folders = useBookmarksStore((s) => s.folders);
  const wsId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const addTabToWorkspace = useWorkspacesStore((s) => s.addTabToWorkspace);
  const setActiveTab = useWorkspacesStore((s) => s.setActiveTab);
  const addTab = useTabsStore((s) => s.addTab);

  const [openFolderId, setOpenFolderId] = useState<string | null>(null);

  const wsBookmarks = bookmarks.filter((b) => b.workspaceId === wsId);
  const rootBookmarks = wsBookmarks.filter((b) => !b.folderId);
  const wsFolders = folders.filter((f) => f.workspaceId === wsId);

  function open(bm: Bookmark) {
    const id = addTab(wsId, { url: bm.url, title: bm.title });
    addTabToWorkspace(wsId, id);
    setActiveTab(wsId, id);
    setOpenFolderId(null);
  }

  if (rootBookmarks.length === 0 && wsFolders.length === 0) return null;

  return (
    <div
      className="relative flex items-center gap-1 h-7 px-2 shrink-0 overflow-x-auto border-b"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
    >
      {wsFolders.map((f) => {
        const children = wsBookmarks.filter((b) => b.folderId === f.id);
        return (
          <div key={f.id} className="relative shrink-0">
            <button
              onClick={() => setOpenFolderId(openFolderId === f.id ? null : f.id)}
              className="flex items-center gap-1 px-2 h-5 rounded text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text-primary)] whitespace-nowrap"
            >
              <Folder size={11} />
              {f.name}
            </button>
            {openFolderId === f.id && (
              <div
                className="absolute left-0 top-full z-50 mt-0.5 w-56 max-h-64 overflow-y-auto rounded border shadow-lg"
                style={{ background: "var(--color-elevated)", borderColor: "var(--color-border)" }}
              >
                {children.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-[var(--color-text-disabled)]">Empty</div>
                ) : (
                  children.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => open(b)}
                      title={b.url}
                      className="block w-full px-2 py-1 text-left text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text-primary)] truncate"
                    >
                      {b.title}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}

      {rootBookmarks.map((b) => (
        <button
          key={b.id}
          onClick={() => open(b)}
          title={b.url}
          className="shrink-0 max-w-40 truncate px-2 h-5 rounded text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text-primary)]"
        >
          {b.title}
        </button>
      ))}
    </div>
  );
}
