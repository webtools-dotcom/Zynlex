import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";

interface WorkspaceContextMenuProps {
  workspaceId: string;
  workspaceName: string;
  canDelete: boolean;
  x: number;
  y: number;
  onDelete: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 180;

function adjustPosition(x: number, y: number): { x: number; y: number } {
  let nx = x;
  let ny = y;
  if (typeof window === "undefined") return { x: nx, y: ny };
  if (nx + MENU_WIDTH > window.innerWidth) nx = window.innerWidth - MENU_WIDTH - 4;
  if (ny + 60 > window.innerHeight) ny = window.innerHeight - 60 - 4;
  if (nx < 4) nx = 4;
  if (ny < 4) ny = 4;
  return { x: nx, y: ny };
}

export function WorkspaceContextMenu({
  workspaceName,
  canDelete,
  x,
  y,
  onDelete,
  onClose,
}: WorkspaceContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const pos = adjustPosition(x, y);

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[10000] py-1 rounded-[4px] border text-[13px]"
      style={{
        left: pos.x,
        top: pos.y,
        width: MENU_WIDTH,
        background: "var(--color-elevated)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--color-text-disabled)] truncate">
        {workspaceName}
      </div>
      <button
        type="button"
        disabled={!canDelete}
        onClick={() => {
          if (!canDelete) return;
          onDelete();
          onClose();
        }}
        className={
          "w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors " +
          (canDelete
            ? "text-red-400 hover:bg-[var(--color-hover)]"
            : "text-[var(--color-text-disabled)] opacity-50 cursor-not-allowed")
        }
      >
        <Trash2 size={13} />
        Delete Workspace
      </button>
    </div>,
    document.body
  );
}
