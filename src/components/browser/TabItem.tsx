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
  /** Left-column layout: full-width row, accent on the left edge instead of the bottom. */
  vertical?: boolean;
}

export function TabItem({
  tab, isActive, onActivate, onClose, onContextMenu,
  onPointerDown, isDropTarget, isDragging, vertical = false,
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
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } }}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      className={cn(
        "group relative flex items-center gap-1.5",
        "cursor-grab select-none flex-shrink-0 transition-colors",
        vertical
          ? "w-full h-9 px-2 border-l-2 border-b"
          : "min-w-[100px] max-w-[200px] h-[40px] px-3 border-b-2 border-r border-l-2 border-t-2",
        isDragging && "opacity-40",
        isActive
          ? "bg-[var(--color-base)] text-[var(--color-text-primary)]"
          : "bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-text-secondary)]",
      )}
      style={
        vertical
          ? {
              // Left edge carries the active/selected accent; the bottom hairline
              // becomes the drop indicator, since drops are vertical here.
              borderLeftColor: isActive ? "var(--color-accent)" : "transparent",
              borderBottomColor: isDropTarget
                ? "var(--color-accent)"
                : "var(--color-border-subtle)",
            }
          : {
              borderBottomColor: isDropTarget
                ? "var(--color-accent)"
                : isActive
                  ? "var(--color-accent)"
                  : "transparent",
              borderRightColor: "var(--color-border-subtle)",
              borderLeftColor: isDropTarget ? "var(--color-accent)" : "transparent",
              borderTopColor: isDropTarget ? "var(--color-accent)" : "transparent",
            }
      }
    >
      {/* Favicon */}
      <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
        {tab.favicon && !faviconError ? (
          <img
            src={tab.favicon}
            alt=""
            className="w-4 h-4 object-contain"
            onError={() => setFaviconError(true)}
          />
        ) : (
          <div className="w-4 h-4 rounded-[3px] flex-shrink-0" style={{ background: "var(--color-hover)" }} />
        )}
      </div>

      {/* Title */}
      <span className="flex-1 min-w-0 text-md font-medium leading-none truncate">
        {tab.isLoading ? "Loading…" : (tab.title || "New Tab")}
      </span>

      {/* Close button OR pin indicator */}
      {tab.isPinned ? (
        <span
          className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-[var(--color-text-disabled)]"
          title="Pinned"
          aria-label="Pinned tab"
        >
          <Pin size={12} strokeWidth={2} />
        </span>
      ) : (
        <button
          onClick={handleCloseClick}
          data-tab-close="true"
          aria-label="Close tab"
          className={cn(
            "flex-shrink-0 w-5 h-5 rounded-[2px] flex items-center justify-center",
            "transition-colors text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-active)]",
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
