/**
 * BookmarksPanel — sidebar list of saved URLs for the active workspace.
 *
 * Bookmarks are workspace-scoped. Each row shows the title, the host
 * (as a faint sublabel), and a hover-revealed delete button. The
 * "Clear all" button at the bottom wipes the active workspace's
 * bookmarks. Clicking a row opens the URL in a new tab.
 */
import { useState, useEffect } from "react";
import { Bookmark, Trash2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBookmarksStore } from "@/stores/bookmarks";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";

function getHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function BookmarksPanel() {
  const { bookmarks, lastAddedId, removeBookmark, clearForWorkspace, clearLastAddedId } =
    useBookmarksStore();
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const ws = workspaces[activeWorkspaceId];
  const wsName = ws?.name ?? "Workspace";
  const { addTab } = useTabsStore();
  const { addTabToWorkspace, setActiveTab } = useWorkspacesStore();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>("");

  // Clear the "just added" highlight after 1.2s
  useEffect(() => {
    if (!lastAddedId) return;
    const t = setTimeout(() => {
      clearLastAddedId();
    }, 1200);
    return () => clearTimeout(t);
  }, [lastAddedId, clearLastAddedId]);

  const wsBookmarks = bookmarks
    .filter((b) => b.workspaceId === activeWorkspaceId)
    .sort((a, b) => b.createdAt - a.createdAt);

  function openBookmark(url: string) {
    const id = addTab(activeWorkspaceId, { url });
    addTabToWorkspace(activeWorkspaceId, id);
    setActiveTab(activeWorkspaceId, id);
  }

  function startRename(id: string, currentTitle: string) {
    setRenamingId(id);
    setRenameDraft(currentTitle);
  }

  function commitRename() {
    if (renamingId) {
      useBookmarksStore.getState().renameBookmark(renamingId, renameDraft);
    }
    setRenamingId(null);
    setRenameDraft("");
  }

  return (
    <div className="p-2">
      {/* Header row */}
      <div className="flex items-center justify-between px-1 mb-2">
        <p className="text-[10px] font-semibold tracking-widest text-[var(--xevo-text-faint)] uppercase">
          {wsName} Bookmarks
        </p>
        {wsBookmarks.length > 0 && (
          <button
            onClick={() => {
              if (
                window.confirm(
                  `Remove all ${wsBookmarks.length} bookmark${wsBookmarks.length === 1 ? "" : "s"} from "${wsName}"?`
                )
              ) {
                clearForWorkspace(activeWorkspaceId);
              }
            }}
            title="Clear all bookmarks in this workspace"
            className="text-[10px] text-[var(--xevo-text-faint)] hover:text-[var(--xevo-danger)] transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Bookmark list */}
      {wsBookmarks.length === 0 ? (
        <div className="text-center py-6">
          <Bookmark
            size={20}
            className="text-[var(--xevo-text-faint)] mx-auto mb-2"
          />
          <p className="text-[11px] text-[var(--xevo-text-faint)]">
            No bookmarks yet
          </p>
          <p className="text-[10px] text-[var(--xevo-text-faint)] mt-1">
            Press <kbd className="px-1 py-0.5 bg-[var(--xevo-badge-bg)] text-[var(--xevo-text)] rounded text-[9px] font-mono">Ctrl+D</kbd> on a tab to save it
          </p>
        </div>
      ) : (
        wsBookmarks.map((bookmark) => {
          const isJustAdded = lastAddedId === bookmark.id;
          return (
            <div
              key={bookmark.id}
              className={cn(
                "group flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-[var(--xevo-hover)] transition-colors mb-0.5",
                isJustAdded && "ring-2 ring-[var(--xevo-success)] bg-[var(--xevo-success)]/10"
              )}
            >
              {renamingId === bookmark.id ? (
                <input
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") {
                      setRenamingId(null);
                      setRenameDraft("");
                    }
                  }}
                  autoFocus
                  className="flex-1 bg-[var(--xevo-badge-bg)] outline-none border border-[var(--xevo-accent)] rounded px-1.5 py-0.5 text-[11px] text-[var(--xevo-text)]"
                />
              ) : (
                <button
                  onClick={() => openBookmark(bookmark.url)}
                  onDoubleClick={() =>
                    startRename(bookmark.id, bookmark.title)
                  }
                  title={`${bookmark.title}\n${bookmark.url}\n\nClick to open · Double-click to rename`}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="text-[11px] text-[var(--xevo-text)] truncate">
                    {bookmark.title}
                  </div>
                  <div className="text-[10px] text-[var(--xevo-text-faint)] truncate">
                    {getHost(bookmark.url)}
                  </div>
                </button>
              )}
              <button
                onClick={() => openBookmark(bookmark.url)}
                title="Open in new tab"
                className={cn(
                  "w-5 h-5 flex items-center justify-center rounded",
                  "text-[var(--xevo-text-faint)] hover:text-[var(--xevo-text)] hover:bg-[var(--xevo-modal-border)]",
                  "opacity-0 group-hover:opacity-100 transition-opacity"
                )}
              >
                <ExternalLink size={10} />
              </button>
              <button
                onClick={() => removeBookmark(bookmark.id)}
                title="Remove bookmark"
                className={cn(
                  "w-5 h-5 flex items-center justify-center rounded",
                  "text-[var(--xevo-text-faint)] hover:text-[var(--xevo-danger)] hover:bg-[var(--xevo-modal-border)]",
                  "opacity-0 group-hover:opacity-100 transition-opacity"
                )}
              >
                <Trash2 size={10} />
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

export default BookmarksPanel;
