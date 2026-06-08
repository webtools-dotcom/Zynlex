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
import type { Bookmark } from "@/types";

function genId(): string {
  return `bm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface BookmarksStore {
  bookmarks: Bookmark[];
  lastAddedId: string | null;

  addBookmark: (
    workspaceId: string,
    url: string,
    title: string
  ) => string;
  removeBookmark: (id: string) => void;
  removeBookmarkByUrl: (workspaceId: string, url: string) => void;
  renameBookmark: (id: string, title: string) => void;
  clearForWorkspace: (workspaceId: string) => void;
  getBookmarksByWorkspace: (workspaceId: string) => Bookmark[];
  isBookmarked: (workspaceId: string, url: string) => boolean;
  clearLastAddedId: () => void;
}

export const useBookmarksStore = create<BookmarksStore>()(
  persist(
    immer((set, get) => ({
      bookmarks: [],
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
    })),
    {
      name: "xevo-bookmarks",
      partialize: (state) => ({ bookmarks: state.bookmarks }),
    }
  )
);
