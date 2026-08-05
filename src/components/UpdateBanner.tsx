/**
 * UpdateBanner — bottom-right prompt shown when a newer release exists.
 *
 * Checks once on mount and never again: a browser session can run for days and
 * nagging someone mid-task is worse than them finding out on next launch.
 * Nothing is downloaded until the user agrees, and "Later" is remembered for
 * the rest of the session only.
 *
 * Sits above the toast stack (z-9999 vs 9998) because it does not auto-dismiss.
 */
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useUIStore } from "@/stores/ui";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Phase = "idle" | "downloading" | "done";

export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const pushToast = useUIStore((s) => s.pushToast);

  useEffect(() => {
    if (!IS_TAURI) return;
    let cancelled = false;
    // A failed check is not worth telling anyone about — offline is normal.
    check()
      .then((u) => {
        if (!cancelled && u) setUpdate(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;

  async function install() {
    if (!update) return;
    setPhase("downloading");
    let total = 0;
    let got = 0;
    try {
      await update.downloadAndInstall((e) => {
        if (e.event === "Started") total = e.data.contentLength ?? 0;
        else if (e.event === "Progress") {
          got += e.data.chunkLength;
          if (total > 0) setPct(Math.round((got / total) * 100));
        }
      });
      setPhase("done");
    } catch {
      setPhase("idle");
      pushToast("Update failed. Try downloading it from GitHub.", "danger");
    }
  }

  return (
    <div
      className="fixed bottom-4 right-4 z-[9999] flex items-center gap-3 px-3 py-2.5 rounded-md border max-w-[380px]"
      style={{
        background: "var(--color-elevated)",
        borderColor: "var(--color-border)",
        animation: "toastIn var(--duration-normal) var(--ease-out)",
      }}
    >
      <Download size={14} className="flex-shrink-0" style={{ color: "var(--color-accent)" }} />

      <span className="text-xs font-mono" style={{ color: "var(--color-text-primary)" }}>
        {phase === "downloading"
          ? `Downloading ${pct}%`
          : phase === "done"
            ? "Restart to finish"
            : `Version ${update.version} is available`}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        {phase === "idle" && (
          <>
            <button
              onClick={install}
              className="text-xs font-mono px-2 py-1 rounded"
              style={{ background: "var(--color-accent)", color: "#0f0f0f" }}
            >
              Update
            </button>
            <button
              onClick={() => setUpdate(null)}
              aria-label="Dismiss"
              className="p-1 rounded"
              style={{ color: "var(--color-text-muted)" }}
            >
              <X size={13} />
            </button>
          </>
        )}

        {phase === "done" && (
          <button
            onClick={() => void relaunch()}
            className="text-xs font-mono px-2 py-1 rounded"
            style={{ background: "var(--color-accent)", color: "#0f0f0f" }}
          >
            Restart
          </button>
        )}
      </div>
    </div>
  );
}
