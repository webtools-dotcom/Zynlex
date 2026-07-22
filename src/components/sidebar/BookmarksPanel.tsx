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
import { VirtualList } from "@/components/ui/VirtualList";
import { ConfirmButton } from "@/components/ui/ConfirmButton";

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
    <div className="p-2 flex flex-col h-full">
      {/* Header row */}
      <div className="flex items-center justify-between px-1 mb-2 flex-shrink-0">
        <p className="text-[12px] font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase">
          {wsName} Bookmarks
        </p>
        {wsBookmarks.length > 0 && (
          <ConfirmButton
            onConfirm={() => clearForWorkspace(activeWorkspaceId)}
            title={`Remove all ${wsBookmarks.length} bookmark${wsBookmarks.length === 1 ? "" : "s"} from "${wsName}"`}
            className="text-[12px] text-[var(--color-text-disabled)] hover:text-[var(--color-dead)] transition-colors"
          >
            Clear all
          </ConfirmButton>
        )}
      </div>

      {/* Bookmark list */}
      {wsBookmarks.length === 0 ? (
        <div className="text-center py-6">
          <Bookmark
            size={22}
            className="text-[var(--color-text-disabled)] mx-auto mb-2"
          />
          <p className="text-[13px] text-[var(--color-text-disabled)]">
            No bookmarks yet
          </p>
          <p className="text-[12px] text-[var(--color-text-disabled)] mt-1">
            Press <kbd className="px-1 py-0.5 bg-[var(--color-elevated)] text-[var(--color-text-primary)] rounded text-[11px] font-mono">Ctrl+D</kbd> on a tab to save it
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <VirtualList items={wsBookmarks} itemHeight={40}>
            {({ style, item }) => {
              const isJustAdded = lastAddedId === item.id;
              return (
                <div
                  style={style}
                  key={item.id}
                  className={cn(
                    "group flex items-center gap-1.5 px-2 py-1.5 rounded hover:bg-[var(--color-hover)] transition-colors mb-0.5",
                    isJustAdded && "ring-2 ring-[var(--color-live)] bg-[var(--color-live)]/10"
                  )}
                >
                  {renamingId === item.id ? (
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
                      className="flex-1 bg-[var(--color-elevated)] outline-none border border-[var(--color-accent)] rounded px-1.5 py-0.5 text-[13px] text-[var(--color-text-primary)]"
                    />
                  ) : (
                    <button
                      onClick={() => openBookmark(item.url)}
                      onDoubleClick={() =>
                        startRename(item.id, item.title)
                      }
                      title={`${item.title}\n${item.url}\n\nClick to open · Double-click to rename`}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-[13px] text-[var(--color-text-primary)] truncate">
                        {item.title}
                      </div>
                      <div className="text-[12px] text-[var(--color-text-disabled)] truncate">
                        {getHost(item.url)}
                      </div>
                    </button>
                  )}
                  <button
                    onClick={() => openBookmark(item.url)}
                    title="Open in new tab"
                    aria-label="Open bookmark in new tab"
                    className={cn(
                      "w-6 h-6 flex items-center justify-center rounded",
                      "text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border)]",
                      "opacity-0 group-hover:opacity-100 transition-opacity"
                    )}
                  >
                    <ExternalLink size={12} />
                  </button>
                  <button
                    onClick={() => removeBookmark(item.id)}
                    title="Remove bookmark"
                    aria-label="Remove bookmark"
                    className={cn(
                      "w-6 h-6 flex items-center justify-center rounded",
                      "text-[var(--color-text-disabled)] hover:text-[var(--color-dead)] hover:bg-[var(--color-border)]",
                      "opacity-0 group-hover:opacity-100 transition-opacity"
                    )}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            }}
          </VirtualList>
        </div>
      )}
    </div>
  );
}

export default BookmarksPanel;
