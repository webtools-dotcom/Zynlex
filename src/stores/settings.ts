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
  compactMode: false,
  bookmarkBarVisible: false,
  maxConcurrentWebviews: 10,
  userAgent: null,
};

interface SettingsStore {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => void;
  setPortScanInterval: (seconds: number) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    immer((set) => ({
      settings: DEFAULTS,
      update: (patch) => {
        set((s) => {
          Object.assign(s.settings, patch);
        });
      },
      setPortScanInterval: (seconds) => {
        set((s) => {
          s.settings.portScanInterval = Math.max(5, Math.min(60, seconds));
        });
      },
    })),
    {
      name: "xevo-settings",
      version: 2,
      migrate: (persistedState, version) => {
        if (version < 2) {
          const state = persistedState as any;
          return { settings: { ...DEFAULTS, ...(state.settings || {}) } };
        }
        return persistedState;
      },
    },
  ),
);
