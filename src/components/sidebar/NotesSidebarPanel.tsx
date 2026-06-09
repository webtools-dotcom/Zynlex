import { useState, useRef, useCallback, useEffect } from "react";
import { FileText, Plus, Trash2, Maximize2 } from "lucide-react";
import { useNotesStore } from "@/stores/notes";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useUIStore } from "@/stores/ui";

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function NotesSidebarPanel() {
  const { activeWorkspaceId } = useWorkspacesStore();
  const { notes, createNote, deleteNote, updateNote } = useNotesStore();
  const openOverlay = useUIStore((s) => s.openOverlay);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const wsNotes = notes.filter((n) => n.workspaceId === activeWorkspaceId);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  const handleCreate = useCallback(() => {
    const id = createNote(activeWorkspaceId);
    setExpandedId(id);
    setEditingTitle(id);
  }, [activeWorkspaceId, createNote]);

  const handleOpenFull = useCallback(() => {
    openOverlay("notes-notepad");
  }, [openOverlay]);

  const handleTitleCommit = useCallback(
    (id: string, value: string) => {
      const trimmed = value.trim();
      if (trimmed) {
        updateNote(id, { title: trimmed });
      }
      setEditingTitle(null);
    },
    [updateNote]
  );

  return (
    <div className="p-2 flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <p className="text-[10px] font-semibold tracking-widest text-[var(--xevo-text-faint)] uppercase">
          Notes
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={handleOpenFull}
            title="Open full notepad"
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--xevo-text-faint)] hover:text-[var(--xevo-accent)] hover:bg-[var(--xevo-hover)] transition-colors"
          >
            <Maximize2 size={10} />
          </button>
          <button
            onClick={handleCreate}
            title="New quick note"
            className="w-5 h-5 flex items-center justify-center rounded text-[var(--xevo-text-faint)] hover:text-[var(--xevo-accent)] hover:bg-[var(--xevo-hover)] transition-colors"
          >
            <Plus size={10} />
          </button>
        </div>
      </div>

      {/* Open notepad button */}
      <button
        onClick={handleOpenFull}
        className="flex items-center gap-2 p-3 rounded-md text-left border border-[var(--xevo-border)] bg-[var(--xevo-modal-bg)] hover:border-[var(--xevo-accent)] hover:bg-[var(--xevo-hover)] transition-colors"
      >
        <FileText size={16} className="text-[var(--xevo-accent)] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-[var(--xevo-text)] font-medium">
            Open Notes
          </div>
          <div className="text-[10px] text-[var(--xevo-text-faint)]">
            Full notepad above the webview
          </div>
        </div>
      </button>

      {/* Quick notes list */}
      <div className="rounded-md border border-[var(--xevo-border)] bg-[var(--xevo-modal-bg)] overflow-hidden">
        <div className="flex items-center px-2 py-1.5 border-b border-[var(--xevo-border)]">
          <span className="text-[9px] font-semibold tracking-widest text-[var(--xevo-text-faint)] uppercase">
            Quick Notes ({wsNotes.length})
          </span>
        </div>
        {wsNotes.length === 0 ? (
          <div className="px-2 py-3 text-center">
            <p className="text-[10px] text-[var(--xevo-text-faint)]">
              No notes yet
            </p>
            <p className="text-[9px] text-[var(--xevo-text-faint)] mt-0.5">
              Click + to add one
            </p>
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto">
            {wsNotes.map((note) => (
              <div
                key={note.id}
                className="group border-b border-[var(--xevo-border)] last:border-b-0"
              >
                <div className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-[var(--xevo-hover)] transition-colors">
                  <button
                    onClick={() =>
                      setExpandedId(expandedId === note.id ? null : note.id)
                    }
                    className="flex-1 min-w-0 text-left"
                  >
                    {editingTitle === note.id ? (
                      <input
                        ref={titleInputRef}
                        defaultValue={note.title}
                        onBlur={(e) => handleTitleCommit(note.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter")
                            handleTitleCommit(
                              note.id,
                              (e.target as HTMLInputElement).value
                            );
                          if (e.key === "Escape") setEditingTitle(null);
                        }}
                        className="w-full text-[11px] bg-transparent border-b border-[var(--xevo-accent)] outline-none text-[var(--xevo-text)]"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span className="text-[11px] text-[var(--xevo-text-muted)] font-medium block truncate">
                          {note.title}
                        </span>
                        <span className="text-[9px] text-[var(--xevo-text-faint)]">
                          {relativeTime(note.updatedAt)}
                        </span>
                      </>
                    )}
                  </button>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingTitle(note.id);
                      }}
                      title="Rename"
                      className="text-[var(--xevo-text-faint)] hover:text-[var(--xevo-text)] text-[9px]"
                    >
                      edit
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNote(note.id);
                      }}
                      title="Delete"
                      className="text-[var(--xevo-text-faint)] hover:text-[var(--xevo-danger)]"
                    >
                      <Trash2 size={9} />
                    </button>
                  </div>
                </div>
                {expandedId === note.id && editingTitle !== note.id && (
                  <div className="px-2 pb-2">
                    <textarea
                      defaultValue={note.content}
                      onBlur={(e) =>
                        updateNote(note.id, { content: e.target.value })
                      }
                      placeholder="Write something..."
                      className="w-full text-[10px] bg-[rgba(255,255,255,0.02)] border border-[var(--xevo-border)] rounded p-1.5 text-[var(--xevo-text-muted)] resize-none outline-none focus:border-[var(--xevo-accent)] transition-colors"
                      rows={3}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
