import { Minus, Square, X, Copy } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState, useEffect, useRef } from "react";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// IS_TAURI is fixed for the process lifetime, so this early-return is never
// actually conditional across renders of a mounted instance — but hooks must
// still be declared before it structurally, so the rules-of-hooks linter can
// verify that.
export function WindowControls() {
  const win = IS_TAURI ? getCurrentWindow() : null;
  const [isMaximized, setIsMaximized] = useState(false);
  // onResized fires continuously during a drag-resize; without this a fresh
  // isMaximized() IPC round-trip fired on every single frame of the drag.
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!win) return;
    let unlisten: (() => void) | null = null;
    win.isMaximized().then(setIsMaximized);
    win.onResized(() => {
      if (rafIdRef.current !== null) return;
      rafIdRef.current = requestAnimationFrame(() => {
        rafIdRef.current = null;
        win.isMaximized().then(setIsMaximized);
      });
    }).then((fn) => { unlisten = fn; });
    return () => {
      unlisten?.();
      if (rafIdRef.current !== null) cancelAnimationFrame(rafIdRef.current);
    };
  }, [win]);

  // Tell useWebviewBridge to drop its <1px bounds guard when the maximize state
  // flips, so its ResizeObserver → syncBounds fallback is guaranteed to re-push
  // bounds after a maximize/restore (belt-and-suspenders for the Rust resync).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("xevo:maximize-changed"));
  }, [isMaximized]);

  if (!win) return null;

  return (
    <div className="flex items-stretch h-full" data-tauri-drag-region="false">
      <button
        aria-label="Minimize"
        onClick={() => win.minimize()}
        className="w-[46px] h-full flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] transition-colors duration-0"
      >
        <Minus size={14} />
      </button>
      <button
        aria-label={isMaximized ? "Restore" : "Maximize"}
        onClick={() => win.toggleMaximize()}
        className="w-[46px] h-full flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] transition-colors duration-0"
      >
        {isMaximized ? <Copy size={11} /> : <Square size={11} />}
      </button>
      <button
        aria-label="Close"
        onClick={() => win.close()}
        className="w-[46px] h-full flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-dead)] hover:text-white transition-colors duration-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}
