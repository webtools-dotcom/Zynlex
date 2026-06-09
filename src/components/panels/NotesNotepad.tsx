import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Save, Search, FileText } from "lucide-react";
import { useNotesStore } from "@/stores/notes";
import { useWorkspacesStore } from "@/stores/workspaces";

export function NotesNotepad() {
  const { activeWorkspaceId } = useWorkspacesStore();
  const { notes, createNote, updateNote, deleteNote } = useNotesStore();

  const wsNotes = useMemo(
    () => notes.filter((n) => n.workspaceId === activeWorkspaceId),
    [notes, activeWorkspaceId]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "">("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedNote = wsNotes.find((n) => n.id === selectedId) ?? null;

  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return wsNotes;
    const q = searchQuery.toLowerCase();
    return wsNotes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q)
    );
  }, [wsNotes, searchQuery]);

  useEffect(() => {
    if (wsNotes.length > 0 && !selectedId) {
      setSelectedId(wsNotes[0].id);
    }
  }, [wsNotes, selectedId]);

  const handleCreate = useCallback(() => {
    const id = createNote(activeWorkspaceId);
    setSelectedId(id);
  }, [activeWorkspaceId, createNote]);

  const handleContentChange = useCallback(
    (value: string) => {
      if (!selectedId) return;
      setSaveStatus("saving");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateNote(selectedId, { content: value });
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(""), 1500);
      }, 500);
    },
    [selectedId, updateNote]
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      if (!selectedId) return;
      updateNote(selectedId, { title: value.trim() || "Untitled" });
    },
    [selectedId, updateNote]
  );

  const wordCount = useMemo(() => {
    if (!selectedNote?.content) return 0;
    return selectedNote.content.trim().split(/\s+/).filter(Boolean).length;
  }, [selectedNote?.content]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar - note list */}
      <div
        className="w-48 flex-shrink-0 flex flex-col border-r overflow-hidden"
        style={{
          borderColor: "var(--xevo-border-subtle)",
          background: "var(--xevo-sidebar-bg)",
        }}
      >
        {/* Search + New */}
        <div className="flex items-center gap-1 p-1.5 border-b" style={{ borderColor: "var(--xevo-border-subtle)" }}>
          <div className="flex-1 flex items-center gap-1 px-1.5 py-1 rounded border" style={{ borderColor: "var(--xevo-border)" }}>
            <Search size={10} className="text-[var(--xevo-text-faint)]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="flex-1 text-[10px] bg-transparent outline-none text-[var(--xevo-text)] placeholder:text-[var(--xevo-text-faint)]"
            />
          </div>
          <button
            onClick={handleCreate}
            title="New note"
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--xevo-text-faint)] hover:text-[var(--xevo-accent)] hover:bg-[var(--xevo-hover)] transition-colors"
          >
            <FileText size={11} />
          </button>
        </div>

        {/* Note list */}
        <div className="flex-1 overflow-y-auto">
          {filteredNotes.length === 0 ? (
            <div className="px-2 py-4 text-center">
              <p className="text-[10px] text-[var(--xevo-text-faint)]">
                {searchQuery ? "No matches" : "No notes"}
              </p>
            </div>
          ) : (
            filteredNotes.map((note) => (
              <button
                key={note.id}
                onClick={() => setSelectedId(note.id)}
                className={`w-full text-left px-2 py-1.5 border-b transition-colors ${
                  selectedId === note.id
                    ? "bg-[var(--xevo-accent-dim)]"
                    : "hover:bg-[var(--xevo-hover)]"
                }`}
                style={{ borderColor: "var(--xevo-border-subtle)" }}
              >
                <span
                  className={`text-[11px] font-medium block truncate ${
                    selectedId === note.id
                      ? "text-[var(--xevo-accent)]"
                      : "text-[var(--xevo-text-muted)]"
                  }`}
                >
                  {note.title}
                </span>
                <span className="text-[9px] text-[var(--xevo-text-faint)]">
                  {note.content
                    ? note.content.slice(0, 40) + (note.content.length > 40 ? "..." : "")
                    : "Empty"}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedNote ? (
          <>
            {/* Title */}
            <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "var(--xevo-border-subtle)" }}>
              <input
                value={selectedNote.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                className="flex-1 text-[13px] font-semibold bg-transparent outline-none text-[var(--xevo-text)]"
                placeholder="Note title"
              />
              <div className="flex items-center gap-1.5">
                {saveStatus && (
                  <span className="text-[9px] text-[var(--xevo-text-faint)] flex items-center gap-1">
                    <Save size={9} />
                    {saveStatus === "saving" ? "Saving..." : "Saved"}
                  </span>
                )}
                <button
                  onClick={() => {
                    if (window.confirm("Delete this note?")) {
                      deleteNote(selectedNote.id);
                      setSelectedId(null);
                    }
                  }}
                  className="text-[9px] text-[var(--xevo-text-faint)] hover:text-[var(--xevo-danger)]"
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Content */}
            <textarea
              key={selectedId}
              ref={textareaRef}
              defaultValue={selectedNote.content}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder="Start writing..."
              className="flex-1 p-3 text-[12px] leading-relaxed bg-transparent outline-none text-[var(--xevo-text-muted)] resize-none font-mono"
              style={{ fontFamily: "var(--xevo-font-body, inherit)" }}
            />

            {/* Footer */}
            <div
              className="flex items-center justify-between px-3 py-1 border-t text-[9px] text-[var(--xevo-text-faint)]"
              style={{ borderColor: "var(--xevo-border-subtle)" }}
            >
              <span>{selectedNote.content.length} chars</span>
              <span>{wordCount} words</span>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText size={24} className="mx-auto mb-2 text-[var(--xevo-text-faint)] opacity-30" />
              <p className="text-[11px] text-[var(--xevo-text-faint)]">
                Select a note or create a new one
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
