/**
 * App update state, shared by the toolbar pill and Settings.
 *
 * The prompt used to be a bottom-right banner in the main window's DOM — which
 * is drawn *under* the native tab webview, so with any page open it was
 * invisible and nobody ever saw an update. Everything here surfaces in the
 * toolbar (never covered) or in Settings (which hides the webview while open).
 *
 * Checks on launch and when asked from Settings. Nothing is downloaded until
 * the user clicks.
 */
import { create } from "zustand";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type Phase = "idle" | "checking" | "downloading" | "ready" | "failed";

interface UpdatesStore {
  update: Update | null;
  phase: Phase;
  pct: number;
  /** Outcome of the last manual check, shown in Settings. */
  lastCheck: "none" | "up-to-date" | "available" | "error";
  check: () => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
}

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const useUpdatesStore = create<UpdatesStore>()((set, get) => ({
  update: null,
  phase: "idle",
  pct: 0,
  lastCheck: "none",

  check: async () => {
    if (!IS_TAURI || get().phase === "checking" || get().phase === "downloading") return;
    set({ phase: "checking" });
    try {
      const update = await checkForUpdate();
      set({ update, phase: "idle", lastCheck: update ? "available" : "up-to-date" });
    } catch {
      // Offline is normal; Settings shows the error, the toolbar stays quiet.
      set({ phase: "idle", lastCheck: "error" });
    }
  },

  install: async () => {
    const { update } = get();
    if (!update) return;
    set({ phase: "downloading", pct: 0 });
    let total = 0;
    let got = 0;
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          got += e.data.chunkLength;
          if (total > 0) set({ pct: Math.round((got / total) * 100) });
        }
      });
      set({ phase: "ready" });
    } catch {
      set({ phase: "failed" });
    }
  },

  restart: () => relaunch(),
}));
