import { useEffect, useState } from "react";
import { toggleAgentPause } from "@/lib/agentPause";
import { originOf } from "@/lib/url";
import { useConsoleStore } from "@/stores/console";
import { useUIStore } from "@/stores/ui";
import { useAgentStore } from "@/stores/agent";
import { setAgentEnabled } from "@/services/browser";
import { Toast } from "@/components/Toast";

/** The active page's console counts; clicking opens the Console panel. */
function ConsoleCounts({ tabId }: { tabId: string | null }) {
  const c = useConsoleStore((s) => (tabId ? s.countsByTab[tabId] : undefined));
  if (!c || c.errors + c.warnings + c.failed === 0) return null;
  const items: [number, string, string][] = [
    [c.errors, c.errors === 1 ? "error" : "errors", "var(--color-console-error)"],
    [c.failed, "failed", "var(--color-console-error)"],
    [c.warnings, c.warnings === 1 ? "warning" : "warnings", "var(--color-console-warn)"],
  ];
  return (
    <button
      type="button"
      onClick={() => {
        useUIStore.getState().setActivePanel("console");
        useUIStore.getState().setSidebarOpen(true);
      }}
      title="Open Console"
      className="flex items-center gap-2 hover:underline"
    >
      {items
        .filter(([n]) => n > 0)
        .map(([n, label, color]) => (
          <span key={label} style={{ color }}>
            {n} {label}
          </span>
        ))}
    </button>
  );
}

/** Seconds since `since`, ticking once a second while mounted. */
function useSecondsSince(since: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.round((now - since) / 1000));
}

function PausedFor({ since, waiting }: { since: number; waiting: number }) {
  const secs = useSecondsSince(since);
  return (
    <span
      style={{ color: "var(--color-text-secondary)" }}
      title="The agent's page actions wait until you press Resume; reads still answer"
    >
      ❚❚ Agent paused {secs} s{waiting ? ` · ${waiting} waiting` : ""}
    </span>
  );
}

const linkStyle = { color: "var(--color-text-muted)" };

/**
 * Shown while an AI agent is connected over MCP, with Pause/Resume (take
 * over) and Stop; or, after Stop, a way to turn agent access back on. Hidden
 * otherwise. The name opens the Agent Activity panel: nothing may float over
 * the tab, so the list lives in the sidebar, not a popover.
 */
function AgentIndicator() {
  const { enabled, clients, pausedAt, waiting } = useAgentStore();
  if (enabled && !clients.length) return null;
  const toggle = () => setAgentEnabled(!enabled).catch(() => {});
  const openActivity = () => {
    useUIStore.getState().setActivePanel("agent");
    useUIStore.getState().setSidebarOpen(true);
  };
  return (
    <span className="flex items-center gap-2">
      {!enabled ? (
        <span style={{ color: "var(--color-text-muted)" }}>Agent access off</span>
      ) : pausedAt != null ? (
        <PausedFor since={pausedAt} waiting={waiting} />
      ) : (
        <button
          type="button"
          onClick={openActivity}
          className="hover:underline"
          style={{ color: "var(--color-accent)" }}
          title="An AI agent can read your localhost tabs. Show what it did."
        >
          ● Agent: {clients.join(", ")}
        </button>
      )}
      {enabled && (
        <button
          type="button"
          onClick={toggleAgentPause}
          className="hover:underline"
          style={pausedAt != null ? { color: "var(--color-accent)" } : linkStyle}
          title={
            pausedAt != null
              ? "Let the agent carry on; its waiting call runs and is told what changed"
              : "Take over: the agent's page actions wait while you use the page"
          }
        >
          {pausedAt != null ? "Resume" : "Pause"}
        </button>
      )}
      <button
        type="button"
        onClick={toggle}
        className="hover:underline"
        style={linkStyle}
        title={enabled ? "Disconnect agents and refuse new calls" : "Let agents connect again"}
      >
        {enabled ? "Stop" : "Turn on"}
      </button>
    </span>
  );
}

interface StatusBarProps {
  isLoading: boolean;
  loadTime: number | null;
  url: string;
  hoveredUrl: string | null;
  zoom: number;
  tabId: string | null;
}

export function StatusBar({ isLoading, loadTime, url, hoveredUrl, zoom, tabId }: StatusBarProps) {
  const origin = url ? originOf(url) : "";

  let leftContent: React.ReactNode = null;
  if (hoveredUrl) {
    const display = hoveredUrl.length > 60 ? hoveredUrl.slice(0, 60) + "…" : hoveredUrl;
    leftContent = <span style={{ color: "var(--color-text-muted)" }}>{display}</span>;
  } else if (isLoading) {
    leftContent = (
      <span className="animate-pulse" style={{ color: "var(--color-accent)" }}>
        Loading…
      </span>
    );
  } else if (loadTime !== null) {
    leftContent = (
      <span>
        <span style={{ color: "var(--color-text-muted)", fontFeatureSettings: '"tnum" 1' }}>
          {loadTime}
        </span>
        <span style={{ color: "var(--color-text-disabled)" }}> ms</span>
      </span>
    );
  }

  return (
    <div
      className="flex items-center h-7 px-3 gap-4 shrink-0"
      style={{
        background: "var(--color-base)",
        borderTop: "1px solid var(--color-border)",
        color: "var(--color-text-disabled)",
        fontSize: "11px",
      }}
    >
      {leftContent}
      <ConsoleCounts tabId={tabId} />
      <AgentIndicator />
      <div className="flex-1" />
      <Toast />
      {zoom !== 1 && (
        <span style={{ color: "var(--color-text-muted)" }}>{Math.round(zoom * 100)}%</span>
      )}
      {origin && <span style={{ color: "var(--color-text-disabled)" }}>{origin}</span>}
    </div>
  );
}
