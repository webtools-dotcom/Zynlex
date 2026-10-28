/**
 * Environment switching for the active tab — shared by the toolbar pill, the
 * Ctrl+K palette and the Alt+Shift+1..4 commands.
 */
import { type Environment, matchEnv, translate } from "@/lib/envSwitch";
import { openTab } from "@/lib/tabActions";
import { getActiveTabId, getActiveWorkspaceId } from "@/hooks/useActiveScope";
import { useEnvironmentsStore } from "@/stores/environments";
import { useTabsStore } from "@/stores/tabs";

/** Asks RootLayout, which owns the webview bridge, to load a URL in the active tab. */
export const NAVIGATE_EVENT = "zynlex:navigate";

export function workspaceEnvs(wsId = getActiveWorkspaceId()): Environment[] {
  return useEnvironmentsStore.getState().rulesByWs[wsId] ?? [];
}

function activeUrl(): string | null {
  const tabId = getActiveTabId();
  return (tabId && useTabsStore.getState().tabs[tabId]?.url) || null;
}

/** The environment the active tab is on, or null. */
export function activeEnv(): Environment | null {
  const url = activeUrl();
  return url ? matchEnv(url, workspaceEnvs()) : null;
}

/** Opens the active tab's page on `to`. False if the tab isn't on a known environment. */
export function switchEnv(to: Environment, { newTab = false } = {}): boolean {
  const url = activeUrl();
  if (!url || !matchEnv(url, workspaceEnvs())) return false;
  const target = translate(url, to);
  if (newTab) openTab({ url: target });
  else window.dispatchEvent(new CustomEvent(NAVIGATE_EVENT, { detail: target }));
  return true;
}
