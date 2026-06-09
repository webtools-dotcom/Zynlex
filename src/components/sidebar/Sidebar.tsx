import {
  Server, Bookmark, Clock, Network, Code2, FileText, KeyRound, Binary,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useServersStore } from "@/stores/servers";
import { useTabsStore } from "@/stores/tabs";
import { BookmarksPanel } from "@/components/sidebar/BookmarksPanel";
import { ApiTesterPanel } from "@/components/sidebar/ApiTesterPanel";
import { HistoryPanel } from "@/components/sidebar/HistoryPanel";
import { NotesSidebarPanel } from "@/components/sidebar/NotesSidebarPanel";
import { JwtDecoder } from "@/components/panels/JwtDecoder";
import { Base64Tool } from "@/components/panels/Base64Tool";
import type { PanelId } from "@/types";

const PANELS: { id: PanelId; Icon: React.ElementType; label: string }[] = [
  { id: "servers",   Icon: Server,   label: "Live Servers" },
  { id: "bookmarks", Icon: Bookmark, label: "Bookmarks" },
  { id: "history",   Icon: Clock,    label: "History" },
  { id: "network",   Icon: Network,  label: "Network Log" },
  { id: "api",       Icon: Code2,    label: "API Tester" },
  { id: "notes",     Icon: FileText, label: "Notes" },
  { id: "jwt",       Icon: KeyRound, label: "JWT Decoder" },
  { id: "base64",    Icon: Binary,   label: "Base64" },
];

function LiveServersPanel() {
  const { servers, isScanning, lastScanAt } = useServersStore();
  const { addTab } = useTabsStore();
  const {
    activeWorkspaceId,
    addTabToWorkspace,
    setActiveTab,
  } = useWorkspacesStore();

  // Show pinned first, then alive, then recently-seen offline
  const sorted = [...servers].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1;
    return a.port - b.port;
  });

  // Only show: pinned + currently alive + servers seen in the last hour
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
      {/* Header row */}
      <div className="flex items-center justify-between px-1 mb-2">
        <p className="text-[10px] font-bold tracking-[0.09em] text-[var(--xevo-text-muted)] uppercase">
          Live Servers
        </p>
        {isScanning && (
          <span className="text-[9px] text-[var(--xevo-text-faint)] animate-pulse">
            scanning…
          </span>
        )}
        {!isScanning && lastScanAt && (
          <span className="text-[9px] text-[var(--xevo-text-faint)]">
            {Math.round((Date.now() - lastScanAt) / 1000)}s ago
          </span>
        )}
      </div>

      {/* Server list */}
      {visible.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-[12px] text-[var(--xevo-text-muted)]">
            {isScanning ? "Scanning ports..." : "No servers detected"}
          </p>
          {!isScanning && (
            <p className="text-[11px] text-[var(--xevo-text-faint)] mt-1">
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
            className="w-full flex items-center gap-2 px-3 h-8 rounded text-left group hover:bg-[rgba(255,255,255,0.04)] transition-colors mb-0.5 cursor-pointer"
          >
            {/* Status dot */}
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{
                backgroundColor: server.isAlive
                  ? "var(--xevo-success)"
                  : "var(--xevo-text-faint)",
              }}
            />

            {/* Port + label */}
            <span className="flex-1 min-w-0">
              <span className="text-[12px] font-mono font-medium text-[var(--xevo-text-muted)] group-hover:text-[var(--xevo-text)] transition-colors">
                :{server.port}
              </span>
              {(server.label || server.title) && (
                <span className="text-[11px] text-[var(--xevo-text-faint)] ml-1.5 truncate">
                  {server.label ?? server.title}
                </span>
              )}
            </span>

            {/* Protocol badge for https */}
            {server.protocol === "https" && (
              <span className="text-[9px] opacity-60 flex-shrink-0" style={{ color: "var(--xevo-success)" }}>
                https
              </span>
            )}

            {/* Pinned indicator */}
            {server.isPinned && (
              <span className="text-[9px] opacity-60 flex-shrink-0" style={{ color: "var(--xevo-accent)" }}>
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

  if (!sidebarOpen) return null;

  return (
    <div
      className="flex flex-col flex-shrink-0 border-r overflow-hidden"
      style={{
        width: sidebarWidth,
        background: "var(--xevo-sidebar-bg)",
        borderColor: "var(--xevo-border)",
      }}
    >
      {/* Header */}
      <div
        className="px-3 py-2 border-b flex-shrink-0"
        style={{ borderColor: "var(--xevo-border-subtle)" }}
      >
        <span className="text-[10px] font-bold tracking-[0.09em] text-[var(--xevo-text-muted)] uppercase">
          {wsName}
        </span>
      </div>

      {/* Panel icon nav */}
      <div
        className="flex items-center gap-0.5 px-1.5 py-1 border-b flex-shrink-0 overflow-x-auto"
        style={{ borderColor: "var(--xevo-border-subtle)" }}
      >
        {PANELS.map(({ id, Icon, label }) => (
          <button
            key={id}
            onClick={() => togglePanel(id)}
            title={label}
            className={cn(
              "w-8 h-8 rounded-[6px] flex items-center justify-center flex-shrink-0 transition-colors",
              activePanel === id
                ? "bg-[var(--xevo-accent-dim)] text-[var(--xevo-accent)]"
                : "text-[var(--xevo-text-faint)] hover:text-[var(--xevo-text-muted)] hover:bg-[rgba(255,255,255,0.04)]"
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
        {activePanel === "api" && <ApiTesterPanel />}
        {activePanel === "notes" && <NotesSidebarPanel />}
        {activePanel === "jwt" && <JwtDecoder />}
        {activePanel === "base64" && <Base64Tool />}
        {activePanel !== "servers" &&
          activePanel !== "bookmarks" &&
          activePanel !== "history" &&
          activePanel !== "api" &&
          activePanel !== "notes" &&
          activePanel !== "jwt" &&
          activePanel !== "base64" &&
          activePanel !== null && (
            <div className="flex items-center justify-center h-24 text-[11px] text-[var(--xevo-text-faint)]">
              Coming soon
            </div>
          )}
      </div>
    </div>
  );
}
