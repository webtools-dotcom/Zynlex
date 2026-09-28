/**
 * Toolbar pill for an available update. Lives in the toolbar because anything
 * drawn over the content area sits under the native tab webview and is never
 * seen (see stores/updates.ts).
 */
import { Download, RotateCw } from "lucide-react";
import { useUpdatesStore } from "@/stores/updates";

export function UpdateButton() {
  const { update, phase, pct, install, restart } = useUpdatesStore();
  if (!update) return null;

  const label =
    phase === "downloading"
      ? `Updating ${pct}%`
      : phase === "ready"
        ? "Restart to update"
        : phase === "failed"
          ? "Update failed · retry"
          : `Update to ${update.version}`;

  return (
    <button
      onClick={() => void (phase === "ready" ? restart() : install())}
      disabled={phase === "downloading"}
      title={
        phase === "failed"
          ? "The download or install failed. Click to try again, or get the installer from GitHub releases."
          : `ZYNLEX ${update.version} is available`
      }
      className="h-7 px-2.5 mr-1 flex items-center gap-1.5 rounded-[4px] text-xs font-mono whitespace-nowrap bg-[var(--color-accent)] text-[var(--color-text-inverse)] hover:bg-[var(--color-accent-hover)] disabled:opacity-80 disabled:cursor-default transition-colors"
    >
      {phase === "ready" ? <RotateCw size={12} /> : <Download size={12} />}
      {label}
    </button>
  );
}
