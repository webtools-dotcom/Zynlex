import { useState, useEffect, Suspense, lazy } from "react";
import {
  Server, Bookmark, Clock, Activity, Code2, FileText, KeyRound, Binary,
  Shield, FlaskConical, RefreshCw, Globe, Monitor,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useServersStore } from "@/stores/servers";
import { useTabsStore } from "@/stores/tabs";
import { usePortScanner } from "@/hooks/usePortScanner";
import { ViewportControlsPanel } from "@/components/panels/ViewportPanel";
import { getLiveWorkspaceActiveTabId } from "@/lib/workspaceTabs";
import type { PanelId } from "@/types";

const BookmarksPanel = lazy(() => import("@/components/sidebar/BookmarksPanel"));
const ApiTesterPanel = lazy(() => import("@/components/sidebar/ApiTesterPanel"));
const HistoryPanel = lazy(() => import("@/components/sidebar/HistoryPanel").then(m => ({ default: m.HistoryPanel })));
const NetworkPanel = lazy(() => import("@/components/panels/NetworkPanel").then(m => ({ default: m.NetworkPanel })));
const NotesSidebarPanel = lazy(() => import("@/components/sidebar/NotesSidebarPanel").then(m => ({ default: m.NotesSidebarPanel })));
const JwtDecoder = lazy(() => import("@/components/panels/JwtDecoder").then(m => ({ default: m.JwtDecoder })));
const Base64Tool = lazy(() => import("@/components/panels/Base64Tool").then(m => ({ default: m.Base64Tool })));
const HeadersPanel = lazy(() => import("@/components/panels/HeadersPanel").then(m => ({ default: m.HeadersPanel })));
const InspectorPanel = lazy(() => import("@/components/panels/InspectorPanel").then(m => ({ default: m.InspectorPanel })));
const UserAgentPanel = lazy(() => import("@/components/panels/UserAgentPanel").then(m => ({ default: m.UserAgentPanel })));
const PANELS: { id: PanelId; Icon: React.ElementType; label: string }[] = [
  { id: "servers",    Icon: Server,       label: "Live Servers" },
  { id: "bookmarks",  Icon: Bookmark,     label: "Bookmarks" },
  { id: "history",    Icon: Clock,        label: "History" },
  { id: "network",    Icon: Activity,     label: "Network" },
  { id: "headers",    Icon: Shield,       label: "Header Injection" },
  { id: "inspector",  Icon: FlaskConical, label: "Inspector" },
  { id: "api",        Icon: Code2,        label: "API Tester" },
  { id: "notes",      Icon: FileText,     label: "Notes" },
  { id: "jwt",        Icon: KeyRound,     label: "JWT Decoder" },
  { id: "base64",     Icon: Binary,       label: "Base64" },
  { id: "ua",         Icon: Globe,        label: "User Agent" },
  { id: "viewport",   Icon: Monitor,      label: "Viewports" },
];

function LiveServersPanel() {
  const { servers, isScanning, lastScanAt } = useServersStore();
  const { addTab } = useTabsStore();
  const {
    activeWorkspaceId,
    addTabToWorkspace,
    setActiveTab,
  } = useWorkspacesStore();
  const { scan } = usePortScanner();
  const [, setTick] = useState(0);

  // Force re-render every 30s so "Xs ago" timestamps stay current
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const sorted = [...servers].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1;
    return a.port - b.port;
  });

  const visible = sorted.filter(
    (s) =>
      s.isPinned ||
      s.isAlive ||
      (s.lastSeen && Date.now() - s.lastSeen < 60 * 60 * 1000)
  );

  function openServer(server: typeof servers[number]) {
    const url = `${server.protocol}://localhost:${server.port}`;
    const id = addTab(activeWorkspaceId, {
      url,
      title: server.label ?? server.title ?? `localhost:${server.port}`,
    });
    addTabToWorkspace(activeWorkspaceId, id);
    setActiveTab(activeWorkspaceId, id);
  }

  return (
    <div className="p-2.5">
      <div className="flex items-center justify-between px-1 mb-2">
        <p className="text-[11px] font-medium tracking-[0.08em] text-[var(--color-text-muted)] uppercase">
          Live Servers
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => scan()}
            disabled={isScanning}
            title="Rescan ports"
            className={cn(
              "w-6 h-6 flex items-center justify-center rounded-[3px] transition-colors",
              isScanning
                ? "text-[var(--color-text-disabled)] cursor-not-allowed"
                : "text-[var(--color-text-disabled)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] cursor-pointer",
            )}
          >
            <RefreshCw size={12} className={isScanning ? "animate-spin" : ""} />
          </button>
          {isScanning && (
            <span className="text-[11px] text-[var(--color-text-disabled)] animate-pulse">
              scanning…
            </span>
          )}
          {!isScanning && lastScanAt && (
            <span className="text-[11px] text-[var(--color-text-disabled)]">
              {Math.round((Date.now() - lastScanAt) / 1000)}s ago
            </span>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-[13px] text-[var(--color-text-muted)]">
            {isScanning ? "Scanning ports..." : "No servers detected"}
          </p>
          {!isScanning && (
            <p className="text-[12px] text-[var(--color-text-disabled)] mt-1">
              Start a dev server on localhost
            </p>
          )}
        </div>
      ) : (
        visible.map((server) => (
          <button
            key={server.port}
            onClick={() => openServer(server)}
            title={`Open ${server.protocol}://localhost:${server.port}`}
            className="w-full flex items-center gap-2 px-3 h-8 rounded-[4px] text-left group hover:bg-[var(--color-hover)] transition-colors mb-0.5 cursor-pointer"
          >
            {/* Liveness dot — the signature */}
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: server.isAlive
                  ? "var(--color-live)"
                  : "var(--color-text-disabled)",
                boxShadow: server.isAlive
                  ? "0 0 6px var(--color-live-glow)"
                  : "none",
                animation: server.isAlive ? "live-pulse 3s infinite" : "none",
              }}
            />

            {/* Port + label */}
            <span className="flex-1 min-w-0">
              <span className="text-[13px] font-[var(--font-mono)] font-medium text-[var(--color-text-muted)] group-hover:text-[var(--color-text-primary)] transition-colors tabular-nums">
                :{server.port}
              </span>
              {(server.label || server.title) && (
                <span className="text-[12px] text-[var(--color-text-disabled)] ml-1.5 truncate">
                  {server.label ?? server.title}
                </span>
              )}
            </span>

            {server.protocol === "https" && (
              <span className="text-[11px] opacity-60 flex-shrink-0" style={{ color: "var(--color-live)" }}>
                https
              </span>
            )}

            {server.isPinned && (
              <span className="text-[11px] opacity-60 flex-shrink-0" style={{ color: "var(--color-accent)" }}>
                •
              </span>
            )}
          </button>
        ))
      )}
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="animate-pulse p-4 space-y-3">
      <div className="h-4 bg-[var(--color-hover)] rounded w-1/3" />
      <div className="h-4 bg-[var(--color-hover)] rounded w-2/3" />
      <div className="h-4 bg-[var(--color-hover)] rounded w-1/2" />
    </div>
  );
}

export function Sidebar() {
  const { sidebarOpen, sidebarWidth, activePanel, togglePanel } = useUIStore();
  const { workspaces, activeWorkspaceId } = useWorkspacesStore();
  const tabs = useTabsStore((s) => s.tabs);

  const ws = workspaces[activeWorkspaceId];
  const activeTabId = getLiveWorkspaceActiveTabId(ws, tabs);
  const wsName = ws?.name ?? "Workspace";

  return (
    <div
      className="flex flex-col flex-shrink-0 border-r overflow-hidden"
      style={{
        width: sidebarOpen ? sidebarWidth : 0,
        background: "var(--color-surface)",
        borderColor: "var(--color-border)",
        transition: "width 150ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {/* Header */}
      <div
        className="px-3 h-[32px] flex items-center border-b flex-shrink-0"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <span className="text-[11px] font-medium tracking-[0.08em] text-[var(--color-text-muted)] uppercase">
          {wsName}
        </span>
      </div>

      {/* Panel icon nav */}
      <div
        className="flex items-center gap-0.5 px-1.5 py-1 border-b flex-shrink-0 overflow-x-auto"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        {PANELS.map(({ id, Icon, label }) => (
          <button
            key={id}
            onClick={() => togglePanel(id)}
            title={label}
            aria-label={label}
            className={cn(
              "w-9 h-9 rounded-[4px] flex items-center justify-center flex-shrink-0 transition-colors",
              activePanel === id
                ? "bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                : "text-[var(--color-text-disabled)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]",
            )}
          >
            <Icon size={15} strokeWidth={1.5} />
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto">
        <Suspense fallback={<PanelSkeleton />}>
          {activePanel === "servers" && <LiveServersPanel />}
          {activePanel === "bookmarks" && <BookmarksPanel />}
          {activePanel === "history" && <HistoryPanel />}
          {activePanel === "network" && <NetworkPanel key={activeTabId ?? "none"} />}
          {activePanel === "headers" && <HeadersPanel />}
          {activePanel === "inspector" && <InspectorPanel />}
          {activePanel === "api" && <ApiTesterPanel />}
          {activePanel === "notes" && <NotesSidebarPanel />}
          {activePanel === "jwt" && <JwtDecoder />}
          {activePanel === "base64" && <Base64Tool />}
          {activePanel === "ua" && <UserAgentPanel />}
          {activePanel === "viewport" && <ViewportControlsPanel />}
        </Suspense>
      </div>
    </div>
  );
}
