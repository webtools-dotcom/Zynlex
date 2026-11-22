import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Trash2 } from "lucide-react";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { fitMenuOnScreen } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";
import { useWorkspacesStore } from "@/stores/workspaces";

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
  workspaceId,
  workspaceName,
  canDelete,
  x,
  y,
  onDelete,
  onClose,
}: WorkspaceContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const pos = fitMenuOnScreen(x, y, MENU_WIDTH, 90);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(workspaceName);

  function saveName() {
    useWorkspacesStore.getState().renameWorkspace(workspaceId, draft);
    onClose();
  }

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

  // Hides the page while open: the menu can overlap the content area, and the
  // page webview would paint over that part of it.
  useEffect(() => {
    useUIStore.getState().chromeMenuOpened();
    return () => useUIStore.getState().chromeMenuClosed();
  }, []);

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
      {renaming ? (
        <input
          autoFocus
          aria-label="Workspace name"
          value={draft}
          maxLength={40}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveName();
          }}
          onFocus={(e) => e.currentTarget.select()}
          className="mx-2 my-1 w-[calc(100%-1rem)] px-1.5 py-0.5 text-xs rounded border outline-none text-[var(--color-text-primary)] focus:border-[var(--color-accent)]"
          style={{ background: "var(--color-base)", borderColor: "var(--color-border)" }}
        />
      ) : (
        <div className="px-3 py-1.5 text-micro uppercase tracking-wider text-[var(--color-text-muted)] truncate">
          {workspaceName}
        </div>
      )}
      {!renaming && (
        <button
          type="button"
          onClick={() => setRenaming(true)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]"
        >
          <Pencil size={13} />
          Rename
        </button>
      )}
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
