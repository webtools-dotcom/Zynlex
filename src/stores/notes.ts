import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Note, NoteColor } from "@/types";

interface NotesStore {
  notes: Note[];
  createNote: (workspaceId: string) => string;
  updateNote: (id: string, partial: Partial<Pick<Note, "title" | "content" | "isPinned" | "color">>) => void;
  deleteNote: (id: string) => void;
  getNotesByWorkspace: (workspaceId: string) => Note[];
  togglePin: (id: string) => void;
  setColor: (id: string, color: NoteColor) => void;
}

function genId(): string {
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
}

export const useNotesStore = create<NotesStore>()(
  persist(
    (set, get) => ({
      notes: [],
      createNote: (workspaceId) => {
        const id = genId();
        const now = Date.now();
        const note: Note = {
          id,
          workspaceId,
          title: "",
          content: "",
          isPinned: false,
          color: "",
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ notes: [note, ...s.notes] }));
        return id;
      },
      updateNote: (id, partial) =>
        set((s) => ({
          notes: sortNotes(
            s.notes.map((n) =>
              n.id === id
                ? { ...n, ...partial, updatedAt: Date.now() }
                : n
            )
          ),
        })),
      deleteNote: (id) =>
        set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
      getNotesByWorkspace: (workspaceId) =>
        sortNotes(get().notes.filter((n) => n.workspaceId === workspaceId)),
      togglePin: (id) =>
        set((s) => ({
          notes: sortNotes(
            s.notes.map((n) =>
              n.id === id ? { ...n, isPinned: !n.isPinned, updatedAt: Date.now() } : n
            )
          ),
        })),
      setColor: (id, color) =>
        set((s) => ({
          notes: sortNotes(
            s.notes.map((n) =>
              n.id === id ? { ...n, color, updatedAt: Date.now() } : n
            )
          ),
        })),
    }),
    { name: "xevo-notes" }
  )
);
