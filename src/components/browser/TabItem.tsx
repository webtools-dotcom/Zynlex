import { useState, useEffect, useRef } from "react";
import { X, Pin } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tab } from "@/types";

interface TabItemProps {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isDragOver: boolean;
  isDragging: boolean;
}

export function TabItem({
  tab, isActive, onActivate, onClose, onContextMenu,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, isDragOver, isDragging,
}: TabItemProps) {
  const [faviconError, setFaviconError] = useState<boolean>(false);
  const justDraggedRef = useRef<boolean>(false);

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

  function handleDragStart(e: React.DragEvent) {
    justDraggedRef.current = true;
    onDragStart(e);
  }

  function handleClick() {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    onActivate();
  }

  return (
    <div
      role="tab"
      aria-selected={isActive}
      draggable={true}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onContextMenu={onContextMenu}
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        "group relative flex items-center gap-1.5",
        "min-w-[80px] max-w-[180px] h-9 px-2.5",
        "cursor-grab active:cursor-grabbing select-none flex-shrink-0",
        "border-r transition-all duration-100",
        isDragging && "opacity-40",
        isActive
          ? "text-[var(--xevo-text)]"
          : "text-[var(--xevo-text-muted)] hover:text-[var(--xevo-text)]"
      )}
      style={{
        background: isActive ? "var(--xevo-tab-active)" : "transparent",
        borderColor: "var(--xevo-border)",
        borderLeft: isDragOver ? "2px solid var(--xevo-accent)" : undefined,
      }}
    >
      {/* Active top line */}
      {isActive && (
        <div
          className="absolute top-0 left-2 right-2 h-[2px] rounded-b-sm"
          style={{ background: "var(--xevo-accent)" }}
        />
      )}

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
          <div className="w-3.5 h-3.5 rounded-[3px] flex-shrink-0" style={{ background: "rgba(255,255,255,0.08)" }} />
        )}
      </div>

      {/* Title */}
      <span className="flex-1 min-w-0 text-[11px] leading-none truncate">
        {tab.isLoading ? "Loading…" : (tab.title || "New Tab")}
      </span>

      {/* Close button OR pin indicator */}
      {tab.isPinned ? (
        <span
          className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-[var(--xevo-text-faint)]"
          title="Pinned"
          aria-label="Pinned tab"
        >
          <Pin size={10} strokeWidth={2} />
        </span>
      ) : (
        <button
          onClick={handleCloseClick}
          draggable={false}
          data-tab-close="true"
          className={cn(
            "flex-shrink-0 w-3.5 h-3.5 rounded-[3px] flex items-center justify-center",
            "transition-colors duration-100 text-[var(--xevo-text-faint)] hover:text-[var(--xevo-text)] hover:bg-[rgba(255,255,255,0.08)]",
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <X size={9} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
