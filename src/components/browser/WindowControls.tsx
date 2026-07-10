import { Minus, Square, X, Copy } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState, useEffect } from "react";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function WindowControls() {
  if (!IS_TAURI) return null;

  const win = getCurrentWindow();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    win.isMaximized().then(setIsMaximized);
    win.onResized(() => {
      win.isMaximized().then(setIsMaximized);
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, [win]);

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
