/**
 * XEVO Browser IPC Service — all calls to Rust backend for browser control.
 *
 * Per-tab architecture: each tab gets its own WebviewWindow.
 * Commands target specific tabs via tabId.
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
  tabId: string;
  title: string;
  url: string;
  favicon: string | null;
}

export interface FindResult {
  active_match: number;
  total_matches: number;
  final_update: boolean;
}

// ─── Per-tab commands ────────────────────────────────────────────────

export async function createTab(
  tabId: string,
  url: string,
  bounds: BrowserBounds
): Promise<void> {
  await invoke<void>("browser_create_tab", {
    tabId,
    url,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
}

export async function closeTabWebview(tabId: string): Promise<void> {
  await invoke<void>("browser_close_tab", { tabId });
}

export async function navigateTab(tabId: string, url: string): Promise<void> {
  await invoke<void>("browser_navigate_tab", { tabId, url });
}

// ─── Bounds ──────────────────────────────────────────────────────────

export async function setWebviewBounds(
  tabId: string,
  bounds: BrowserBounds
): Promise<void> {
  await invoke<void>("browser_set_bounds", {
    tabId,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
}

// ─── Navigation (per-tab) ────────────────────────────────────────────

export async function webviewGoBack(tabId: string): Promise<void> {
  await invoke<void>("browser_go_back", { tabId });
}

export async function webviewGoForward(tabId: string): Promise<void> {
  await invoke<void>("browser_go_forward", { tabId });
}

export async function webviewReload(tabId: string): Promise<void> {
  await invoke<void>("browser_reload", { tabId });
}

export async function stopLoading(tabId: string): Promise<void> {
  await invoke<void>("browser_stop_loading", { tabId });
}

// ─── Theme ───────────────────────────────────────────────────────────

export async function setWebviewTheme(theme: "light" | "dark"): Promise<void> {
  await invoke<void>("browser_set_theme", { theme });
}

// ─── Hide/Show (for overlays) ────────────────────────────────────────

export async function hideTabWebview(tabId: string): Promise<void> {
  await invoke<void>("browser_hide_tab", { tabId });
}

export async function showTabWebview(
  tabId: string,
  bounds: BrowserBounds
): Promise<void> {
  await invoke<void>("browser_show_tab", {
    tabId,
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
}

// ─── Find (per-tab) ──────────────────────────────────────────────────

export async function webviewFind(
  tabId: string,
  query: string,
  forward: boolean = true
): Promise<void> {
  await invoke<void>("browser_find", { tabId, query, forward });
}

export async function webviewFindNext(
  tabId: string,
  forward: boolean = true
): Promise<void> {
  await invoke<void>("browser_find_next", { tabId, forward });
}

export async function webviewStopFind(tabId: string): Promise<void> {
  await invoke<void>("browser_stop_find", { tabId });
}

// ─── Ports (non-tab) ─────────────────────────────────────────────────

export async function scanPorts(ports: number[]): Promise<ScannedPort[]> {
  return await invoke<ScannedPort[]>("scan_ports", { ports });
}

// ─── Events ──────────────────────────────────────────────────────────

export function onUrlChanged(
  callback: (tabId: string, url: string) => void
): Promise<UnlistenFn> {
  return listen<{ tabId: string; url: string }>(
    "browser://url-changed",
    (e) => callback(e.payload.tabId, e.payload.url)
  );
}

export function onLoadingChanged(
  callback: (tabId: string, loading: boolean) => void
): Promise<UnlistenFn> {
  return listen<{ tabId: string; loading: boolean }>(
    "browser://loading",
    (e) => callback(e.payload.tabId, e.payload.loading)
  );
}

export function onTabInfoChanged(
  callback: (tabId: string, info: TabInfo) => void
): Promise<UnlistenFn> {
  return listen<{ tabId: string; title: string; url: string; favicon: string | null }>(
    "browser://tab-info",
    (e) =>
      callback(e.payload.tabId, {
        tabId: e.payload.tabId,
        title: e.payload.title,
        url: e.payload.url,
        favicon: e.payload.favicon,
      })
  );
}

export function onFindResult(
  callback: (result: FindResult) => void
): Promise<UnlistenFn> {
  return listen<FindResult>("browser://find-result", (e) => callback(e.payload));
}

export function onBookmarkRequest(
  callback: () => void
): Promise<UnlistenFn> {
  return listen("browser://bookmark-request", () => callback());
}

export function onNewTabRequested(
  callback: (url: string) => void
): Promise<UnlistenFn> {
  return listen<{ url: string }>("browser://open-new-tab", (e) => callback(e.payload.url));
}

// ─── User Agent ─────────────────────────────────────────────────────

export async function setUserAgent(userAgent: string): Promise<void> {
  await invoke<void>("browser_set_user_agent", { userAgent });
  window.dispatchEvent(new CustomEvent("xevo:ua-changed"));
}

// ─── Memory Target ────────────────────────────────────────────────

export async function setMemoryTarget(tabId: string, low: boolean): Promise<void> {
  await invoke<void>("browser_set_memory_target", { tabId, low });
}

// ─── Tab State Save/Restore ──────────────────────────────────────

export async function saveTabState(tabId: string): Promise<void> {
  await invoke<void>("browser_save_tab_state", { tabId });
}

export async function restoreTabState(tabId: string, stateJson: string): Promise<void> {
  await invoke<void>("browser_restore_tab_state", { tabId, stateJson });
}

// ─── Inspector ────────────────────────────────────────────────────

export async function evalInspector(
  tabId: string,
  inspectorType: "meta" | "cookies" | "localStorage" | "sessionStorage"
): Promise<void> {
  await invoke<void>("browser_eval_inspector", { tabId, inspectorType });
}

export interface InspectorDataEvent {
  tabId: string;
  dataType: string;
  data: string;
}

export function onInspectorData(
  callback: (event: InspectorDataEvent) => void
): Promise<UnlistenFn> {
  return listen<InspectorDataEvent>("xevo://inspector-data", (e) =>
    callback(e.payload)
  );
}

export async function inspectorMutate(
  tabId: string,
  operation: string,
  params: Record<string, string>
): Promise<void> {
  await invoke<void>("inspector_mutate", { tabId, operation, params });
}

// ─── Multi-Viewport Mode ──────────────────────────────────────────

export async function createViewport(
  label: string,
  url: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  await invoke<void>("create_viewport", { label, url, x, y, width, height });
}

export async function destroyViewport(label: string): Promise<void> {
  await invoke<void>("destroy_viewport", { label });
}

export async function resizeViewport(
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<void> {
  await invoke<void>("resize_viewport", { label, x, y, width, height });
}

export async function showViewport(label: string): Promise<void> {
  await invoke<void>("show_viewport", { label });
}

export async function hideViewport(label: string): Promise<void> {
  await invoke<void>("hide_viewport", { label });
}

export async function scrollViewport(
  label: string,
  percentX: number,
  percentY: number,
): Promise<void> {
  await invoke<void>("scroll_viewport", { label, percentX, percentY });
}

export async function clickViewport(
  label: string,
  x: number,
  y: number,
): Promise<void> {
  await invoke<void>("click_viewport", { label, x, y });
}

export async function evalRaw(label: string, script: string): Promise<void> {
  await invoke<void>("browser_eval_raw", { label, script });
}

export interface ScreenshotResult {
  bytes: number[];
  path: string;
}

export async function takeScreenshot(): Promise<{ bytes: Uint8Array; path: string }> {
  const result = await invoke<ScreenshotResult>("browser_screenshot");
  return { bytes: new Uint8Array(result.bytes), path: result.path };
}

export interface NetworkEntryPayload {
  tabId: string;
  method: string;
  url: string;
  statusCode: number;
  reasonPhrase: string;
  resourceType: string;
  durationMs: number;
  contentLength: number;
  headers: Record<string, string>;
  body: string;
}

export function onNetworkEntry(
  callback: (payload: NetworkEntryPayload) => void,
): Promise<UnlistenFn> {
  return listen<NetworkEntryPayload>("browser://network-entry", (e) => callback(e.payload));
}

// ─── Header Injection ────────────────────────────────────────────────

export interface HeaderRulePayload {
  id: string;
  pattern: string;
  name: string;
  value: string;
  enabled: boolean;
}

export async function setHeaderRules(rules: HeaderRulePayload[]): Promise<void> {
  await invoke<void>("set_header_rules", { rules });
}

export async function getHeaderRules(): Promise<HeaderRulePayload[]> {
  return await invoke<HeaderRulePayload[]>("get_header_rules");
}

export function onViewportScroll(
  callback: (payload: { sourceLabel: string; percentX: number; percentY: number }) => void,
): Promise<UnlistenFn> {
  return listen<{ sourceLabel: string; percentX: number; percentY: number }>("viewport://scroll", (e) => callback(e.payload));
}

export function onViewportClick(
  callback: (payload: { sourceLabel: string; x: number; y: number }) => void,
): Promise<UnlistenFn> {
  return listen<{ sourceLabel: string; x: number; y: number }>("viewport://click", (e) => callback(e.payload));
}

export function onViewportInput(
  callback: (payload: { sourceLabel: string; selector: string; value: string; checked: boolean | null; inputType: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ sourceLabel: string; selector: string; value: string; checked: boolean | null; inputType: string }>("viewport://input", (e) => callback(e.payload));
}

