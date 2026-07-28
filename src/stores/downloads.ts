import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface DownloadItem {
  id: string;
  url: string;
  filename: string;
  path: string;
  status: "active" | "done" | "failed";
  startedAt: number;
}

interface DownloadsStore {
  items: DownloadItem[];
  start: (url: string, destination: string) => void;
  finish: (url: string, path: string | null, success: boolean) => void;
  clear: () => void;
}

/** Last path segment, tolerant of both separators — destinations are OS paths. */
function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export const useDownloadsStore = create<DownloadsStore>()(
  persist(
    (set) => ({
      items: [],

      start: (url, destination) =>
        set((s) => ({
          items: [
            {
              id: crypto.randomUUID(),
              url,
              filename: basename(destination),
              path: destination,
              status: "active" as const,
              startedAt: Date.now(),
            },
            ...s.items,
          ],
        })),

      // Tauri's DownloadEvent carries no id, so the finish event is matched back
      // to the newest still-active entry for the same url.
      finish: (url, path, success) =>
        set((s) => {
          const i = s.items.findIndex((d) => d.url === url && d.status === "active");
          if (i === -1) return s;
          const items = [...s.items];
          items[i] = {
            ...items[i],
            status: success ? "done" : "failed",
            path: path ?? items[i].path,
            filename: path ? basename(path) : items[i].filename,
          };
          return { items };
        }),

      clear: () => set({ items: [] }),
    }),
    {
      name: "xevo-downloads",
      version: 1,
      // An "active" download can't survive a restart — there is no handle to
      // resume it, so it would sit spinning forever.
      merge: (persisted, current) => ({
        ...current,
        items: ((persisted as { items?: DownloadItem[] } | undefined)?.items ?? []).filter(
          (d) => d.status !== "active",
        ),
      }),
    },
  ),
);
