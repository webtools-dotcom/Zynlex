import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";
import type { AppSettings } from "@/types";

const DEFAULTS: AppSettings = {
  theme: "dark",
  searchEngine: "google",
  customSearchUrl: "",
  tabBarPosition: "top",
  homePage: "xevo://home",
  portScanInterval: 10,
  customPorts: [],
  clearOnClose: false,
  compactMode: false,
  maxConcurrentWebviews: 10,
  userAgent: null,
};

interface SettingsStore {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  setTheme: (theme: AppSettings["theme"]) => void;
  setSearchEngine: (engine: AppSettings["searchEngine"]) => void;
  setCustomSearchUrl: (url: string) => void;
  setPortScanInterval: (seconds: number) => void;
  setCompactMode: (v: boolean) => void;
  reset: () => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    immer((set) => ({
      settings: DEFAULTS,
      update: (patch) => { set((s) => { Object.assign(s.settings, patch); }); },
      setTheme: (theme) => { set((s) => { s.settings.theme = theme; }); },
      setSearchEngine: (engine) => { set((s) => { s.settings.searchEngine = engine; }); },
      setCustomSearchUrl: (url) => { set((s) => { s.settings.customSearchUrl = url; }); },
      setPortScanInterval: (seconds) => {
        set((s) => { s.settings.portScanInterval = Math.max(5, Math.min(60, seconds)); });
      },
      setCompactMode: (v) => { set((s) => { s.settings.compactMode = v; }); },
      reset: () => { set((s) => { s.settings = DEFAULTS; }); },
    })),
    {
      name: "xevo-settings",
      version: 2,
      migrate: (persistedState, version) => {
        if (version === 0) {
          const state = persistedState as any;
          return { settings: { ...DEFAULTS, ...(state.settings || {}) } };
        }
        if (version === 1) {
          const state = persistedState as any;
          return { settings: { ...DEFAULTS, ...(state.settings || {}) } };
        }
        return persistedState;
      },
    }
  )
);
