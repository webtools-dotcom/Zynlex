/**
 * "Copy Bug Report": a Markdown summary of the active tab (URL, environment,
 * device, recent errors and failed requests) on the clipboard, plus a
 * screenshot saved to Downloads.
 */
import { getVersion } from "@tauri-apps/api/app";
import { getActiveTabId } from "@/hooks/useActiveScope";
import { activeEnv } from "@/lib/envActions";
import { isFailedRequest, useConsoleStore } from "@/stores/console";
import { useNetworkStore } from "@/stores/network";
import { useSettingsStore } from "@/stores/settings";
import { useTabsStore } from "@/stores/tabs";
import { isViewportMode, useUIStore } from "@/stores/ui";
import { captureScreenshot, copyText } from "@/services/browser";

/** Per section; the newest are the ones that matter. */
const RECENT = 20;

export interface BugReport {
  title: string;
  url: string;
  env: string | null;
  device: string | null;
  userAgent: string;
  zoom: number;
  version: string;
  time: Date;
  screenshot: string | null;
  errors: string[];
  failed: string[];
}

export function bugReportMarkdown(r: BugReport): string {
  const facts = [
    ["URL", r.url],
    ["Environment", r.env],
    ["Device", r.device],
    ["User agent", r.userAgent],
    ["Zoom", `${Math.round(r.zoom * 100)}%`],
    ["ZYNLEX", r.version],
    ["Time", r.time.toISOString()],
    ["Screenshot", r.screenshot && `\`${r.screenshot}\``],
  ].filter(([, v]) => v);
  const section = (name: string, lines: string[]) =>
    lines.length ? ["", `### ${name} (${lines.length})`, "```", ...lines, "```"] : [];
  return [
    `## Bug report: ${r.title}`,
    "",
    ...facts.map(([k, v]) => `- **${k}:** ${v}`),
    ...section("Errors", r.errors),
    ...section("Failed requests", r.failed),
    "",
  ].join("\n");
}

function gather(tabId: string): Omit<BugReport, "version" | "screenshot"> | null {
  const tab = useTabsStore.getState().tabs[tabId];
  if (!tab?.url) return null;

  const ui = useUIStore.getState();
  const vp = isViewportMode() ? ui.viewports.find((v) => v.id === ui.selectedViewportId) : null;
  const entries = useConsoleStore.getState().entriesByTab[tabId] ?? [];
  const line = (e: (typeof entries)[number]) =>
    `${e.text}${e.url ? ` (${e.url}${e.line != null ? `:${e.line}` : ""})` : ""}${e.count > 1 ? ` ×${e.count}` : ""}`;
  // The Network panel's rows carry method and status, but only exist while it's
  // been open; the console's network errors are always there.
  const netRows = (useNetworkStore.getState().entriesByTab[tabId] ?? [])
    .filter((n) => n.statusCode >= 400)
    .map((n) => `${n.method} ${n.statusCode} ${n.url}`);

  return {
    title: tab.title,
    url: tab.url,
    env: activeEnv()?.name ?? null,
    device: vp ? `${vp.label}, ${vp.width}×${vp.height} @${vp.deviceScaleFactor}x` : null,
    userAgent:
      vp?.userAgent || useSettingsStore.getState().settings.userAgent || navigator.userAgent,
    zoom: tab.zoom ?? 1,
    time: new Date(),
    errors: entries
      .filter((e) => e.level === "error" && !isFailedRequest(e))
      .slice(-RECENT)
      .map(line),
    failed: (netRows.length ? netRows : entries.filter(isFailedRequest).map(line)).slice(-RECENT),
  };
}

export function copyBugReport(): boolean {
  const tabId = getActiveTabId();
  const base = tabId && gather(tabId);
  if (!tabId || !base) return false;
  const toast = useUIStore.getState().pushToast;
  void (async () => {
    const [version, screenshot] = await Promise.all([
      getVersion().catch(() => "unknown"),
      captureScreenshot(tabId).catch(() => null),
    ]);
    try {
      await copyText(bugReportMarkdown({ ...base, version, screenshot }));
      toast(
        screenshot ? "Bug report copied, screenshot in Downloads" : "Bug report copied",
        "success",
      );
    } catch {
      toast("Couldn't copy the bug report", "danger");
    }
  })();
  return true;
}
