import { Plus, Settings, PanelLeft, PanelLeftClose } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useUIStore } from "@/stores/ui";
import { getLiveWorkspaceTabIds } from "@/lib/workspaceTabs";
import type { Workspace } from "@/types";

interface IconProps {
  workspace: Workspace;
  isActive: boolean;
  tabCount: number;
  onClick: () => void;
}

function WorkspaceIcon({ workspace, isActive, tabCount, onClick }: IconProps) {
  return (
    <button
      onClick={onClick}
      title={`${workspace.name} (${tabCount} tab${tabCount !== 1 ? "s" : ""})`}
      style={{
        backgroundColor: isActive
          ? "rgba(255,255,255,0.08)"
          : "transparent",
      }}
      className={cn(
        "relative w-8 h-8 rounded-md flex items-center justify-center",
        "text-xs font-semibold transition-all duration-150",
        "hover:opacity-90 select-none",
        !isActive && "hover:bg-[var(--xevo-hover)]"
      )}
    >
      <span style={{ color: isActive ? "var(--xevo-text)" : "var(--xevo-text-muted)" }}>
        {workspace.icon || workspace.name.charAt(0).toUpperCase()}
      </span>
      {tabCount > 0 && !isActive && (
        <span
          className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[8px] flex items-center justify-center font-bold leading-none"
          style={{ background: "var(--xevo-badge-bg)", color: "var(--xevo-text)" }}
        >
          {tabCount > 9 ? "9+" : tabCount}
        </span>
      )}
    </button>
  );
}

export function WorkspaceSwitcher() {
  const {
    workspaces,
    workspaceOrder,
    activeWorkspaceId,
    setActiveWorkspace,
    createWorkspace,
  } = useWorkspacesStore();
  const tabs = useTabsStore((s) => s.tabs);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const toggleSettingsPanel = useUIStore((s) => s.toggleSettingsPanel);

  function handleNew() {
    const n = workspaceOrder.length + 1;
    createWorkspace(`Project ${n}`);
  }

  return (
    <div
      className="w-12 flex flex-col items-center py-2 gap-1.5 flex-shrink-0 border-r"
      style={{
        background: "var(--xevo-workspace-bar)",
        borderColor: "var(--xevo-border)",
      }}
    >
      <button
        onClick={toggleSidebar}
        title={sidebarOpen ? "Collapse Sidebar (Ctrl+B)" : "Expand Sidebar (Ctrl+B)"}
        className="w-8 h-8 rounded-md flex items-center justify-center transition-colors text-[var(--xevo-text-faint)] hover:text-[var(--xevo-text)] hover:bg-[var(--xevo-hover)]"
      >
        {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeft size={14} />}
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
          />
        );
      })}

      <div className="flex-1" />

      <button
        onClick={handleNew}
        title="New workspace"
        className="w-8 h-8 rounded-md flex items-center justify-center transition-colors text-[var(--xevo-text-faint)] hover:text-[var(--xevo-text)] hover:bg-[var(--xevo-hover)]"
      >
        <Plus size={14} />
      </button>

      <div className="mt-auto pb-2">
        <button
          onClick={toggleSettingsPanel}
          className="w-10 h-10 flex items-center justify-center text-[var(--xevo-text-faint)] hover:text-[var(--xevo-text)] rounded-lg hover:bg-[var(--xevo-hover)] transition-colors"
          style={{ borderTop: "1px solid var(--xevo-border-subtle)" }}
          title="Settings (Ctrl+,)"
        >
          <Settings size={18} />
        </button>
      </div>
    </div>
  );
}
