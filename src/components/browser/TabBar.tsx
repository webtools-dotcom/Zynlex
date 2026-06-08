import { Plus } from "lucide-react";
import { useEffect, useCallback, useRef, useState } from "react";
import { TabItem } from "./TabItem";
import { TabContextMenu } from "./TabContextMenu";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { getLiveWorkspaceActiveTabId, getLiveWorkspaceTabIds } from "@/lib/workspaceTabs";
import type { useWebviewBridge } from "@/hooks/useWebviewBridge";

type BridgeType = ReturnType<typeof useWebviewBridge>;

interface TabBarProps {
  bridge?: BridgeType | null;
}

interface ContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

export function TabBar({ bridge = null }: TabBarProps = {}) {
  const {
    workspaces, activeWorkspaceId,
    addTabToWorkspace, removeTabFromWorkspace, setActiveTab, reorderTabs,
  } = useWorkspacesStore();
  const addTab = useTabsStore((s) => s.addTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const tabs = useTabsStore((s) => s.tabs);

  const ws = workspaces[activeWorkspaceId];
  const tabIds = getLiveWorkspaceTabIds(ws, tabs);
  const activeTabId = getLiveWorkspaceActiveTabId(ws, tabs);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dragTabId, setDragTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [dropAtEnd, setDropAtEnd] = useState<boolean>(false);
  const justDroppedAtPlusRef = useRef<boolean>(false);

  const openNewTab = useCallback(() => {
    const id = addTab(activeWorkspaceId, { url: "", title: "New Tab" });
    addTabToWorkspace(activeWorkspaceId, id);
    setActiveTab(activeWorkspaceId, id);
  }, [activeWorkspaceId, addTab, addTabToWorkspace, setActiveTab]);

  function openNewTabSafe() {
    if (justDroppedAtPlusRef.current) {
      justDroppedAtPlusRef.current = false;
      return;
    }
    openNewTab();
  }

  const handleCloseTab = useCallback((tabId: string) => {
    removeTabFromWorkspace(activeWorkspaceId, tabId);
    closeTab(tabId);
  }, [activeWorkspaceId, removeTabFromWorkspace, closeTab]);

  const handleContextMenu = useCallback((tabId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ tabId, x: e.clientX, y: e.clientY });
  }, []);

  const handleDragStart = useCallback((tabId: string, e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", tabId);
    setDragTabId(tabId);

    const source = e.currentTarget as HTMLElement;
    const rect = source.getBoundingClientRect();
    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.style.position = "absolute";
    ghost.style.top = "-9999px";
    ghost.style.left = "-9999px";
    ghost.style.width = `${rect.width}px`;
    ghost.style.opacity = "0.85";
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, rect.width / 2, rect.height / 2);
    requestAnimationFrame(() => {
      if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
    });
  }, []);

  const handleDragOver = useCallback((tabId: string, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTabId(tabId);
    setDropAtEnd(false);
  }, []);

  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (e.target === e.currentTarget) {
      setDropAtEnd(true);
      setDragOverTabId(null);
    }
  }, []);

  const handlePlusDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropAtEnd(true);
    setDragOverTabId(null);
  }, []);

  const handleContainerDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragTabId === null) {
      setDragTabId(null);
      setDragOverTabId(null);
      setDropAtEnd(false);
      return;
    }
    const liveWsId = useWorkspacesStore.getState().activeWorkspaceId;
    const current = useWorkspacesStore.getState().workspaces[liveWsId];
    if (!current) {
      setDragTabId(null);
      setDragOverTabId(null);
      setDropAtEnd(false);
      return;
    }
    const tabsState = useTabsStore.getState().tabs;
    const live = getLiveWorkspaceTabIds(current, tabsState);
    const next = live.filter((id) => id !== dragTabId);
    next.push(dragTabId);
    const pinned = next.filter((id) => tabsState[id]?.isPinned);
    const unpinned = next.filter((id) => !tabsState[id]?.isPinned);
    reorderTabs(liveWsId, [...pinned, ...unpinned]);
    justDroppedAtPlusRef.current = true;
    setDragTabId(null);
    setDragOverTabId(null);
    setDropAtEnd(false);
  }, [dragTabId, reorderTabs]);

  const handleDrop = useCallback((targetTabId: string, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragTabId === null || dragTabId === targetTabId) {
      setDragTabId(null);
      setDragOverTabId(null);
      setDropAtEnd(false);
      return;
    }
    const liveWsId = useWorkspacesStore.getState().activeWorkspaceId;
    const current = useWorkspacesStore.getState().workspaces[liveWsId];
    if (!current) {
      setDragTabId(null);
      setDragOverTabId(null);
      setDropAtEnd(false);
      return;
    }
    const tabsState = useTabsStore.getState().tabs;
    const live = getLiveWorkspaceTabIds(current, tabsState);
    const next = live.filter((id) => id !== dragTabId);
    const insertAt = next.indexOf(targetTabId);
    if (insertAt === -1) {
      next.push(dragTabId);
    } else {
      next.splice(insertAt, 0, dragTabId);
    }
    const pinned = next.filter((id) => tabsState[id]?.isPinned);
    const unpinned = next.filter((id) => !tabsState[id]?.isPinned);
    reorderTabs(liveWsId, [...pinned, ...unpinned]);
    setDragTabId(null);
    setDragOverTabId(null);
    setDropAtEnd(false);
  }, [dragTabId, reorderTabs]);

  const handleDragEnd = useCallback((_e?: React.DragEvent) => {
    setDragTabId(null);
    setDragOverTabId(null);
    setDropAtEnd(false);
    justDroppedAtPlusRef.current = false;
  }, []);

  const handleTabDragLeave = useCallback((_tabId: string, e: React.DragEvent) => {
    const related = e.relatedTarget as HTMLElement | null;
    if (!related || !related.closest("[data-tab-bar]")) {
      setDragOverTabId(null);
      setDropAtEnd(false);
    }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "t") { e.preventDefault(); openNewTab(); }
      if (mod && e.key === "w") { e.preventDefault(); if (activeTabId) handleCloseTab(activeTabId); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNewTab, handleCloseTab, activeTabId]);

  useEffect(() => {
    if (tabIds.length === 0) openNewTab();
  }, [activeWorkspaceId, openNewTab, tabIds.length]);

  return (
    <div
      className="h-9 flex items-stretch flex-shrink-0 overflow-hidden"
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
      data-tab-bar="true"
      style={{ background: "var(--xevo-tab-bar)", borderBottom: "1px solid var(--xevo-border-subtle)" }}
    >
      <div
        className="flex items-stretch flex-1 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
        onDragOver={handleContainerDragOver}
        onDrop={handleContainerDrop}
      >
        {tabIds.map((tabId) => {
          const tab = tabs[tabId];
          if (!tab) return null;
          return (
            <TabItem
              key={tabId}
              tab={tab}
              isActive={tabId === activeTabId}
              onActivate={() => setActiveTab(activeWorkspaceId, tabId)}
              onClose={() => handleCloseTab(tabId)}
              onContextMenu={(e) => handleContextMenu(tabId, e)}
              onDragStart={(e) => handleDragStart(tabId, e)}
              onDragEnd={() => handleDragEnd()}
              onDragOver={(e) => handleDragOver(tabId, e)}
              onDragLeave={(e) => handleTabDragLeave(tabId, e)}
              onDrop={(e) => {
                if ((e.target as HTMLElement).closest("[data-tab-close]")) return;
                handleDrop(tabId, e);
              }}
              isDragOver={dragOverTabId === tabId && dragTabId !== tabId}
              isDragging={dragTabId === tabId}
            />
          );
        })}
      </div>

      <button
        onClick={openNewTabSafe}
        title="New tab (Ctrl+T)"
        onDragOver={handlePlusDragOver}
        onDrop={handleContainerDrop}
        className="flex-shrink-0 w-9 flex items-center justify-center text-[var(--xevo-text-faint)] hover:text-[var(--xevo-text)] hover:bg-[var(--xevo-hover)] transition-colors border-l"
        style={{
          borderColor: dropAtEnd ? "var(--xevo-accent)" : "var(--xevo-border)",
          borderLeftWidth: dropAtEnd ? 2 : 1,
        }}
      >
        <Plus size={13} />
      </button>

      {contextMenu && (
        <TabContextMenu
          tabId={contextMenu.tabId}
          workspaceId={activeWorkspaceId}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          bridge={bridge}
        />
      )}
    </div>
  );
}
