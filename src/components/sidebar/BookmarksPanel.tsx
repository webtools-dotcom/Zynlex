/**
 * BookmarksPanel — sidebar list of saved URLs for the active workspace.
 *
 * Bookmarks are workspace-scoped. Each row shows the title, the host
 * (as a faint sublabel), and a hover-revealed delete button. The
 * "Clear all" button at the bottom wipes the active workspace's
 * bookmarks. Clicking a row opens the URL in a new tab.
 */
import { useState, useEffect, useMemo, useRef } from "react";
import { Bookmark, Trash2, ExternalLink, FolderPlus, Upload, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBookmarksStore } from "@/stores/bookmarks";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { VirtualList } from "@/components/ui/VirtualList";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { useUIStore } from "@/stores/ui";

function getHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function BookmarksPanel() {
  const bookmarks = useBookmarksStore((s) => s.bookmarks);
  const lastAddedId = useBookmarksStore((s) => s.lastAddedId);
  const removeBookmark = useBookmarksStore((s) => s.removeBookmark);
  const clearForWorkspace = useBookmarksStore((s) => s.clearForWorkspace);
  const clearLastAddedId = useBookmarksStore((s) => s.clearLastAddedId);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const ws = workspaces[activeWorkspaceId];
  const wsName = ws?.name ?? "Workspace";
  const addTab = useTabsStore((s) => s.addTab);
  const addTabToWorkspace = useWorkspacesStore((s) => s.addTabToWorkspace);
  const setActiveTab = useWorkspacesStore((s) => s.setActiveTab);
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

  const folders = useBookmarksStore((s) => s.folders);
  const addFolder = useBookmarksStore((s) => s.addFolder);
  const removeFolder = useBookmarksStore((s) => s.removeFolder);
  const moveBookmark = useBookmarksStore((s) => s.moveBookmark);
  const exportWorkspace = useBookmarksStore((s) => s.exportWorkspace);
  const importWorkspace = useBookmarksStore((s) => s.importWorkspace);
  const pushToast = useUIStore((s) => s.pushToast);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const wsBookmarks = bookmarks
    .filter((b) => b.workspaceId === activeWorkspaceId)
    .sort((a, b) => b.createdAt - a.createdAt);

  const wsFolders = useMemo(
    () => folders.filter((f) => f.workspaceId === activeWorkspaceId),
    [folders, activeWorkspaceId]
  );

  /** Root bookmarks first, then one header + its children per folder. */
  const listItems = useMemo(() => {
    type Row =
      | { kind: "folder"; id: string; name: string }
      | { kind: "bookmark"; bm: (typeof wsBookmarks)[number] };
    const rows: Row[] = wsBookmarks
      .filter((b) => !b.folderId)
      .map((bm) => ({ kind: "bookmark" as const, bm }));
    for (const f of wsFolders) {
      rows.push({ kind: "folder", id: f.id, name: f.name });
      for (const bm of wsBookmarks.filter((b) => b.folderId === f.id)) {
        rows.push({ kind: "bookmark", bm });
      }
    }
    return rows;
  }, [wsBookmarks, wsFolders]);

  function doExport() {
    const json = JSON.stringify(exportWorkspace(activeWorkspaceId), null, 2);
    // Blob + anchor: a plain platform download, no dialog plugin or capability.
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `xevo-bookmarks-${wsName.replace(/\s+/g, "-").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function doImport(file: File) {
    try {
      const count = importWorkspace(activeWorkspaceId, JSON.parse(await file.text()));
      pushToast(
        count > 0 ? `Imported ${count} bookmark${count === 1 ? "" : "s"}` : "Nothing to import",
        count > 0 ? "info" : "danger"
      );
    } catch {
      pushToast("Import failed: not valid bookmark JSON", "danger");
    }
  }

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
        <p className="text-xs font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase">
          {wsName} Bookmarks
        </p>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setNewFolder("")}
            title="New folder"
            aria-label="New folder"
            className="text-[var(--color-text-disabled)] hover:text-[var(--color-accent)]"
          >
            <FolderPlus size={12} />
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            title="Import bookmarks from JSON"
            aria-label="Import bookmarks"
            className="text-[var(--color-text-disabled)] hover:text-[var(--color-accent)]"
          >
            <Upload size={12} />
          </button>
          {wsBookmarks.length > 0 && (
            <button
              onClick={doExport}
              title="Export bookmarks to JSON"
              aria-label="Export bookmarks"
              className="text-[var(--color-text-disabled)] hover:text-[var(--color-accent)]"
            >
              <Download size={12} />
            </button>
          )}
          {wsBookmarks.length > 0 && (
            <ConfirmButton
              onConfirm={() => clearForWorkspace(activeWorkspaceId)}
              title={`Remove all ${wsBookmarks.length} bookmark${wsBookmarks.length === 1 ? "" : "s"} from "${wsName}"`}
              className="text-xs text-[var(--color-text-disabled)] hover:text-[var(--color-dead)] transition-colors"
            >
              Clear all
            </ConfirmButton>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void doImport(file);
          e.target.value = "";
        }}
      />

      {newFolder !== null && (
        <input
          autoFocus
          value={newFolder}
          onChange={(e) => setNewFolder(e.target.value)}
          onBlur={() => setNewFolder(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newFolder.trim()) {
              addFolder(activeWorkspaceId, newFolder);
              setNewFolder(null);
            } else if (e.key === "Escape") setNewFolder(null);
          }}
          placeholder="Folder name"
          className="mb-2 w-full px-2 py-1 text-sm bg-[var(--color-elevated)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] rounded outline-none border border-[var(--color-border)] focus:border-[var(--color-accent)]"
        />
      )}

      {/* Bookmark list */}
      {wsBookmarks.length === 0 && wsFolders.length === 0 ? (
        <div className="text-center py-6">
          <Bookmark
            size={22}
            className="text-[var(--color-text-disabled)] mx-auto mb-2"
          />
          <p className="text-sm text-[var(--color-text-disabled)]">
            No bookmarks yet
          </p>
          <p className="text-xs text-[var(--color-text-disabled)] mt-1">
            Press <kbd className="px-1 py-0.5 bg-[var(--color-elevated)] text-[var(--color-text-primary)] rounded text-micro font-mono">Ctrl+D</kbd> on a tab to save it
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <VirtualList items={listItems} itemHeight={40}>
            {({ style, item: row }) => {
              if (row.kind === "folder") {
                return (
                  <div
                    style={style}
                    className="group flex items-center gap-1.5 px-2 rounded bg-[var(--color-elevated)] mb-0.5"
                  >
                    <span className="flex-1 min-w-0 truncate text-micro font-semibold tracking-wide text-[var(--color-text-muted)] uppercase">
                      {row.name}
                    </span>
                    <ConfirmButton
                      onConfirm={() => removeFolder(row.id)}
                      title="Delete folder (bookmarks move to root)"
                      className="opacity-0 group-hover:opacity-100 text-[var(--color-text-disabled)] hover:text-[var(--color-dead)]"
                    >
                      <Trash2 size={12} />
                    </ConfirmButton>
                  </div>
                );
              }
              const item = row.bm;
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
                      className="flex-1 bg-[var(--color-elevated)] outline-none border border-[var(--color-accent)] rounded px-1.5 py-0.5 text-sm text-[var(--color-text-primary)]"
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
                      <div className="text-sm text-[var(--color-text-primary)] truncate">
                        {item.title}
                      </div>
                      <div className="text-xs text-[var(--color-text-disabled)] truncate">
                        {getHost(item.url)}
                      </div>
                    </button>
                  )}
                  {wsFolders.length > 0 && (
                    <select
                      value={item.folderId ?? ""}
                      onChange={(e) => moveBookmark(item.id, e.target.value || null)}
                      aria-label="Move to folder"
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-micro bg-[var(--color-elevated)] text-[var(--color-text-muted)] rounded outline-none border border-[var(--color-border)] max-w-20"
                    >
                      <option value="">(root)</option>
                      {wsFolders.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
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
