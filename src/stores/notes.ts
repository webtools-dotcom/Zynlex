import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Note } from "@/types";

interface NotesStore {
  notes: Note[];
  createNote: (workspaceId: string) => string;
  updateNote: (id: string, partial: Partial<Pick<Note, "title" | "content">>) => void;
  deleteNote: (id: string) => void;
  getNotesByWorkspace: (workspaceId: string) => Note[];
}

function genId(): string {
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
          title: "Untitled",
          content: "",
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ notes: [note, ...s.notes] }));
        return id;
      },
      updateNote: (id, partial) =>
        set((s) => ({
          notes: s.notes.map((n) =>
            n.id === id
              ? { ...n, ...partial, updatedAt: Date.now() }
              : n
          ),
        })),
      deleteNote: (id) =>
        set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
      getNotesByWorkspace: (workspaceId) =>
        get().notes.filter((n) => n.workspaceId === workspaceId),
    }),
    { name: "xevo-notes" }
  )
);
