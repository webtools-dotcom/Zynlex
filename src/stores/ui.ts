import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { PanelId, OverlayPanelId } from "@/types";

export type ToastKind = "success" | "info" | "danger";

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
}

interface UIStore {
  sidebarOpen: boolean;
  sidebarWidth: number;
  activePanel: PanelId | null;
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  settingsPanelOpen: boolean;
  shortcutHelpOpen: boolean;
  findOpen: boolean;
  findQuery: string;
  findActiveMatch: number;
  findTotalMatches: number;
  apiTesterOpen: boolean;
  overlayPanel: OverlayPanelId;
  overlayHeight: number;
  toasts: Toast[];

  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setActivePanel: (p: PanelId | null) => void;
  togglePanel: (p: PanelId) => void;
  setCommandPaletteOpen: (v: boolean) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
  setSettingsOpen: (v: boolean) => void;
  toggleSettingsPanel: () => void;
  setSettingsPanelOpen: (v: boolean) => void;
  openShortcutHelp: () => void;
  closeShortcutHelp: () => void;
  openFind: () => void;
  closeFind: () => void;
  setFindQuery: (q: string) => void;
  setFindResult: (active: number, total: number) => void;
  openApiTester: () => void;
  closeApiTester: () => void;
  openOverlay: (panel: OverlayPanelId, height?: number) => void;
  closeOverlay: () => void;
  setOverlayHeight: (h: number) => void;
  pushToast: (message: string, kind?: ToastKind) => void;
  dismissToast: (id: string) => void;
}

function genToastId(): string {
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const useUIStore = create<UIStore>()(
  immer((set, get) => ({
    sidebarOpen: true,
    sidebarWidth: 210,
    activePanel: "servers",
    commandPaletteOpen: false,
    settingsOpen: false,
    settingsPanelOpen: false,
    shortcutHelpOpen: false,
    findOpen: false,
    findQuery: "",
    findActiveMatch: 0,
    findTotalMatches: 0,
    apiTesterOpen: false,
    overlayPanel: "none",
    overlayHeight: 0.4,
    toasts: [],

    setSidebarOpen: (v) => set((s) => { s.sidebarOpen = v; }),
    toggleSidebar: () => set((s) => { s.sidebarOpen = !s.sidebarOpen; }),
    setSidebarWidth: (w) => set((s) => { s.sidebarWidth = Math.max(160, Math.min(380, w)); }),
    setActivePanel: (p) => set((s) => { s.activePanel = p; }),
    togglePanel: (p) => set((s) => { s.activePanel = s.activePanel === p ? null : p; }),
    setCommandPaletteOpen: (v) => set((s) => { s.commandPaletteOpen = v; }),
    openCommandPalette: () => set((s) => { s.commandPaletteOpen = true; }),
    closeCommandPalette: () => set((s) => { s.commandPaletteOpen = false; }),
    setSettingsOpen: (v) => set((s) => { s.settingsOpen = v; }),
    toggleSettingsPanel: () => set((s) => { s.settingsPanelOpen = !s.settingsPanelOpen; }),
    setSettingsPanelOpen: (v) => set((s) => { s.settingsPanelOpen = v; }),
    openShortcutHelp: () => set((s) => { s.shortcutHelpOpen = true; }),
    closeShortcutHelp: () => set((s) => { s.shortcutHelpOpen = false; }),
    openFind: () => set((s) => {
      s.findOpen = true;
      s.findActiveMatch = 0;
      s.findTotalMatches = 0;
    }),
    closeFind: () => set((s) => {
      s.findOpen = false;
      s.findActiveMatch = 0;
      s.findTotalMatches = 0;
    }),
    setFindQuery: (q) => set((s) => { s.findQuery = q; }),
    setFindResult: (active, total) => set((s) => {
      s.findActiveMatch = active;
      s.findTotalMatches = total;
    }),
    openApiTester: () => set((s) => { s.apiTesterOpen = true; }),
    closeApiTester: () => set((s) => { s.apiTesterOpen = false; }),
    openOverlay: (panel, height) => set((s) => {
      s.overlayPanel = panel;
      if (height !== undefined) s.overlayHeight = height;
    }),
    closeOverlay: () => set((s) => { s.overlayPanel = "none"; }),
    setOverlayHeight: (h) => set((s) => { s.overlayHeight = Math.max(0.2, Math.min(0.8, h)); }),
    pushToast: (message, kind = "info") => {
      const id = genToastId();
      set((s) => {
        s.toasts.push({ id, message, kind });
      });
      setTimeout(() => {
        get().dismissToast(id);
      }, 2500);
    },
    dismissToast: (id) => set((s) => {
      s.toasts = s.toasts.filter((t: Toast) => t.id !== id);
    }),
  }))
);
