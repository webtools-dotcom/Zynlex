/**
 * TabContextMenu — right-click context menu for tabs.
 *
 * Renders a fixed-position menu via a Portal so it isn't clipped by
 * the tab bar's `overflow: hidden`. Smart-positions to stay on screen.
 * Click-outside-to-close handled via document mousedown listener.
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { getLiveWorkspaceTabIds } from "@/lib/workspaceTabs";
import { closeTabWebview } from "@/services/browser";
import type { useWebviewBridge } from "@/hooks/useWebviewBridge";

type BridgeType = ReturnType<typeof useWebviewBridge>;

interface TabContextMenuProps {
  tabId: string;
  workspaceId: string;
  x: number;
  y: number;
  onClose: () => void;
  bridge?: BridgeType | null;
}

const MENU_WIDTH = 180;
const ESTIMATED_HEIGHT = 220;

function adjustPosition(x: number, y: number): { x: number; y: number } {
  let nx = x;
  let ny = y;
  if (typeof window === "undefined") return { x: nx, y: ny };
  if (nx + MENU_WIDTH > window.innerWidth) nx = window.innerWidth - MENU_WIDTH - 4;
  if (ny + ESTIMATED_HEIGHT > window.innerHeight) {
    ny = window.innerHeight - ESTIMATED_HEIGHT - 4;
  }
  if (nx < 4) nx = 4;
  if (ny < 4) ny = 4;
  return { x: nx, y: ny };
}

export function TabContextMenu({
  tabId,
  workspaceId,
  x,
  y,
  onClose,
  bridge,
}: TabContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const tab = useTabsStore((s) => s.tabs[tabId]);

  // Click outside to close
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  // Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pos = adjustPosition(x, y);

  function handleReload() {
    if (bridge) bridge.reload();
    onClose();
  }

  function handleDuplicate() {
    if (!tab) return;
    const newId = useTabsStore.getState().addTab(workspaceId, {
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon ?? undefined,
    });
    useWorkspacesStore.getState().addTabToWorkspace(workspaceId, newId);
    onClose();
  }

  function handlePin() {
    useTabsStore.getState().pinTab(tabId);
    onClose();
  }

  function handleClose() {
    useWorkspacesStore.getState().removeTabFromWorkspace(workspaceId, tabId);
    useTabsStore.getState().closeTab(tabId);
    closeTabWebview(tabId).catch(() => {});
    onClose();
  }

  function handleCloseOthers() {
    const ws = useWorkspacesStore.getState().workspaces[workspaceId];
    if (!ws) return;
    const others = getLiveWorkspaceTabIds(ws, useTabsStore.getState().tabs).filter(
      (id) => id !== tabId
    );
    for (const id of others) {
      useWorkspacesStore.getState().removeTabFromWorkspace(workspaceId, id);
      useTabsStore.getState().closeTab(id);
      closeTabWebview(id).catch(() => {});
    }
    onClose();
  }

  if (!tab) return null;

  const hasUrl = !!tab.url;
  const isPinned = !!tab.isPinned;

  return createPortal(
    <div
      ref={menuRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: MENU_WIDTH,
        background: "var(--color-elevated)",
        border: "1px solid var(--color-border)",
        borderRadius: 6,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        padding: 4,
        zIndex: 9999,
        userSelect: "none",
      }}
      role="menu"
    >
      <MenuItem label="Reload" disabled={!hasUrl} onClick={handleReload} />
      <Separator />
      <MenuItem label="Duplicate Tab" onClick={handleDuplicate} />
      <MenuItem label={isPinned ? "Unpin Tab" : "Pin Tab"} onClick={handlePin} />
      <Separator />
      <MenuItem label="Close Tab" onClick={handleClose} />
      <MenuItem label="Close Other Tabs" onClick={handleCloseOthers} />
    </div>,
    document.body,
  );
}

function MenuItem({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left text-[12px] px-2 h-7 rounded transition-colors"
      style={{
        background: "transparent",
        color: disabled ? "var(--color-text-disabled)" : "var(--color-text-muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        border: "none",
        outline: "none",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "var(--color-hover)";
        if (!disabled) e.currentTarget.style.color = "var(--color-text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        if (!disabled) e.currentTarget.style.color = "var(--color-text-muted)";
      }}
      role="menuitem"
    >
      {label}
    </button>
  );
}

function Separator() {
  return (
    <div
      className="my-1"
      style={{ height: 1, background: "var(--color-border)" }}
      role="separator"
    />
  );
}
