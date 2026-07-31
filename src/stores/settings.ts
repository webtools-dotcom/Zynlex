import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { persist } from "zustand/middleware";
import type { AppSettings } from "@/types";
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES } from "@/lib/url";

const DEFAULTS: AppSettings = {
  theme: "dark",
  searchEngine: DEFAULT_SEARCH_ENGINE,
  tabBarPosition: "top",
  homePage: "zynlex://home",
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
      name: "zynlex-settings",
      version: 3,
      migrate: (persistedState, version) => {
        const state = persistedState as any;
        const settings = { ...DEFAULTS, ...(state?.settings || {}) };
        if (version < 3) {
          // v3 dropped the "custom" engine (and its customSearchUrl). Anyone
          // persisted on it — or on an engine we no longer ship — would other-
          // wise land on an id with no template and get no results.
          delete settings.customSearchUrl;
          if (!SEARCH_ENGINES.some((e) => e.id === settings.searchEngine)) {
            settings.searchEngine = DEFAULT_SEARCH_ENGINE;
          }
        }
        return { settings };
      },
    },
  ),
);
