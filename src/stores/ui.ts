import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type { PanelId, OverlayPanelId } from "@/types";

type ToastKind = "success" | "info" | "danger";

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
}

interface Viewport {
  id: string;
  url: string;
  width: number;
  height: number;
  label: string;
  deviceCategory: "mobile" | "tablet" | "laptop";
  orientation: "portrait" | "landscape";
  deviceScaleFactor: number;
  mobile: boolean;
  touch: boolean;
  userAgent?: string;
}

interface UIStore {
  sidebarOpen: boolean;
  sidebarWidth: number;
  activePanel: PanelId | null;
  commandPaletteOpen: boolean;
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

  viewportMode: boolean;
  viewports: Viewport[];
  selectedViewportId: string | null;

  setSidebarOpen: (v: boolean) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setActivePanel: (p: PanelId | null) => void;
  togglePanel: (p: PanelId) => void;
  setCommandPaletteOpen: (v: boolean) => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
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
  /** Command-palette MRU, newest first, capped. */
  recentPaletteIds: string[];
  pushRecentPaletteId: (id: string) => void;

  enterViewportMode: () => void;
  exitViewportMode: () => void;
  addViewport: (preset: {
    label: string;
    width: number;
    height: number;
    category: "mobile" | "tablet" | "laptop";
    deviceScaleFactor: number;
    mobile: boolean;
    touch: boolean;
    userAgent?: string;
  }) => void;
  removeViewport: (id: string) => void;
  selectViewport: (id: string | null) => void;
  rotateViewport: (id: string) => void;
  resizeViewportDimensions: (id: string, width: number, height: number) => void;
}

export const useUIStore = create<UIStore>()(
  immer((set, get) => ({
    sidebarOpen: true,
    sidebarWidth: 240,
    activePanel: "servers",
    commandPaletteOpen: false,
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
    recentPaletteIds: [],
    viewportMode: false,
    viewports: [],
    selectedViewportId: null,

    setSidebarOpen: (v) =>
      set((s) => {
        s.sidebarOpen = v;
      }),
    toggleSidebar: () =>
      set((s) => {
        s.sidebarOpen = !s.sidebarOpen;
      }),
    setSidebarWidth: (w) =>
      set((s) => {
        s.sidebarWidth = Math.max(180, Math.min(Math.max(480, window.innerWidth - 420), w));
      }),
    setActivePanel: (p) =>
      set((s) => {
        s.activePanel = p;
      }),
    togglePanel: (p) =>
      set((s) => {
        s.activePanel = s.activePanel === p ? null : p;
      }),
    setCommandPaletteOpen: (v) =>
      set((s) => {
        s.commandPaletteOpen = v;
      }),
    openCommandPalette: () =>
      set((s) => {
        s.commandPaletteOpen = true;
      }),
    closeCommandPalette: () =>
      set((s) => {
        s.commandPaletteOpen = false;
      }),
    toggleSettingsPanel: () =>
      set((s) => {
        s.settingsPanelOpen = !s.settingsPanelOpen;
      }),
    setSettingsPanelOpen: (v) =>
      set((s) => {
        s.settingsPanelOpen = v;
      }),
    openShortcutHelp: () =>
      set((s) => {
        s.shortcutHelpOpen = true;
      }),
    closeShortcutHelp: () =>
      set((s) => {
        s.shortcutHelpOpen = false;
      }),
    openFind: () =>
      set((s) => {
        s.findOpen = true;
        s.findActiveMatch = 0;
        s.findTotalMatches = 0;
      }),
    closeFind: () =>
      set((s) => {
        s.findOpen = false;
        s.findQuery = "";
        s.findActiveMatch = 0;
        s.findTotalMatches = 0;
      }),
    setFindQuery: (q) =>
      set((s) => {
        s.findQuery = q;
      }),
    setFindResult: (active, total) =>
      set((s) => {
        s.findActiveMatch = active;
        s.findTotalMatches = total;
      }),
    openApiTester: () =>
      set((s) => {
        s.apiTesterOpen = true;
      }),
    closeApiTester: () =>
      set((s) => {
        s.apiTesterOpen = false;
      }),
    openOverlay: (panel, height) =>
      set((s) => {
        s.overlayPanel = panel;
        if (height !== undefined) s.overlayHeight = height;
      }),
    closeOverlay: () =>
      set((s) => {
        s.overlayPanel = "none";
      }),
    setOverlayHeight: (h) =>
      set((s) => {
        s.overlayHeight = Math.max(0.2, Math.min(0.8, h));
      }),
    pushToast: (message, kind = "info") => {
      const id = crypto.randomUUID();
      set((s) => {
        s.toasts.push({ id, message, kind });
      });
      setTimeout(() => {
        get().dismissToast(id);
      }, 2500);
    },
    dismissToast: (id) =>
      set((s) => {
        s.toasts = s.toasts.filter((t: Toast) => t.id !== id);
      }),
    pushRecentPaletteId: (id) =>
      set((s) => {
        s.recentPaletteIds = [id, ...s.recentPaletteIds.filter((x: string) => x !== id)].slice(
          0,
          5,
        );
      }),

    enterViewportMode: () =>
      set((s) => {
        s.viewportMode = true;
      }),
    // Keeps the configured devices — leaving viewport mode used to wipe the
    // whole list, so an accidental toggle threw away your setup and you had to
    // re-add every preset. The native webviews are still torn down (and rebuilt
    // on re-entry) by ViewportSurface's unmount cleanup.
    exitViewportMode: () =>
      set((s) => {
        s.viewportMode = false;
      }),
    addViewport: (preset) =>
      set((s) => {
        const id = crypto.randomUUID();
        // Tablets are specified portrait but are overwhelmingly used landscape,
        // and a 924×1480 portrait frame scales down to an unusable sliver.
        const landscape = preset.category === "tablet";
        s.viewports.push({
          id,
          url: "",
          width: landscape ? preset.height : preset.width,
          height: landscape ? preset.width : preset.height,
          label: preset.label,
          deviceCategory: preset.category,
          orientation: landscape ? "landscape" : "portrait",
          deviceScaleFactor: preset.deviceScaleFactor,
          mobile: preset.mobile,
          touch: preset.touch,
          userAgent: preset.userAgent,
        });
        s.selectedViewportId = id;
      }),
    removeViewport: (id) =>
      set((s) => {
        s.viewports = s.viewports.filter((v) => v.id !== id);
        if (s.selectedViewportId === id) {
          s.selectedViewportId = s.viewports.length > 0 ? s.viewports[0].id : null;
        }
      }),
    selectViewport: (id) =>
      set((s) => {
        s.selectedViewportId = id;
      }),
    rotateViewport: (id) =>
      set((s) => {
        const vp = s.viewports.find((v) => v.id === id);
        if (vp) {
          const tmp = vp.width;
          vp.width = vp.height;
          vp.height = tmp;
          vp.orientation = vp.orientation === "portrait" ? "landscape" : "portrait";
        }
      }),
    resizeViewportDimensions: (id, width, height) =>
      set((s) => {
        const vp = s.viewports.find((v) => v.id === id);
        if (vp) {
          vp.width = Math.max(120, Math.min(3840, width));
          vp.height = Math.max(120, Math.min(3840, height));
        }
      }),
  })),
);
