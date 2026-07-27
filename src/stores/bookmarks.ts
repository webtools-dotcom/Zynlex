/**
 * Bookmarks store — workspace-scoped user-saved URLs.
 *
 * Each bookmark belongs to a specific workspace (so a "Frontend" workspace
 * can keep its own set of dev URLs separate from a "Personal" workspace).
 * State is persisted to localStorage under "xevo-bookmarks" and survives
 * app restarts.
 */
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";
import type { Bookmark, BookmarkFolder } from "@/types";

function genId(prefix = "bm"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Shape of the JSON produced by exportWorkspace / accepted by importWorkspace. */
interface BookmarkExport {
  version: 1;
  bookmarks: Bookmark[];
  folders: BookmarkFolder[];
}

interface BookmarksStore {
  bookmarks: Bookmark[];
  folders: BookmarkFolder[];
  lastAddedId: string | null;

  addBookmark: (
    workspaceId: string,
    url: string,
    title: string
  ) => string;
  removeBookmark: (id: string) => void;
  removeBookmarkByUrl: (workspaceId: string, url: string) => void;
  renameBookmark: (id: string, title: string) => void;
  moveBookmark: (id: string, folderId: string | null) => void;
  clearForWorkspace: (workspaceId: string) => void;
  getBookmarksByWorkspace: (workspaceId: string) => Bookmark[];
  isBookmarked: (workspaceId: string, url: string) => boolean;
  clearLastAddedId: () => void;

  addFolder: (workspaceId: string, name: string) => void;
  renameFolder: (id: string, name: string) => void;
  /** Removes the folder; its bookmarks fall back to the root level. */
  removeFolder: (id: string) => void;
  getFoldersByWorkspace: (workspaceId: string) => BookmarkFolder[];

  exportWorkspace: (workspaceId: string) => BookmarkExport;
  /** Re-ids everything on import, so importing twice never collides. */
  importWorkspace: (workspaceId: string, data: unknown) => number;
}

export const useBookmarksStore = create<BookmarksStore>()(
  persist(
    immer((set, get) => ({
      bookmarks: [],
      folders: [],
      lastAddedId: null,

      addBookmark: (workspaceId, url, title) => {
        const trimmedUrl = url.trim();
        if (!trimmedUrl) return "";
        const id = genId();
        set((s) => {
          s.bookmarks.unshift({
            id,
            workspaceId,
            url: trimmedUrl,
            title: title.trim() || trimmedUrl,
            createdAt: Date.now(),
            folderId: null,
          });
          s.lastAddedId = id;
        });
        return id;
      },

      removeBookmark: (id) => {
        set((s) => {
          s.bookmarks = s.bookmarks.filter((b: Bookmark) => b.id !== id);
        });
      },

      removeBookmarkByUrl: (workspaceId, url) => {
        set((s) => {
          s.bookmarks = s.bookmarks.filter(
            (b: Bookmark) => !(b.workspaceId === workspaceId && b.url === url)
          );
        });
      },

      renameBookmark: (id, title) => {
        set((s) => {
          const bm = s.bookmarks.find((b: Bookmark) => b.id === id);
          if (bm) bm.title = title.trim() || bm.url;
        });
      },

      clearForWorkspace: (workspaceId) => {
        set((s) => {
          s.bookmarks = s.bookmarks.filter(
            (b: Bookmark) => b.workspaceId !== workspaceId
          );
        });
      },

      getBookmarksByWorkspace: (workspaceId) =>
        get().bookmarks.filter((b) => b.workspaceId === workspaceId),

      isBookmarked: (workspaceId, url) =>
        get().bookmarks.some(
          (b) => b.workspaceId === workspaceId && b.url === url
        ),

      clearLastAddedId: () => {
        set((s) => {
          s.lastAddedId = null;
        });
      },

      moveBookmark: (id, folderId) => {
        set((s) => {
          const bm = s.bookmarks.find((b: Bookmark) => b.id === id);
          if (bm) bm.folderId = folderId;
        });
      },

      addFolder: (workspaceId, name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        set((s) => {
          s.folders.push({ id: genId("bf"), workspaceId, name: trimmed });
        });
      },

      renameFolder: (id, name) => {
        set((s) => {
          const f = s.folders.find((x: BookmarkFolder) => x.id === id);
          if (f && name.trim()) f.name = name.trim();
        });
      },

      removeFolder: (id) => {
        set((s) => {
          s.folders = s.folders.filter((f: BookmarkFolder) => f.id !== id);
          for (const b of s.bookmarks) {
            if (b.folderId === id) b.folderId = null;
          }
        });
      },

      getFoldersByWorkspace: (workspaceId) =>
        get().folders.filter((f) => f.workspaceId === workspaceId),

      exportWorkspace: (workspaceId) => ({
        version: 1,
        bookmarks: get().bookmarks.filter((b) => b.workspaceId === workspaceId),
        folders: get().folders.filter((f) => f.workspaceId === workspaceId),
      }),

      importWorkspace: (workspaceId, data) => {
        const parsed = data as Partial<BookmarkExport> | null;
        if (!parsed || !Array.isArray(parsed.bookmarks)) return 0;

        // Old folder id → new folder id, so imported bookmarks keep their nesting
        // without ever colliding with folders already in the workspace.
        const folderIdMap = new Map<string, string>();
        const folders: BookmarkFolder[] = [];
        for (const f of parsed.folders ?? []) {
          if (typeof f?.name !== "string") continue;
          const newId = genId("bf");
          folderIdMap.set(f.id, newId);
          folders.push({ id: newId, workspaceId, name: f.name });
        }

        const bookmarks: Bookmark[] = [];
        for (const b of parsed.bookmarks) {
          if (typeof b?.url !== "string" || !b.url.trim()) continue;
          bookmarks.push({
            id: genId(),
            workspaceId,
            url: b.url.trim(),
            title: typeof b.title === "string" && b.title ? b.title : b.url,
            createdAt: typeof b.createdAt === "number" ? b.createdAt : Date.now(),
            folderId: b.folderId ? folderIdMap.get(b.folderId) ?? null : null,
          });
        }

        set((s) => {
          s.folders.push(...folders);
          s.bookmarks.unshift(...bookmarks);
        });
        return bookmarks.length;
      },
    })),
    {
      name: "xevo-bookmarks",
      version: 1,
      // v0 bookmarks predate folders — everything lands at the root level.
      migrate: (persisted) => {
        const state = persisted as { bookmarks?: Bookmark[] } | undefined;
        return {
          bookmarks: (state?.bookmarks ?? []).map((b) => ({
            ...b,
            folderId: b.folderId ?? null,
          })),
          folders: [],
        };
      },
      partialize: (state) => ({
        bookmarks: state.bookmarks,
        folders: state.folders,
      }),
    }
  )
);
