import { useState, useEffect } from "react";
import { X, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tab } from "@/types";

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onPointerDown: (e: React.PointerEvent) => void;
  isDropTarget: boolean;
  isDragging: boolean;
}

export function TabItem({
  tab, isActive, onActivate, onClose, onContextMenu,
  onPointerDown, isDropTarget, isDragging,
}: TabItemProps) {
  const [faviconError, setFaviconError] = useState<boolean>(false);

  useEffect(() => {
    setFaviconError(false);
  }, [tab.favicon]);

  function handleCloseClick(e: React.MouseEvent) {
    e.stopPropagation();
    onClose();
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button === 1) { e.preventDefault(); onClose(); }
  }

  function handleClick() {
    onActivate();
  }

  return (
    <div
      role="tab"
      aria-selected={isActive}
      data-tab-id={tab.id}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      className={cn(
        "group relative flex items-center gap-1.5",
        "min-w-[80px] max-w-[180px] h-[36px] px-3",
        "cursor-grab select-none flex-shrink-0",
        "border-b-2 border-r transition-colors",
        isDragging && "opacity-40",
        isActive
          ? "bg-[var(--color-base)] text-[var(--color-text-primary)] border-b-[var(--color-accent)]"
          : "bg-transparent text-[var(--color-text-muted)] border-b-transparent hover:bg-[var(--color-hover)] hover:text-[var(--color-text-secondary)]",
      )}
      style={{
        borderLeftColor: isDropTarget ? "var(--color-accent)" : undefined,
        borderTopColor: isDropTarget ? "var(--color-accent)" : undefined,
        borderBottomColor: isDropTarget ? "var(--color-accent)" : undefined,
        borderRightColor: "var(--color-border-subtle)",
      }}
    >
      {/* Favicon */}
      <div className="w-3.5 h-3.5 flex-shrink-0 flex items-center justify-center">
        {tab.favicon && !faviconError ? (
          <img
            src={tab.favicon}
            alt=""
            className="w-3.5 h-3.5 object-contain"
            onError={() => setFaviconError(true)}
          />
        ) : (
          <div className="w-3.5 h-3.5 rounded-[3px] flex-shrink-0" style={{ background: "var(--color-hover)" }} />
        )}
      </div>

      {/* Title */}
      <span className="flex-1 min-w-0 text-[13px] font-medium leading-none truncate">
        {tab.isLoading ? "Loading…" : (tab.title || "New Tab")}
      </span>

      {/* Close button OR pin indicator */}
      {tab.isPinned ? (
        <span
          className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-[var(--color-text-disabled)]"
          title="Pinned"
          aria-label="Pinned tab"
        >
          <Pin size={10} strokeWidth={2} />
        </span>
      ) : (
        <button
          onClick={handleCloseClick}
          data-tab-close="true"
          aria-label="Close tab"
          className={cn(
            "flex-shrink-0 w-4 h-4 rounded-[2px] flex items-center justify-center",
            "transition-colors text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-active)]",
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <X size={10} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
