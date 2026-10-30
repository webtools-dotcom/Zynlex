import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { fitMenuOnScreen } from "@/lib/utils";

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


export function WorkspaceContextMenu({
  workspaceName,
  canDelete,
  x,
  y,
  onDelete,
  onClose,
}: WorkspaceContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const pos = fitMenuOnScreen(x, y, MENU_WIDTH, 60);

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
      className="fixed z-[10000] py-1 rounded-[4px] border text-sm"
      style={{
        left: pos.x,
        top: pos.y,
        width: MENU_WIDTH,
        background: "var(--color-elevated)",
        borderColor: "var(--color-border)",
      }}
    >
      <div className="px-3 py-1.5 text-micro uppercase tracking-wider text-[var(--color-text-disabled)] truncate">
        {workspaceName}
      </div>
      {/* Confirms in place — closing the menu on the first click would unmount
          the armed state before it could be confirmed. */}
      <ConfirmButton
        disabled={!canDelete}
        onConfirm={() => {
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
      </ConfirmButton>
    </div>,
    document.body,
  );
}
