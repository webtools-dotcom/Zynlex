/**
 * Saved API requests, scoped per workspace — same shape as stores/headers.ts
 * (a `byWs` map keyed by workspaceId), persisted to localStorage.
 *
 * Deliberately no environment variables / {{VAR}} templating — that is a V2
 * item, not part of collections.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ApiHeader, HttpMethod } from "@/types";

export interface SavedRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: ApiHeader[];
  body: string;
  folderId: string | null;
}

interface RequestFolder {
  id: string;
  name: string;
}

interface Collection {
  folders: RequestFolder[];
  requests: SavedRequest[];
}

interface ApiCollectionsStore {
  byWs: Record<string, Collection>;
  get: (wsId: string) => Collection;
  saveRequest: (wsId: string, req: Omit<SavedRequest, "id">) => void;
  updateRequest: (wsId: string, id: string, patch: Partial<SavedRequest>) => void;
  removeRequest: (wsId: string, id: string) => void;
  duplicateRequest: (wsId: string, id: string) => void;
  addFolder: (wsId: string, name: string) => void;
  renameFolder: (wsId: string, id: string, name: string) => void;
  /** Removes the folder; its requests fall back to the root level. */
  removeFolder: (wsId: string, id: string) => void;
}

const EMPTY: Collection = { folders: [], requests: [] };

export const useApiCollectionsStore = create<ApiCollectionsStore>()(
  persist(
    (set, get) => {
      /** Every mutation is "read this workspace's collection, write it back". */
      const patchWs = (wsId: string, fn: (c: Collection) => Collection) =>
        set((s) => ({
          byWs: { ...s.byWs, [wsId]: fn(s.byWs[wsId] ?? EMPTY) },
        }));

      return {
        byWs: {},

        get: (wsId) => get().byWs[wsId] ?? EMPTY,

        saveRequest: (wsId, req) =>
          patchWs(wsId, (c) => ({
            ...c,
            requests: [...c.requests, { ...req, id: crypto.randomUUID() }],
          })),

        updateRequest: (wsId, id, patch) =>
          patchWs(wsId, (c) => ({
            ...c,
            requests: c.requests.map((r) => (r.id === id ? { ...r, ...patch } : r)),
          })),

        removeRequest: (wsId, id) =>
          patchWs(wsId, (c) => ({
            ...c,
            requests: c.requests.filter((r) => r.id !== id),
          })),

        duplicateRequest: (wsId, id) =>
          patchWs(wsId, (c) => {
            const src = c.requests.find((r) => r.id === id);
            if (!src) return c;
            return {
              ...c,
              requests: [
                ...c.requests,
                { ...src, id: crypto.randomUUID(), name: `${src.name} copy` },
              ],
            };
          }),

        addFolder: (wsId, name) =>
          patchWs(wsId, (c) => ({
            ...c,
            folders: [...c.folders, { id: crypto.randomUUID(), name }],
          })),

        renameFolder: (wsId, id, name) =>
          patchWs(wsId, (c) => ({
            ...c,
            folders: c.folders.map((f) => (f.id === id ? { ...f, name } : f)),
          })),

        removeFolder: (wsId, id) =>
          patchWs(wsId, (c) => ({
            folders: c.folders.filter((f) => f.id !== id),
            requests: c.requests.map((r) => (r.folderId === id ? { ...r, folderId: null } : r)),
          })),
      };
    },
    {
      name: "xevo-api-collections",
      version: 1,
      partialize: (s) => ({ byWs: s.byWs }),
    },
  ),
);
