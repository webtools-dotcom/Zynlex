import { useState, useEffect, useCallback, useRef, Suspense, lazy } from "react";
import {
  Server, Bookmark, Clock, Activity, Code2, KeyRound, Binary,
  FlaskConical, RefreshCw, Globe, Monitor, Shield, Download,
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
const JwtDecoder = lazy(() => import("@/components/panels/JwtDecoder").then(m => ({ default: m.JwtDecoder })));
const Base64Tool = lazy(() => import("@/components/panels/Base64Tool").then(m => ({ default: m.Base64Tool })));
const InspectorPanel = lazy(() => import("@/components/panels/InspectorPanel").then(m => ({ default: m.InspectorPanel })));
const UserAgentPanel = lazy(() => import("@/components/panels/UserAgentPanel").then(m => ({ default: m.UserAgentPanel })));
const HeadersPanel = lazy(() => import("@/components/panels/HeadersPanel").then(m => ({ default: m.HeadersPanel })));
const DownloadsPanel = lazy(() => import("@/components/sidebar/DownloadsPanel").then(m => ({ default: m.DownloadsPanel })));
const PANELS: { id: PanelId; Icon: React.ElementType; label: string }[] = [
  { id: "servers",    Icon: Server,       label: "Live Servers" },
  { id: "network",    Icon: Activity,     label: "Network" },
  { id: "inspector",  Icon: FlaskConical, label: "Inspector" },
  { id: "api",        Icon: Code2,        label: "API Tester" },
  { id: "headers",    Icon: Shield,       label: "Header Injection" },
  { id: "jwt",        Icon: KeyRound,     label: "JWT Decoder" },
  { id: "base64",     Icon: Binary,       label: "Base64" },
  { id: "ua",         Icon: Globe,        label: "User Agent" },
  { id: "viewport",   Icon: Monitor,      label: "Viewports" },
  { id: "bookmarks",  Icon: Bookmark,     label: "Bookmarks" },
  { id: "history",    Icon: Clock,        label: "History" },
  { id: "downloads",  Icon: Download,     label: "Downloads" },
];

function LiveServersPanel() {
  const { servers, isScanning, lastScanAt } = useServersStore();
  const addTab = useTabsStore((s) => s.addTab);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const addTabToWorkspace = useWorkspacesStore((s) => s.addTabToWorkspace);
  const setActiveTab = useWorkspacesStore((s) => s.setActiveTab);
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
        <p className="text-micro font-medium tracking-[0.08em] text-[var(--color-text-muted)] uppercase">
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
            <span className="text-micro text-[var(--color-text-disabled)] animate-pulse">
              scanning…
            </span>
          )}
          {!isScanning && lastScanAt && (
            <span className="text-micro text-[var(--color-text-disabled)]">
              {Math.round((Date.now() - lastScanAt) / 1000)}s ago
            </span>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-sm text-[var(--color-text-muted)]">
            {isScanning ? "Scanning ports..." : "No servers detected"}
          </p>
          {!isScanning && (
            <p className="text-xs text-[var(--color-text-disabled)] mt-1">
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
              <span className="text-sm font-[var(--font-mono)] font-medium text-[var(--color-text-muted)] group-hover:text-[var(--color-text-primary)] transition-colors tabular-nums">
                :{server.port}
              </span>
              {(server.label || server.title) && (
                <span className="text-xs text-[var(--color-text-disabled)] ml-1.5 truncate">
                  {server.label ?? server.title}
                </span>
              )}
            </span>

            {server.protocol === "https" && (
              <span className="text-micro opacity-60 flex-shrink-0" style={{ color: "var(--color-live)" }}>
                https
              </span>
            )}

            {server.isPinned && (
              <span className="text-micro opacity-60 flex-shrink-0" style={{ color: "var(--color-accent)" }}>
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
    <div className="animate-pulse p-4 space-y-3 xevo-panel-enter">
      <div className="h-4 bg-[var(--color-hover)] rounded w-1/3" />
      <div className="h-4 bg-[var(--color-hover)] rounded w-2/3" />
      <div className="h-4 bg-[var(--color-hover)] rounded w-1/2" />
    </div>
  );
}

export function Sidebar() {
  // Atomic selectors, not a whole-store destructure: this component re-renders
  // on every mousemove while the sidebar is being dragged (setSidebarWidth
  // writes sidebarWidth on each move), so any unrelated ui-store field change
  // used to cost a re-render here too.
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const activePanel = useUIStore((s) => s.activePanel);
  const togglePanel = useUIStore((s) => s.togglePanel);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const workspaces = useWorkspacesStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const tabs = useTabsStore((s) => s.tabs);

  const ws = workspaces[activeWorkspaceId];
  const activeTabId = getLiveWorkspaceActiveTabId(ws, tabs);
  const wsName = ws?.name ?? "Workspace";

  const [resizing, setResizing] = useState(false);
  const dragStartRef = useRef({ x: 0, width: 0 });

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStartRef.current = { x: e.clientX, width: sidebarWidth };
      setResizing(true);
    },
    [sidebarWidth]
  );

  useEffect(() => {
    if (!resizing) return;
    document.body.style.cursor = "col-resize";
    const handleMouseMove = (e: MouseEvent) => {
      const { x, width } = dragStartRef.current;
      setSidebarWidth(width + (e.clientX - x));
    };
    const handleMouseUp = () => setResizing(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.body.style.cursor = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizing, setSidebarWidth]);

  return (
    <div
      className="relative flex flex-col flex-shrink-0 border-r overflow-hidden"
      style={{
        // No width transition: the webview has no equivalent animation and only
        // syncs bounds once the width settles, so an animated sidebar visibly slid
        // while the page snapped at the end. Snapping both together reads as more
        // solid than animating one side of a two-part layout.
        width: sidebarOpen ? sidebarWidth : 0,
        background: "var(--color-surface)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header */}
      <div
        className="px-3 h-[32px] flex items-center border-b flex-shrink-0"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <span className="text-micro font-medium tracking-[0.08em] text-[var(--color-text-muted)] uppercase">
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
      <div key={activePanel} className="flex-1 overflow-y-auto xevo-panel-enter">
        <Suspense fallback={<PanelSkeleton />}>
          {activePanel === "servers" && <LiveServersPanel />}
          {activePanel === "bookmarks" && <BookmarksPanel />}
          {activePanel === "history" && <HistoryPanel />}
          {activePanel === "downloads" && <DownloadsPanel />}
          {activePanel === "network" && <NetworkPanel key={activeTabId ?? "none"} />}
          {activePanel === "inspector" && <InspectorPanel />}
          {activePanel === "api" && <ApiTesterPanel />}
          {activePanel === "jwt" && <JwtDecoder />}
          {activePanel === "base64" && <Base64Tool />}
          {activePanel === "ua" && <UserAgentPanel />}
          {activePanel === "headers" && <HeadersPanel />}
          {activePanel === "viewport" && <ViewportControlsPanel />}
        </Suspense>
      </div>

      {/* Resize handle */}
      {sidebarOpen && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          tabIndex={0}
          onMouseDown={handleDragStart}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setSidebarWidth(sidebarWidth - 16);
            else if (e.key === "ArrowRight") setSidebarWidth(sidebarWidth + 16);
            else return;
            e.preventDefault();
          }}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--color-accent-dim)] focus:bg-[var(--color-accent-dim)] outline-none"
        />
      )}
    </div>
  );
}
