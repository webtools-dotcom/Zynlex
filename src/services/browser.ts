/**
 * XEVO Browser IPC Service — all calls to Rust backend for browser control.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScannedPort {
  port: number;
  alive: boolean;
  protocol: string;
  title: string | null;
  status: number | null;
}

export interface TabInfo {
  title: string;
  url: string;
  favicon: string | null;
}

export interface FindResult {
  active_match: number;
  total_matches: number;
  final_update: boolean;
}

export async function navigateWebview(
  url: string,
  bounds: BrowserBounds
): Promise<void> {
  await invoke<void>("browser_navigate", {
    url,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
}

export async function setWebviewBounds(bounds: BrowserBounds): Promise<void> {
  await invoke<void>("browser_set_bounds", {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
}

export async function showWebview(bounds: BrowserBounds): Promise<void> {
  await invoke<void>("browser_show", {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
}

export async function hideWebview(): Promise<void> {
  await invoke<void>("browser_hide");
}

export async function webviewGoBack(): Promise<void> {
  await invoke<void>("browser_go_back");
}

export async function webviewGoForward(): Promise<void> {
  await invoke<void>("browser_go_forward");
}

export async function webviewReload(): Promise<void> {
  await invoke<void>("browser_reload");
}

export async function closeWebview(): Promise<void> {
  await invoke<void>("browser_close");
}

export async function stopLoading(): Promise<void> {
  await invoke<void>("browser_stop_loading");
}

export async function repositionWebview(
  x: number,
  y: number,
  width: number,
  height: number
): Promise<void> {
  await invoke<void>("browser_reposition", { x, y, width, height });
}

export async function setWebviewTheme(theme: "light" | "dark"): Promise<void> {
  await invoke<void>("browser_set_theme", { theme });
}

export async function scanPorts(ports: number[]): Promise<ScannedPort[]> {
  return await invoke<ScannedPort[]>("scan_ports", { ports });
}

export function onUrlChanged(
  callback: (url: string) => void
): Promise<UnlistenFn> {
  return listen<string>("browser://url-changed", (e) => callback(e.payload));
}

export function onLoadingChanged(
  callback: (loading: boolean) => void
): Promise<UnlistenFn> {
  return listen<boolean>("browser://loading", (e) => callback(e.payload));
}

export function onTabInfoChanged(
  callback: (info: TabInfo) => void
): Promise<UnlistenFn> {
  return listen<TabInfo>("browser://tab-info", (e) => callback(e.payload));
}

export async function webviewFind(
  query: string,
  forward: boolean = true
): Promise<void> {
  await invoke<void>("browser_find", { query, forward });
}

export async function webviewFindNext(forward: boolean = true): Promise<void> {
  await invoke<void>("browser_find_next", { forward });
}

export async function webviewStopFind(): Promise<void> {
  await invoke<void>("browser_stop_find");
}

export function onFindResult(
  callback: (result: FindResult) => void
): Promise<UnlistenFn> {
  return listen<FindResult>("browser://find-result", (e) => callback(e.payload));
}

// Fired by the XEVO_BOOKMARK_SCRIPT-injected keydown listener in the
// webview (Rust emits this from the browser_bookmark_request command).
// useWebviewBridge subscribes to this and routes it to
// toggleBookmarkForActiveTab() in src/lib/bookmarkAction.ts.
export function onBookmarkRequest(
  callback: () => void
): Promise<UnlistenFn> {
  return listen("browser://bookmark-request", () => callback());
}
