// ─── Tab ────────────────────────────────────────────────────────

export interface Tab {
  id: string;
  title: string;
  url: string;
  favicon: string | null;
  isLoading: boolean;
  isPinned: boolean;
  workspaceId: string;
  createdAt: number;
  savedFormState: string | null;
  zoom: number;
  historyBack: string[];
  historyForward: string[];
  loadTime: number | null;
  /** Timestamp when the tab's webview was destroyed to save memory. null = alive. */
  discardedAt: number | null;
  /** Timestamp when this tab was last the active (visible) tab. */
  lastActiveAt: number;
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

type SearchEngine = "google" | "duckduckgo" | "bing" | "custom";
export type ThemeMode = "dark" | "light" | "system";
type TabBarPosition = "top" | "left";
export type PanelId =
  | "servers"
  | "bookmarks"
  | "history"
  | "downloads"
  | "network"
  | "api"
  | "jwt"
  | "base64"
  | "headers"
  | "inspector"
  | "ua"
  | "viewport";

export interface AppSettings {
  theme: ThemeMode;
  userAgent: string | null;
  searchEngine: SearchEngine;
  customSearchUrl: string;
  tabBarPosition: TabBarPosition;
  homePage: string;
  /** Port scan interval in seconds (5..60, default 10) */
  portScanInterval: number;
  customPorts: number[];
  compactMode: boolean;
  /** Bookmark bar strip under the toolbar. Off by default. */
  bookmarkBarVisible: boolean;
  /** Soft limit on concurrent webview processes (default 10). Oldest background tab is discarded when exceeded. */
  maxConcurrentWebviews: number;
}

// ─── Bookmarks ────────────────────────────────────────────────────

export interface Bookmark {
  id: string;
  workspaceId: string;
  url: string;
  title: string;
  createdAt: number;
  /** null = root level; root-level bookmarks are the ones the bar shows. */
  folderId: string | null;
}

export interface BookmarkFolder {
  id: string;
  workspaceId: string;
  name: string;
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

export type OverlayPanelId = "none" | "api-tester";

// ─── History ──────────────────────────────────────────────────────

export interface HistoryEntry {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  timestamp: number;
  workspaceId: string;
}

// ─── Inspector ────────────────────────────────────────────────

interface MetaTag {
  name: string;
  content: string;
  charset: string | null;
  httpEquiv: string | null;
}

export interface MetaInfo {
  metas: MetaTag[];
  title: string;
  canonical: string | null;
  url: string;
  ldJson?: Record<string, unknown>[];
}

export interface CookieEntry {
  name: string;
  value: string;
  /** Read via the native WebView2 cookie manager, so HttpOnly cookies are
   *  included and domain/path are exact (needed to delete precisely). */
  domain: string;
  path: string;
  /** Seconds since epoch; -1 for session cookies. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite: string;
}

export interface StorageEntry {
  key: string;
  value: string;
}
