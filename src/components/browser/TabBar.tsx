import { Plus } from "lucide-react";
import { useEffect, useCallback, useRef, useState } from "react";
import { WindowControls } from "./WindowControls";
import { TabItem } from "./TabItem";
import { TabContextMenu } from "./TabContextMenu";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { getLiveWorkspaceActiveTabId, getLiveWorkspaceTabIds } from "@/lib/workspaceTabs";
import { closeTabWebview } from "@/services/browser";
import type { useWebviewBridge } from "@/hooks/useWebviewBridge";

type BridgeType = ReturnType<typeof useWebviewBridge>;

interface TabBarProps {
  bridge?: BridgeType | null;
  /** Left-column layout (settings.tabBarPosition === "left"). */
  vertical?: boolean;
}

export const VERTICAL_TAB_BAR_WIDTH = 200;

interface ContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

export function TabBar({ bridge = null, vertical = false }: TabBarProps = {}) {
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

  // Pointer-drag state
  const isDragging = useRef(false);
  const dragTabIdRef = useRef<string | null>(null);
  const dragOffsetX = useRef(0);
  const dragOffsetY = useRef(0);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const tabRectsRef = useRef<Map<string, DOMRect>>(new Map());
  const dropTargetRef = useRef<string | null>(null);

  // State for rendering (only what JSX needs)
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const openNewTab = useCallback(() => {
    const id = addTab(activeWorkspaceId, { url: "", title: "New Tab" });
    addTabToWorkspace(activeWorkspaceId, id);
    setActiveTab(activeWorkspaceId, id);
  }, [activeWorkspaceId, addTab, addTabToWorkspace, setActiveTab]);

  const handleCloseTab = useCallback((tabId: string) => {
    removeTabFromWorkspace(activeWorkspaceId, tabId);
    closeTab(tabId);
    closeTabWebview(tabId).catch(() => {});
  }, [activeWorkspaceId, removeTabFromWorkspace, closeTab]);

  const handleContextMenu = useCallback((tabId: string, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ tabId, x: e.clientX, y: e.clientY });
  }, []);

  // ── Pointer-based drag handlers ────────────────────────────────────────

  const handlePointerDown = useCallback((tabId: string, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-tab-close]")) return;

    const tabEl = e.currentTarget as HTMLElement;
    const rect = tabEl.getBoundingClientRect();

    isDragging.current = true;
    dragTabIdRef.current = tabId;
    dragOffsetX.current = e.clientX - rect.left;
    dragOffsetY.current = e.clientY - rect.top;

    // Cache all tab rects for hit testing during move
    const rects = new Map<string, DOMRect>();
    const tabBar = tabEl.closest("[data-tab-bar]");
    if (tabBar) {
      tabBar.querySelectorAll<HTMLElement>("[role='tab']").forEach((el) => {
        const id = el.getAttribute("data-tab-id");
        if (id) rects.set(id, el.getBoundingClientRect());
      });
    }
    tabRectsRef.current = rects;

    // Capture pointer so mousemove fires even outside the tab
    tabEl.setPointerCapture(e.pointerId);

    // Create ghost element
    const ghost = tabEl.cloneNode(true) as HTMLDivElement;
    ghost.style.position = "fixed";
    ghost.style.top = `${rect.top}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.zIndex = "99999";
    ghost.style.pointerEvents = "none";
    ghost.style.opacity = "0.9";
    ghost.style.transition = "none";
    ghost.style.background = "var(--color-elevated)";
    document.body.appendChild(ghost);
    dragGhostRef.current = ghost;

    setDraggingTabId(tabId);
    setDropTarget(null);
    dropTargetRef.current = null;
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current || !dragGhostRef.current) return;

    // Same hit-testing logic in both layouts — only the axis changes.
    if (vertical) {
      dragGhostRef.current.style.top = `${e.clientY - dragOffsetY.current}px`;
    } else {
      dragGhostRef.current.style.left = `${e.clientX - dragOffsetX.current}px`;
    }

    const pos = vertical ? e.clientY : e.clientX;
    const startOf = (r: DOMRect) => (vertical ? r.top : r.left);
    const endOf = (r: DOMRect) => (vertical ? r.bottom : r.right);

    // Find which tab we're hovering over using cached rects
    const rects = tabRectsRef.current;
    let newTarget: string | null = null;

    for (const [tabId, rect] of rects) {
      if (tabId === dragTabIdRef.current) continue;
      if (pos >= startOf(rect) && pos <= endOf(rect)) {
        newTarget = tabId;
        break;
      }
    }

    // Check if hovering past the last tab (drop at end)
    if (!newTarget) {
      const allIds = [...rects.keys()];
      if (allIds.length > 0) {
        const lastRect = rects.get(allIds[allIds.length - 1]);
        if (lastRect && pos > endOf(lastRect)) {
          newTarget = "__end__";
        }
      }
    }

    // Only update state if target changed
    if (newTarget !== dropTargetRef.current) {
      dropTargetRef.current = newTarget;
      setDropTarget(newTarget);
    }
  }, [vertical]);

  const handlePointerUp = useCallback((_e: React.PointerEvent) => {
    if (!isDragging.current) return;

    // Remove ghost
    if (dragGhostRef.current) {
      dragGhostRef.current.remove();
      dragGhostRef.current = null;
    }

    const sourceId = dragTabIdRef.current;
    const targetId = dropTargetRef.current;

    // Clean up state
    isDragging.current = false;
    dragTabIdRef.current = null;
    dropTargetRef.current = null;
    setDraggingTabId(null);
    setDropTarget(null);

    // If dropped on itself or no target, do nothing
    if (!sourceId || !targetId || sourceId === targetId) return;

    // Execute reorder using live store reads (avoids stale closures)
    const liveWsId = useWorkspacesStore.getState().activeWorkspaceId;
    const current = useWorkspacesStore.getState().workspaces[liveWsId];
    if (!current) return;

    const tabsState = useTabsStore.getState().tabs;
    const live = getLiveWorkspaceTabIds(current, tabsState);
    const next = live.filter((id) => id !== sourceId);

    if (targetId === "__end__") {
      next.push(sourceId);
    } else {
      const insertAt = next.indexOf(targetId);
      if (insertAt === -1) {
        next.push(sourceId);
      } else {
        next.splice(insertAt, 0, sourceId);
      }
    }

    // Normalize pinned tabs to front
    const pinned = next.filter((id) => tabsState[id]?.isPinned);
    const unpinned = next.filter((id) => !tabsState[id]?.isPinned);
    reorderTabs(liveWsId, [...pinned, ...unpinned]);
  }, [reorderTabs]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
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

  const tabItems = tabIds.map((tabId) => {
    const tab = tabs[tabId];
    if (!tab) return null;
    return (
      <TabItem
        key={tabId}
        tab={tab}
        vertical={vertical}
        isActive={tabId === activeTabId}
        onActivate={() => setActiveTab(activeWorkspaceId, tabId)}
        onClose={() => handleCloseTab(tabId)}
        onContextMenu={(e) => handleContextMenu(tabId, e)}
        onPointerDown={(e) => handlePointerDown(tabId, e)}
        isDropTarget={dropTarget === tabId && draggingTabId !== tabId}
        isDragging={draggingTabId === tabId}
      />
    );
  });

  if (vertical) {
    return (
      <div
        className="flex flex-col flex-shrink-0 h-full overflow-hidden border-r"
        data-tab-bar="true"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          width: VERTICAL_TAB_BAR_WIDTH,
          background: "var(--color-surface)",
          borderColor: "var(--color-border-subtle)",
        }}
      >
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          {tabItems}
        </div>

        <button
          onClick={openNewTab}
          title="New tab (Ctrl+T)"
          aria-label="New tab"
          className="flex-shrink-0 h-9 flex items-center justify-center gap-1.5 text-xs text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] transition-colors border-t"
          style={{
            borderColor: dropTarget === "__end__" ? "var(--color-accent)" : "var(--color-border)",
            borderTopWidth: dropTarget === "__end__" ? 2 : 1,
          }}
        >
          <Plus size={14} /> New tab
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

  return (
    <div
      className="h-[40px] flex items-stretch flex-shrink-0 overflow-hidden"
      data-tab-bar="true"
      data-tauri-drag-region="deep"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        background: "var(--color-surface)",
        borderBottom: "1px solid var(--color-border-subtle)",
      }}
    >
      <div
        className="flex items-stretch flex-1 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {tabItems}
      </div>

      <button
        onClick={openNewTab}
        title="New tab (Ctrl+T)"
        aria-label="New tab"
        className="flex-shrink-0 w-10 flex items-center justify-center text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] transition-colors border-l"
        style={{
          borderColor: dropTarget === "__end__" ? "var(--color-accent)" : "var(--color-border)",
          borderLeftWidth: dropTarget === "__end__" ? 2 : 1,
        }}
      >
        <Plus size={15} />
      </button>

      <div className="flex-shrink-0 flex items-stretch">
        <WindowControls />
      </div>

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
