// ================================================================
// XEVO Browser — Core Type Definitions
// ================================================================

// ─── Tab ────────────────────────────────────────────────────────

export interface Tab {
  id: string;
  title: string;
  url: string;
  favicon: string | null;
  isLoading: boolean;
  isPinned: boolean;
  isMuted: boolean;
  workspaceId: string;
  createdAt: number;
  scrollPosition: number;
  zoom: number;
  historyBack: string[];
  historyForward: string[];
  loadTime: number | null;
}

export type NewTabOptions = Partial<Omit<Tab, "id" | "createdAt" | "workspaceId">>;

// ─── Workspace ──────────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  color: string;
  icon: string;
  createdAt: number;
  tabIds: string[];
  activeTabId: string | null;
}

// ─── Localhost Server ────────────────────────────────────────────

export interface LocalServer {
  port: number;
  protocol: "http" | "https";
  label: string | null;
  title: string | null;
  status: number | null;
  isAlive: boolean;
  lastSeen: number | null;
  isPinned: boolean;
}

// ─── Settings ────────────────────────────────────────────────────

export type SearchEngine = "google" | "duckduckgo" | "bing" | "custom";
export type ThemeMode = "dark" | "light" | "system";
export type TabBarPosition = "top" | "left";
export type PanelId =
  | "servers"
  | "bookmarks"
  | "history"
  | "network"
  | "api"
  | "notes"
  | "jwt"
  | "base64";

export interface AppSettings {
  theme: ThemeMode;
  searchEngine: SearchEngine;
  customSearchUrl: string;
  tabBarPosition: TabBarPosition;
  homePage: string;
  /** Port scan interval in seconds (5..60, default 10) */
  portScanInterval: number;
  customPorts: number[];
  clearOnClose: boolean;
  compactMode: boolean;
}

// ─── UI State ────────────────────────────────────────────────────

export interface UIState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  activePanel: PanelId | null;
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
}

// ─── Find in Page ─────────────────────────────────────────────────

export interface FindResult {
  active_match: number;
  total_matches: number;
  final_update: boolean;
}

// ─── Bookmarks ────────────────────────────────────────────────────

export interface Bookmark {
  id: string;
  workspaceId: string;
  url: string;
  title: string;
  createdAt: number;
}

// ─── API Tester ───────────────────────────────────────────────────

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "DELETE"
  | "PATCH"
  | "HEAD"
  | "OPTIONS";

export interface ApiHeader {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface ApiHistoryEntry {
  id: string;
  method: HttpMethod;
  url: string;
  status: number;
  statusText: string;
  durationMs: number;
  createdAt: number;
}

// ─── Overlay Panel ────────────────────────────────────────────────

export type OverlayPanelId = "none" | "api-tester" | "notes-notepad";

// ─── History ──────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  timestamp: number;
  workspaceId: string;
}

// ─── Notes ────────────────────────────────────────────────────────

export type NoteColor = "" | "red" | "orange" | "yellow" | "green" | "blue" | "purple";

export interface Note {
  id: string;
  workspaceId: string;
  title: string;
  content: string;
  isPinned: boolean;
  color: NoteColor;
  createdAt: number;
  updatedAt: number;
}
