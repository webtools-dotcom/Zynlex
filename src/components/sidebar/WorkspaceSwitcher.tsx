import { useState } from "react";
import { Plus, Settings, PanelLeft, PanelLeftClose } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useBookmarksStore } from "@/stores/bookmarks";
import { useUIStore } from "@/stores/ui";
import { closeTabWebview } from "@/services/browser";
import { getLiveWorkspaceTabIds } from "@/lib/workspaceTabs";
import { WorkspaceContextMenu } from "./WorkspaceContextMenu";
import type { Workspace } from "@/types";

interface IconProps {
  workspace: Workspace;
  isActive: boolean;
  tabCount: number;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function WorkspaceIcon({ workspace, isActive, tabCount, onClick, onContextMenu }: IconProps) {
  return (
    <button
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={`${workspace.name} (${tabCount} tab${tabCount !== 1 ? "s" : ""})`}
      style={{
        backgroundColor: isActive
          ? "var(--color-accent-dim)"
          : "transparent",
        borderLeft: isActive
          ? `2px solid ${workspace.color}`
          : "2px solid transparent",
      }}
      className={cn(
        "relative w-9 h-9 rounded-[4px] flex items-center justify-center",
        "text-[13px] font-semibold transition-colors duration-80",
        "hover:opacity-90 select-none",
        !isActive && "hover:bg-[var(--color-hover)]",
      )}
    >
      <span style={{ color: isActive ? "var(--color-accent)" : "var(--color-text-muted)" }}>
        {workspace.icon || workspace.name.charAt(0).toUpperCase()}
      </span>
      {tabCount > 0 && !isActive && (
        <span
          className="absolute -top-1 -right-1 w-5 h-5 rounded-full text-[10px] flex items-center justify-center font-bold leading-none"
          style={{ background: "var(--color-elevated)", color: "var(--color-text-primary)" }}
        >
          {tabCount > 9 ? "9+" : tabCount}
        </span>
      )}
    </button>
  );
}

interface ContextMenuState {
  workspaceId: string;
  x: number;
  y: number;
}

export function WorkspaceSwitcher() {
  const {
    workspaces,
    workspaceOrder,
    activeWorkspaceId,
    setActiveWorkspace,
    createWorkspace,
    deleteWorkspace,
  } = useWorkspacesStore();
  const tabs = useTabsStore((s) => s.tabs);
  const closeTab = useTabsStore((s) => s.closeTab);
  const clearForWorkspace = useBookmarksStore((s) => s.clearForWorkspace);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleSettingsPanel = useUIStore((s) => s.toggleSettingsPanel);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  function handleNew() {
    const n = workspaceOrder.length + 1;
    createWorkspace(`Project ${n}`);
  }

  function handleDeleteWorkspace(workspaceId: string) {
    const ws = workspaces[workspaceId];
    if (!ws || workspaceOrder.length <= 1) return;
    if (!window.confirm(`Delete workspace "${ws.name}" and all its tabs?`)) return;
    const tabIds = getLiveWorkspaceTabIds(ws, tabs);
    tabIds.forEach((tabId) => {
      closeTabWebview(tabId).catch(() => {});
      closeTab(tabId);
    });
    clearForWorkspace(workspaceId);
    deleteWorkspace(workspaceId);
  }

  return (
    <div
      className="w-14 flex flex-col items-center py-2 gap-1.5 flex-shrink-0 border-r"
      style={{
        background: "var(--color-base)",
        borderColor: "var(--color-border)",
      }}
    >
      <button
        onClick={toggleSidebar}
        title={sidebarOpen ? "Collapse Sidebar (Ctrl+B)" : "Expand Sidebar (Ctrl+B)"}
        aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        className="w-9 h-9 rounded-[4px] flex items-center justify-center transition-colors text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]"
      >
        {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
      </button>

      {workspaceOrder.map((wsId) => {
        const ws = workspaces[wsId];
        if (!ws) return null;
        return (
          <WorkspaceIcon
            key={wsId}
            workspace={ws}
            isActive={wsId === activeWorkspaceId}
            tabCount={getLiveWorkspaceTabIds(ws, tabs).length}
            onClick={() => setActiveWorkspace(wsId)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu({ workspaceId: wsId, x: e.clientX, y: e.clientY });
            }}
          />
        );
      })}

      <div className="flex-1" />

      <button
        onClick={handleNew}
        title="New workspace"
        aria-label="New workspace"
        className="w-9 h-9 rounded-[4px] flex items-center justify-center transition-colors text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)]"
      >
        <Plus size={16} />
      </button>

      <div className="mt-auto pb-2">
        <button
          onClick={toggleSettingsPanel}
          className="w-11 h-11 flex items-center justify-center text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] rounded-[4px] hover:bg-[var(--color-hover)] transition-colors"
          style={{ borderTop: "1px solid var(--color-border-subtle)" }}
          title="Settings (Ctrl+,)"
          aria-label="Settings"
        >
          <Settings size={20} />
        </button>
      </div>

      {contextMenu && workspaces[contextMenu.workspaceId] && (
        <WorkspaceContextMenu
          workspaceId={contextMenu.workspaceId}
          workspaceName={workspaces[contextMenu.workspaceId].name}
          canDelete={workspaceOrder.length > 1}
          x={contextMenu.x}
          y={contextMenu.y}
          onDelete={() => handleDeleteWorkspace(contextMenu.workspaceId)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
