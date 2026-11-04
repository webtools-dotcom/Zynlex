import { isLoopbackUrl, originOf } from "@/lib/url";
import { toggleRecording } from "@/lib/recorder";
import { useRecordingStore } from "@/stores/recording";
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

/**
 * Shown while an AI agent is connected over MCP, with Stop; or, after Stop,
 * a way to turn agent access back on. Hidden otherwise.
 */
function AgentIndicator() {
  const { enabled, clients } = useAgentStore();
  if (enabled && !clients.length) return null;
  const toggle = () => setAgentEnabled(!enabled).catch(() => {});
  return (
    <span className="flex items-center gap-2">
      {enabled ? (
        <span
          style={{ color: "var(--color-accent)" }}
          title="An AI agent can read your localhost tabs"
        >
          ● Agent: {clients.join(", ")}
        </span>
      ) : (
        <span style={{ color: "var(--color-text-muted)" }}>Agent access off</span>
      )}
      <button
        type="button"
        onClick={toggle}
        className="hover:underline"
        style={{ color: "var(--color-text-muted)" }}
        title={enabled ? "Disconnect agents and refuse new calls" : "Let agents connect again"}
      >
        {enabled ? "Stop" : "Turn on"}
      </button>
    </span>
  );
}

/**
 * Recording the developer's steps for an agent: while on, the step count and
 * Stop; otherwise Record, offered on a localhost tab while an agent is
 * connected (the palette command works any time).
 */
function RecordControl({ tabId, url }: { tabId: string | null; url: string }) {
  const { active, rec } = useRecordingStore();
  const connected = useAgentStore((s) => s.enabled && s.clients.length > 0);
  if (active && rec) {
    const n = rec.steps.length;
    return (
      <span className="flex items-center gap-2">
        <span
          style={{ color: "var(--color-accent)" }}
          title="Your clicks and typing in this tab are being recorded for an agent; password values never are"
        >
          ● Recording {n} step{n === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          onClick={() => void toggleRecording(rec.tabId)}
          className="hover:underline"
          style={{ color: "var(--color-text-muted)" }}
          title="Stop recording; an agent can then read the steps"
        >
          Stop
        </button>
      </span>
    );
  }
  if (!connected || !tabId || !isLoopbackUrl(url)) return null;
  return (
    <button
      type="button"
      onClick={() => void toggleRecording(tabId)}
      className="hover:underline"
      style={{ color: "var(--color-text-muted)" }}
      title="Record your clicks and typing in this tab for the agent"
    >
      Record
    </button>
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
      <RecordControl tabId={tabId} url={url} />
      <div className="flex-1" />
      <Toast />
      {zoom !== 1 && (
        <span style={{ color: "var(--color-text-muted)" }}>{Math.round(zoom * 100)}%</span>
      )}
      {origin && <span style={{ color: "var(--color-text-disabled)" }}>{origin}</span>}
    </div>
  );
}
