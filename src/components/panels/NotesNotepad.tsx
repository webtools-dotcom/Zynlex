import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Save, Search, FileText, Pin, Download } from "lucide-react";
import { RichTextEditor, type RichTextEditorHandle } from "@tolipovjs/rich-text";
import { useNotesStore } from "@/stores/notes";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useSettingsStore } from "@/stores/settings";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import type { NoteColor } from "@/types";

const COLOR_OPTIONS: { value: NoteColor; label: string; hex: string }[] = [
  { value: "", label: "None", hex: "transparent" },
  { value: "red", label: "Red", hex: "#ef4444" },
  { value: "orange", label: "Orange", hex: "#f97316" },
  { value: "yellow", label: "Yellow", hex: "#eab308" },
  { value: "green", label: "Green", hex: "#22c55e" },
  { value: "blue", label: "Blue", hex: "#3b82f6" },
  { value: "purple", label: "Purple", hex: "#a855f7" },
];

function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function readingTime(wordCount: number): string {
  const mins = Math.max(1, Math.ceil(wordCount / 200));
  return `${mins} min read`;
}

export function NotesNotepad() {
  const { activeWorkspaceId } = useWorkspacesStore();
  const theme = useSettingsStore((s) => s.settings.theme);
  const { notes, createNote, updateNote, deleteNote, togglePin, setColor } = useNotesStore();

  const wsNotes = useMemo(
    () => notes.filter((n) => n.workspaceId === activeWorkspaceId),
    [notes, activeWorkspaceId]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "">("");
  const [showColorPicker, setShowColorPicker] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const colorPickerRef = useRef<HTMLDivElement>(null);

  const selectedNote = wsNotes.find((n) => n.id === selectedId) ?? null;

  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return wsNotes;
    const q = searchQuery.toLowerCase();
    return wsNotes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        stripHtml(n.content).toLowerCase().includes(q)
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
    (html: string) => {
      if (!selectedId) return;
      setSaveStatus("saving");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateNote(selectedId, { content: html });
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(""), 1500);
      }, 500);
    },
    [selectedId, updateNote]
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      if (!selectedId) return;
      updateNote(selectedId, { title: value });
    },
    [selectedId, updateNote]
  );

  const wordCount = useMemo(() => {
    if (!selectedNote?.content) return 0;
    return countWords(stripHtml(selectedNote.content));
  }, [selectedNote?.content]);

  // Close color picker on outside click
  useEffect(() => {
    if (!showColorPicker) return;
    function handleClick(e: MouseEvent) {
      if (colorPickerRef.current && !colorPickerRef.current.contains(e.target as Node)) {
        setShowColorPicker(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showColorPicker]);

  const charCount = useMemo(() => {
    if (!selectedNote?.content) return 0;
    return stripHtml(selectedNote.content).length;
  }, [selectedNote?.content]);

  const handleExport = useCallback(() => {
    if (!selectedNote) return;
    const text = stripHtml(selectedNote.content);
    const title = selectedNote.title || "Untitled";
    const blob = new Blob([`# ${title}\n\n${text}`], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedNote]);

  const resolvedTheme = useMemo(() => {
    if (theme === "dark") return "dark" as const;
    if (theme === "light") return "light" as const;
    return "auto" as const;
  }, [theme]);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar - note list */}
      <div
        className="w-48 flex-shrink-0 flex flex-col border-r overflow-hidden"
        style={{
          borderColor: "var(--color-border-subtle)",
          background: "var(--color-surface)",
        }}
      >
        {/* Search + New */}
        <div className="flex items-center gap-1 p-1.5 border-b" style={{ borderColor: "var(--color-border-subtle)" }}>
          <div className="flex-1 flex items-center gap-1 px-1.5 py-1 rounded border" style={{ borderColor: "var(--color-border)" }}>
            <Search size={12} className="text-[var(--color-text-disabled)]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="flex-1 text-[12px] bg-transparent outline-none text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]"
            />
          </div>
          <button
            onClick={handleCreate}
            title="New note"
            aria-label="New note"
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-disabled)] hover:text-[var(--color-accent)] hover:bg-[var(--color-hover)] transition-colors"
          >
            <FileText size={11} />
          </button>
        </div>

        {/* Note list */}
        <div className="flex-1 overflow-y-auto">
          {filteredNotes.length === 0 ? (
            <div className="px-2 py-4 text-center">
              <p className="text-[12px] text-[var(--color-text-disabled)]">
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
                    ? "bg-[var(--color-accent-dim)]"
                    : "hover:bg-[var(--color-hover)]"
                }`}
                style={{ borderColor: "var(--color-border-subtle)" }}
              >
                <div className="flex items-center gap-1">
                  {note.color && (
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: COLOR_OPTIONS.find((c) => c.value === note.color)?.hex }}
                    />
                  )}
                  <span
                    className={`text-[12px] font-medium truncate ${
                      selectedId === note.id
                        ? "text-[var(--color-accent)]"
                        : "text-[var(--color-text-muted)]"
                    }`}
                  >
                    {note.title || "Untitled"}
                  </span>
                  {note.isPinned && (
                    <Pin size={10} className="text-[var(--color-text-disabled)] flex-shrink-0" />
                  )}
                </div>
                <span className="text-[12px] text-[var(--color-text-disabled)]">
                  {note.content
                    ? stripHtml(note.content).slice(0, 40) + (stripHtml(note.content).length > 40 ? "..." : "")
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
            {/* Title + controls */}
            <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "var(--color-border-subtle)" }}>
              <input
                value={selectedNote.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                className="flex-1 text-[13px] font-semibold bg-transparent outline-none text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)]"
                placeholder="Untitled"
              />
              <div className="flex items-center gap-1.5">
                {saveStatus && (
                  <span className="text-[12px] text-[var(--color-text-disabled)] flex items-center gap-1">
                    <Save size={11} />
                    {saveStatus === "saving" ? "Saving..." : "Saved"}
                  </span>
                )}
                <button
                  onClick={() => togglePin(selectedNote.id)}
                  title={selectedNote.isPinned ? "Unpin" : "Pin"}
                  aria-label={selectedNote.isPinned ? "Unpin note" : "Pin note"}
                  className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
                    selectedNote.isPinned
                      ? "text-[var(--color-accent)]"
                      : "text-[var(--color-text-disabled)] hover:text-[var(--color-accent)]"
                  } hover:bg-[var(--color-hover)]`}
                >
                  <Pin size={12} />
                </button>
                <div className="relative" ref={colorPickerRef}>
                  <button
                    onClick={() => setShowColorPicker(showColorPicker === selectedNote.id ? null : selectedNote.id)}
                    title="Note color"
                    className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-disabled)] hover:text-[var(--color-accent)] hover:bg-[var(--color-hover)] transition-colors"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full border"
                      style={{
                        background: selectedNote.color
                          ? COLOR_OPTIONS.find((c) => c.value === selectedNote.color)?.hex
                          : "transparent",
                        borderColor: "var(--color-text-disabled)",
                      }}
                    />
                  </button>
                  {showColorPicker === selectedNote.id && (
                    <div
                      className="absolute right-0 top-full mt-1 z-20 p-1.5 rounded border flex gap-1"
                      style={{
                        background: "var(--color-elevated)",
                        borderColor: "var(--color-border)",
                      }}
                    >
                      {COLOR_OPTIONS.map((c) => (
                        <button
                          key={c.value}
                          aria-label={c.label}
                          onClick={() => {
                            setColor(selectedNote.id, c.value);
                            setShowColorPicker(null);
                          }}
                          title={c.label}
                          className="w-5 h-5 rounded-full border"
                          style={{
                            background: c.hex || "transparent",
                            borderColor: "var(--color-border)",
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={handleExport}
                  title="Export as Markdown"
                  aria-label="Export as Markdown"
                  className="w-6 h-6 flex items-center justify-center rounded text-[var(--color-text-disabled)] hover:text-[var(--color-accent)] hover:bg-[var(--color-hover)] transition-colors"
                >
                  <Download size={12} />
                </button>
                <ConfirmButton
                  onConfirm={() => {
                    deleteNote(selectedNote.id);
                    setSelectedId(null);
                  }}
                  title="Delete this note"
                  className="text-[12px] text-[var(--color-text-disabled)] hover:text-[var(--color-dead)]"
                >
                  Delete
                </ConfirmButton>
              </div>
            </div>

            {/* Rich text editor */}
            <div className="flex-1 overflow-hidden min-h-0" style={{ background: "var(--color-base)" }}>
              <RichTextEditor
                key={selectedId}
                ref={editorRef}
                value={selectedNote.content}
                onChange={handleContentChange}
                theme={resolvedTheme}
                toolbar="basic"
                slashMenu
                markdownShortcuts
                bubbleToolbar
                findReplace
                placeholder="Start writing... Type / for blocks, ** for bold, # for heading"
                minHeight="100%"
                style={{ height: "100%", border: "none", borderRadius: 0 }}
              />
            </div>

            {/* Footer */}
            <div
              className="flex items-center justify-between px-3 py-1 border-t text-[12px] text-[var(--color-text-disabled)]"
              style={{ borderColor: "var(--color-border-subtle)" }}
            >
              <span>{charCount} chars</span>
              <span>{wordCount} words</span>
              <span>{readingTime(wordCount)}</span>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText size={24} className="mx-auto mb-2 text-[var(--color-text-disabled)] opacity-30" />
              <p className="text-[12px] text-[var(--color-text-disabled)]">
                Select a note or create a new one
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
