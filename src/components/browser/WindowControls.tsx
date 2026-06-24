import { Minus, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function WindowControls() {
  const win = getCurrentWindow();

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
        aria-label="Maximize"
        onClick={() => win.toggleMaximize()}
        className="w-[46px] h-full flex items-center justify-center text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] transition-colors duration-0"
      >
        <Square size={11} />
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
