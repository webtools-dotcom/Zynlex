/**
 * ApiTesterPanel — sidebar launcher card for the API Tester.
 *
 * The full API Tester UI is too cramped inside the 210px sidebar.
 * This panel shows a button to open the full-page modal plus a small
 * "Recent Requests" card (shared with the full tester via the
 * useApiHistoryStore).
 */
import { useState } from "react";
import { ArrowRight, Code2, Clock, Trash2, FolderPlus, Copy, Folder } from "lucide-react";
import { useUIStore } from "@/stores/ui";
import { useApiHistoryStore } from "@/stores/apiHistory";
import { useApiCollectionsStore, type SavedRequest } from "@/stores/apiCollections";
import { useWorkspacesStore } from "@/stores/workspaces";
import { ConfirmButton } from "@/components/ui/ConfirmButton";
import { LOAD_REQUEST_EVENT } from "@/components/panels/ApiTester";

const METHOD_COLORS: Record<string, string> = {
  GET: "#22c55e",
  POST: "#f59e0b",
  PUT: "#3b82f6",
  DELETE: "#ef4444",
  PATCH: "#a855f7",
  HEAD: "#71717a",
  OPTIONS: "#06b6d4",
};

function CollectionsCard() {
  const openOverlay = useUIStore((s) => s.openOverlay);
  const wsId = useWorkspacesStore((s) => s.activeWorkspaceId);
  const collection = useApiCollectionsStore((s) => s.byWs[wsId]);
  const { updateRequest, removeRequest, duplicateRequest, addFolder, removeFolder } =
    useApiCollectionsStore();

  const [newFolder, setNewFolder] = useState<string | null>(null);

  const folders = collection?.folders ?? [];
  const requests = collection?.requests ?? [];

  function load(req: SavedRequest) {
    openOverlay("api-tester");
    // The overlay mounts on the same tick; dispatch after it can listen.
    setTimeout(
      () => window.dispatchEvent(new CustomEvent(LOAD_REQUEST_EVENT, { detail: req })),
      0
    );
  }

  function Row({ req }: { req: SavedRequest }) {
    return (
      <div className="group flex items-center gap-1.5 px-2 py-1 hover:bg-[var(--color-hover)] transition-colors">
        <button
          onClick={() => load(req)}
          className="flex-1 min-w-0 flex items-center gap-1.5 text-left"
          title={req.url}
        >
          <span
            className="text-micro font-bold flex-shrink-0"
            style={{ color: METHOD_COLORS[req.method] ?? "#999" }}
          >
            {req.method}
          </span>
          <span className="text-xs text-[var(--color-text-muted)] truncate">
            {req.name}
          </span>
        </button>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {folders.length > 0 && (
            <select
              value={req.folderId ?? ""}
              onChange={(e) =>
                updateRequest(wsId, req.id, { folderId: e.target.value || null })
              }
              aria-label="Move to folder"
              className="text-micro bg-[var(--color-elevated)] text-[var(--color-text-muted)] rounded outline-none border border-[var(--color-border)]"
            >
              <option value="">(root)</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => duplicateRequest(wsId, req.id)}
            title="Duplicate"
            aria-label="Duplicate request"
            className="text-[var(--color-text-disabled)] hover:text-[var(--color-accent)]"
          >
            <Copy size={11} />
          </button>
          <ConfirmButton
            onConfirm={() => removeRequest(wsId, req.id)}
            title="Delete request"
            className="text-[var(--color-text-disabled)] hover:text-[var(--color-dead)]"
          >
            <Trash2 size={11} />
          </ConfirmButton>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--color-border)]">
        <span className="text-micro font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase">
          Collections ({requests.length})
        </span>
        <button
          onClick={() => setNewFolder("")}
          title="New folder"
          aria-label="New folder"
          className="text-[var(--color-text-disabled)] hover:text-[var(--color-accent)]"
        >
          <FolderPlus size={12} />
        </button>
      </div>

      {newFolder !== null && (
        <div className="px-2 py-1.5 border-b border-[var(--color-border)]">
          <input
            autoFocus
            value={newFolder}
            onChange={(e) => setNewFolder(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newFolder.trim()) {
                addFolder(wsId, newFolder.trim());
                setNewFolder(null);
              } else if (e.key === "Escape") setNewFolder(null);
            }}
            onBlur={() => setNewFolder(null)}
            placeholder="Folder name"
            className="w-full px-2 py-1 text-xs bg-[var(--color-surface)] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-disabled)] rounded outline-none border border-[var(--color-border)] focus:border-[var(--color-accent)]"
          />
        </div>
      )}

      {requests.length === 0 && folders.length === 0 ? (
        <div className="px-2 py-3 text-center">
          <p className="text-xs text-[var(--color-text-disabled)]">No saved requests</p>
          <p className="text-micro text-[var(--color-text-disabled)] mt-0.5">
            Hit Save in the tester
          </p>
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          {requests.filter((r) => !r.folderId).map((r) => (
            <Row key={r.id} req={r} />
          ))}
          {folders.map((f) => (
            <div key={f.id}>
              <div className="group flex items-center gap-1.5 px-2 py-1 bg-[var(--color-surface)]">
                <Folder size={11} className="text-[var(--color-text-disabled)] flex-shrink-0" />
                <span className="text-micro font-semibold tracking-wide text-[var(--color-text-muted)] uppercase truncate flex-1">
                  {f.name}
                </span>
                <ConfirmButton
                  onConfirm={() => removeFolder(wsId, f.id)}
                  title="Delete folder (requests move to root)"
                  className="opacity-0 group-hover:opacity-100 text-[var(--color-text-disabled)] hover:text-[var(--color-dead)]"
                >
                  <Trash2 size={11} />
                </ConfirmButton>
              </div>
              {requests.filter((r) => r.folderId === f.id).map((r) => (
                <Row key={r.id} req={r} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ApiTesterPanel() {
  const openOverlay = useUIStore((s) => s.openOverlay);
  const history = useApiHistoryStore((s) => s.history);
  const clearHistory = useApiHistoryStore((s) => s.clearHistory);

  return (
    <div className="p-2 flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase">
          API Tester
        </p>
      </div>

      {/* Open button card */}
      <button
        onClick={() => openOverlay("api-tester")}
        className="flex items-center gap-2 p-3 rounded-md text-left border border-[var(--color-border)] bg-[var(--color-elevated)] hover:border-[var(--color-accent)] hover:bg-[var(--color-hover)] transition-colors"
      >
        <Code2 size={18} className="text-[var(--color-accent)] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-[var(--color-text-primary)] font-medium">
            Open API Tester
          </div>
          <div className="text-xs text-[var(--color-text-disabled)]">
            Full editor in a centered window
          </div>
        </div>
        <ArrowRight size={14} className="text-[var(--color-text-disabled)] flex-shrink-0" />
      </button>

      <CollectionsCard />

      {/* Method reference cheat sheet */}
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] p-2">
        <div className="text-micro font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase mb-1.5">
          Methods
        </div>
        <div className="grid grid-cols-2 gap-1">
          {Object.entries(METHOD_COLORS).map(([m, c]) => (
            <div
              key={m}
              className="flex items-center gap-1.5 text-xs font-mono"
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: c }}
              />
              <span style={{ color: c }}>{m}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent requests */}
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-elevated)] overflow-hidden">
        <div className="flex items-center justify-between px-2 py-1.5 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-1.5">
            <Clock size={12} className="text-[var(--color-text-disabled)]" />
            <span className="text-micro font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase">
              Recent ({history.length})
            </span>
          </div>
          {history.length > 0 && (
            <button
              onClick={clearHistory}
              title="Clear history"
              aria-label="Clear request history"
              className="text-[var(--color-text-disabled)] hover:text-[var(--color-dead)]"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
        {history.length === 0 ? (
          <div className="px-2 py-3 text-center">
            <p className="text-xs text-[var(--color-text-disabled)]">
              No requests yet
            </p>
            <p className="text-micro text-[var(--color-text-disabled)] mt-0.5">
              Open the tester and send one
            </p>
          </div>
        ) : (
          <div className="max-h-32 overflow-y-auto">
            {history.slice(0, 5).map((h) => (
              <button
                key={h.id}
                onClick={() => openOverlay("api-tester")}
                className="w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-[var(--color-hover)] transition-colors"
              >
                <span
                  className="text-micro font-bold flex-shrink-0"
                  style={{ color: METHOD_COLORS[h.method] ?? "#999" }}
                >
                  {h.method}
                </span>
                <span className="text-xs text-[var(--color-text-muted)] font-mono flex-1 min-w-0 truncate">
                  {h.url}
                </span>
                <span
                  className="text-micro font-mono flex-shrink-0"
                  style={{
                    color:
                      h.status >= 200 && h.status < 300
                        ? "var(--color-live)"
                        : h.status >= 400
                          ? "var(--color-dead)"
                          : "var(--color-warn)",
                    fontFeatureSettings: '"tnum" 1',
                  }}
                >
                  {h.status}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ApiTesterPanel;
