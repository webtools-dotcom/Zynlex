import {
  Server, Bookmark, Clock, Network, Code2, FileText, KeyRound, Binary,
  Shield, FlaskConical, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useServersStore } from "@/stores/servers";
import { useTabsStore } from "@/stores/tabs";
import { usePortScanner } from "@/hooks/usePortScanner";
import { BookmarksPanel } from "@/components/sidebar/BookmarksPanel";
import { ApiTesterPanel } from "@/components/sidebar/ApiTesterPanel";
import { HistoryPanel } from "@/components/sidebar/HistoryPanel";
import { NotesSidebarPanel } from "@/components/sidebar/NotesSidebarPanel";
import { JwtDecoder } from "@/components/panels/JwtDecoder";
import { Base64Tool } from "@/components/panels/Base64Tool";
import { NetworkPanel } from "@/components/panels/NetworkPanel";
import { HeadersPanel } from "@/components/panels/HeadersPanel";
import { InspectorPanel } from "@/components/panels/InspectorPanel";
import type { PanelId } from "@/types";

const PANELS: { id: PanelId; Icon: React.ElementType; label: string }[] = [
  { id: "servers",    Icon: Server,       label: "Live Servers" },
  { id: "bookmarks",  Icon: Bookmark,     label: "Bookmarks" },
  { id: "history",    Icon: Clock,        label: "History" },
  { id: "network",    Icon: Network,      label: "Network Log" },
  { id: "headers",    Icon: Shield,       label: "Header Injection" },
  { id: "inspector",  Icon: FlaskConical, label: "Inspector" },
  { id: "api",        Icon: Code2,        label: "API Tester" },
  { id: "notes",      Icon: FileText,     label: "Notes" },
  { id: "jwt",        Icon: KeyRound,     label: "JWT Decoder" },
  { id: "base64",     Icon: Binary,       label: "Base64" },
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
    <div className="p-2">
      <div className="flex items-center justify-between px-1 mb-2">
        <p className="text-[10px] font-medium tracking-[0.08em] text-[var(--color-text-muted)] uppercase">
          Live Servers
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => scan()}
            disabled={isScanning}
            title="Rescan ports"
            className={cn(
              "w-5 h-5 flex items-center justify-center rounded-[3px] transition-colors",
              isScanning
                ? "text-[var(--color-text-disabled)] cursor-not-allowed"
                : "text-[var(--color-text-disabled)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] cursor-pointer",
            )}
          >
            <RefreshCw size={11} className={isScanning ? "animate-spin" : ""} />
          </button>
          {isScanning && (
            <span className="text-[9px] text-[var(--color-text-disabled)] animate-pulse">
              scanning…
            </span>
          )}
          {!isScanning && lastScanAt && (
            <span className="text-[9px] text-[var(--color-text-disabled)]">
              {Math.round((Date.now() - lastScanAt) / 1000)}s ago
            </span>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-[12px] text-[var(--color-text-muted)]">
            {isScanning ? "Scanning ports..." : "No servers detected"}
          </p>
          {!isScanning && (
            <p className="text-[11px] text-[var(--color-text-disabled)] mt-1">
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
            className="w-full flex items-center gap-2 px-3 h-7 rounded-[4px] text-left group hover:bg-[var(--color-hover)] transition-colors mb-0.5 cursor-pointer"
          >
            {/* Liveness dot — the signature */}
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
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
              <span className="text-[12px] font-[var(--font-mono)] font-medium text-[var(--color-text-muted)] group-hover:text-[var(--color-text-primary)] transition-colors tabular-nums">
                :{server.port}
              </span>
              {(server.label || server.title) && (
                <span className="text-[11px] text-[var(--color-text-disabled)] ml-1.5 truncate">
                  {server.label ?? server.title}
                </span>
              )}
            </span>

            {server.protocol === "https" && (
              <span className="text-[9px] opacity-60 flex-shrink-0" style={{ color: "var(--color-live)" }}>
                https
              </span>
            )}

            {server.isPinned && (
              <span className="text-[9px] opacity-60 flex-shrink-0" style={{ color: "var(--color-accent)" }}>
                •
              </span>
            )}
          </button>
        ))
      )}
    </div>
  );
}

export function Sidebar() {
  const { sidebarOpen, sidebarWidth, activePanel, togglePanel } = useUIStore();
  const { workspaces, activeWorkspaceId } = useWorkspacesStore();

  const wsName = workspaces[activeWorkspaceId]?.name ?? "Workspace";

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
        className="px-3 h-[28px] flex items-center border-b flex-shrink-0"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <span className="text-[10px] font-medium tracking-[0.08em] text-[var(--color-text-muted)] uppercase">
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
              "w-8 h-8 rounded-[4px] flex items-center justify-center flex-shrink-0 transition-colors",
              activePanel === id
                ? "bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                : "text-[var(--color-text-disabled)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]",
            )}
          >
            <Icon size={14} strokeWidth={1.5} />
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto">
        {activePanel === "servers" && <LiveServersPanel />}
        {activePanel === "bookmarks" && <BookmarksPanel />}
        {activePanel === "history" && <HistoryPanel />}
        {activePanel === "network" && <NetworkPanel />}
        {activePanel === "headers" && <HeadersPanel />}
        {activePanel === "inspector" && <InspectorPanel />}
        {activePanel === "api" && <ApiTesterPanel />}
        {activePanel === "notes" && <NotesSidebarPanel />}
        {activePanel === "jwt" && <JwtDecoder />}
        {activePanel === "base64" && <Base64Tool />}
      </div>
    </div>
  );
}
