import { Download, Trash2, FolderOpen, FileText, Loader2 } from "lucide-react";
import { useDownloadsStore } from "@/stores/downloads";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { openDownload } from "@/services/browser";
import { useUIStore } from "@/stores/ui";
import { hostOf } from "@/lib/url";

export function DownloadsPanel() {
  const items = useDownloadsStore((s) => s.items);
  const clear = useDownloadsStore((s) => s.clear);

  function reveal(path: string, inFolder: boolean) {
    openDownload(path, inFolder).catch((err) =>
      useUIStore.getState().pushToast(String(err), "danger")
    );
  }

  return (
    <div className="p-2 flex flex-col h-full">
      <div className="flex items-center justify-between px-1 mb-2 flex-shrink-0">
        <p className="text-xs font-bold tracking-[0.09em] text-[var(--color-text-muted)] uppercase">
          Downloads
        </p>
        {items.length > 0 && (
          <ConfirmButton
            onConfirm={clear}
            title="Clear download history"
            className="text-[var(--color-text-disabled)] hover:text-[var(--color-dead)] transition-colors"
          >
            <Trash2 size={12} />
          </ConfirmButton>
        )}
      </div>

      {items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-4">
            <Download size={22} className="mx-auto mb-1.5 text-[var(--color-text-disabled)] opacity-40" />
            <p className="text-sm text-[var(--color-text-muted)]">No downloads yet</p>
            <p className="text-xs text-[var(--color-text-disabled)] mt-0.5">
              Files you download will appear here
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {items.map((d) => (
            <div
              key={d.id}
              className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--color-hover)] transition-colors"
            >
              {d.status === "active" ? (
                <Loader2 size={12} className="animate-spin text-[var(--color-accent)] flex-shrink-0" />
              ) : (
                <FileText
                  size={12}
                  className={
                    d.status === "failed"
                      ? "text-[var(--color-dead)] flex-shrink-0"
                      : "text-[var(--color-text-disabled)] flex-shrink-0"
                  }
                />
              )}
              <div className="flex-1 min-w-0" title={d.path}>
                <p className="text-sm text-[var(--color-text-muted)] truncate font-medium">
                  {d.filename}
                </p>
                <p className="text-micro text-[var(--color-text-disabled)] truncate">
                  {d.status === "active"
                    ? "Downloading…"
                    : d.status === "failed"
                      ? "Failed"
                      : hostOf(d.url, d.url)}
                </p>
              </div>
              {d.status === "done" && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={() => reveal(d.path, false)}
                    title="Open file"
                    aria-label="Open file"
                    className="text-[var(--color-text-disabled)] hover:text-[var(--color-accent)]"
                  >
                    <FileText size={11} />
                  </button>
                  <button
                    onClick={() => reveal(d.path, true)}
                    title="Show in folder"
                    aria-label="Show in folder"
                    className="text-[var(--color-text-disabled)] hover:text-[var(--color-accent)]"
                  >
                    <FolderOpen size={11} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
