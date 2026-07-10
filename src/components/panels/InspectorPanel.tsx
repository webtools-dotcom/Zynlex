import { useState, useEffect, useCallback } from "react";
import {
  Globe,
  RotateCw,
  CheckCircle2,
  XCircle,
  ClipboardCheck,
  AlertTriangle,
  Info,
  Code,
} from "lucide-react";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useInspectorStore } from "@/stores/inspector";
import { evalInspector, inspectorMutate } from "@/services/browser";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";
import { SocialPreviewCard } from "@/components/panels/SocialPreview";
import { validateMetaTags, metaTagsToRecord } from "@/components/panels/MetaValidator";
import type { InspectorSubTab } from "@/stores/inspector";

function CopyIcon({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover:opacity-100 p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer transition-all"
      title="Copy"
    >
      {copied ? (
        <ClipboardCheck size={12} className="text-[var(--color-success, #22c55e)]" />
      ) : (
        <span className="text-[11px]">copy</span>
      )}
    </button>
  );
}

// ─── META Sub-tab ──────────────────────────────────────────────────

function MetaSubTab() {
  const meta = useInspectorStore((s) => s.meta);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [diagResult, setDiagResult] = useState<{
    status: "loading" | "valid" | "warning" | "error";
    message: string;
    width?: number;
    height?: number;
    sizeKB?: number;
  } | null>(null);

  if (!meta) return null;

  const record = metaTagsToRecord(meta.metas);
  record.title = meta.title;
  record.canonical = meta.canonical || "";

  const validations = validateMetaTags(record);

  const passCount = validations.filter((v) => v.status === "valid").length;
  const warnCount = validations.filter((v) => v.status === "warning").length;
  const errCount = validations.filter((v) => v.status === "error").length;

  const seoGroup = meta.metas.filter((m) =>
    ["description", "keywords", "robots", "googlebot", "author"].includes(m.name)
  );
  const ogGroup = meta.metas.filter(
    (m) => m.name.startsWith("og:") || (m as unknown as Record<string, string>).property?.startsWith("og:")
  );
  const twitterGroup = meta.metas.filter((m) => m.name.startsWith("twitter:"));
  const otherGroup = meta.metas.filter(
    (m) => !seoGroup.includes(m) && !ogGroup.includes(m) && !twitterGroup.includes(m)
  );

  const groups = [
    { key: "seo", label: "SEO", items: seoGroup },
    { key: "og", label: "Open Graph", items: ogGroup },
    { key: "twitter", label: "Twitter Card", items: twitterGroup },
    { key: "other", label: "Other", items: otherGroup },
  ].filter((g) => g.items.length > 0);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Image Diagnostics ────────────────────────────────────────────
  const ogImage = record["og:image"] || record["twitter:image"] || "";

  async function runImageDiag(url: string) {
    setDiagResult({ status: "loading", message: "Loading…" });
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        setDiagResult({ status: "error", message: `HTTP ${resp.status}` });
        return;
      }
      const ct = resp.headers.get("content-type");
      if (!ct?.startsWith("image/")) {
        setDiagResult({ status: "error", message: `Not an image (${ct})` });
        return;
      }
      const blob = await resp.blob();
      const sizeKB = blob.size / 1024;
      const img = new Image();
      img.src = URL.createObjectURL(blob);
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to decode image"));
      });
      const issues: string[] = [];
      if (img.width < 600 || img.height < 315) {
        issues.push(`Too small (${img.width}×${img.height}, min 600×315)`);
      }
      if (img.width < 1200 || img.height < 630) {
        issues.push(`Below recommended (${img.width}×${img.height}, recommended 1200×630)`);
      }
      if (sizeKB > 5000) {
        issues.push(`Very large (${Math.round(sizeKB)}KB, recommended <500KB)`);
      }
      const ratio = img.width / img.height;
      if (Math.abs(ratio - 1.91) > 0.1) {
        issues.push(`Wrong aspect ratio (${ratio.toFixed(2)}, expected 1.91)`);
      }
      const declW = record["og:image:width"];
      const declH = record["og:image:height"];
      if (declW && parseInt(declW) !== img.width) {
        issues.push(`Declared width ${declW}px but actual is ${img.width}px`);
      }
      if (declH && parseInt(declH) !== img.height) {
        issues.push(`Declared height ${declH}px but actual is ${img.height}px`);
      }
      URL.revokeObjectURL(img.src);
      setDiagResult({
        status: issues.length > 0 ? "warning" : "valid",
        message: issues.length > 0 ? issues.join("; ") : `${img.width}×${img.height}, ${Math.round(sizeKB)}KB`,
        width: img.width,
        height: img.height,
        sizeKB,
      });
    } catch (e) {
      setDiagResult({ status: "error", message: `Failed to load: ${e}` });
    }
  }

  return (
    <div className="px-2 py-1">
      {/* Score bar */}
      <div className="flex items-center gap-2 mb-2 text-[12px] font-medium">
        <span className="text-[var(--color-success, #22c55e)]">{passCount} pass</span>
        {warnCount > 0 && <span className="text-[#f59e0b]">{warnCount} warn</span>}
        {errCount > 0 && <span className="text-[var(--color-danger, #ef4444)]">{errCount} fail</span>}
      </div>

      {/* Validation list */}
      <div className="space-y-0.5 mb-3">
        {validations.map((v) => (
          <div key={v.field} className="flex items-start gap-1.5" title={v.message}>
            {v.status === "valid" ? (
              <CheckCircle2 size={11} className="text-[var(--color-success, #22c55e)] shrink-0 mt-0.5" />
            ) : v.status === "warning" ? (
              <AlertTriangle size={11} className="text-[#f59e0b] shrink-0 mt-0.5" />
            ) : (
              <XCircle size={11} className="text-[var(--color-danger, #ef4444)] shrink-0 mt-0.5" />
            )}
            <span className="text-[12px] text-[var(--color-text-primary)]">
              {v.field}
            </span>
            <span className="text-[11px] text-[var(--color-text-disabled)] ml-auto shrink-0">
              {v.message}
            </span>
          </div>
        ))}
      </div>

      {/* Canonical */}
      {meta.canonical && (
        <div className="mb-2 text-[13px]">
          <span className="text-[var(--color-text-muted)]">Canonical: </span>
          <a
            href={meta.canonical}
            className="text-[var(--color-accent)] hover:underline font-mono text-[12px] break-all"
          >
            {meta.canonical}
          </a>
        </div>
      )}

      {/* Image Diagnostics */}
      {ogImage && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Info size={12} className="text-[var(--color-text-muted)]" />
            <p className="text-[12px] font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase">
              Image Diagnostics
            </p>
          </div>
          <div className="flex items-center gap-1 mb-1">
            <button
              onClick={() => runImageDiag(ogImage)}
              disabled={diagResult?.status === "loading"}
              className="text-[12px] bg-[var(--color-accent-dim)] text-[var(--color-accent)] px-1.5 py-0.5 rounded hover:bg-[var(--color-accent)] hover:text-white transition-colors disabled:opacity-50"
            >
              {diagResult?.status === "loading" ? "Checking…" : "Run diagnostics"}
            </button>
            {diagResult && diagResult.status !== "loading" && (
              <span className={diagResult.status === "valid" ? "text-[#22c55e]" : diagResult.status === "warning" ? "text-[#f59e0b]" : "text-[#ef4444]"}>
                <span className="text-[11px]">{diagResult.message}</span>
              </span>
            )}
          </div>
          {diagResult && diagResult.width && (
            <p className="text-[11px] text-[var(--color-text-muted)] font-mono">
              {diagResult.width}×{diagResult.height} · {Math.round(diagResult.sizeKB ?? 0)}KB
            </p>
          )}
        </div>
      )}

      {/* Social Preview Cards */}
      {ogImage && (
        <div className="mb-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Globe size={12} className="text-[var(--color-text-muted)]" />
            <p className="text-[12px] font-semibold tracking-widest text-[var(--color-text-disabled)] uppercase">
              Social Previews
            </p>
          </div>
          <div className="space-y-2">
            {(["facebook", "twitter", "linkedin", "discord"] as const).map((p) => (
              <SocialPreviewCard key={p} platform={p} meta={record} />
            ))}
          </div>
        </div>
      )}

      {/* JSON-LD Structured Data */}
      {meta.ldJson && meta.ldJson.length > 0 && (
        <div className="mb-2">
          <button
            onClick={() => setCollapsedGroups((prev) => {
              const next = new Set(prev);
              if (next.has("ldjson")) next.delete("ldjson");
              else next.add("ldjson");
              return next;
            })}
            className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] cursor-pointer w-full text-left py-0.5"
          >
            <Code size={12} />
            <span>Structured Data (JSON-LD)</span>
            <span className="text-[var(--color-text-disabled)]">({meta.ldJson.length})</span>
          </button>
          {!collapsedGroups.has("ldjson") && (
            <div className="ml-2 mt-1">
              {meta.ldJson.map((item, i) => (
                <pre
                  key={i}
                  className="text-[11px] font-mono text-[var(--color-text-muted)] whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto p-1 rounded"
                  style={{ background: "var(--color-surface)" }}
                >
                  {JSON.stringify(item, null, 2)}
                </pre>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Meta Groups */}
      {groups.map((group) => (
        <div key={group.key} className="mb-2">
          <button
            onClick={() => toggleGroup(group.key)}
            className="flex items-center gap-1 text-[12px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] cursor-pointer w-full text-left py-0.5"
          >
            <span>{collapsedGroups.has(group.key) ? "▸" : "▾"}</span>
            <span>{group.label}</span>
            <span className="text-[var(--color-text-disabled)]">({group.items.length})</span>
          </button>
          {!collapsedGroups.has(group.key) && (
            <div className="ml-2">
              {group.items.map((item, i) => {
                const name = item.name || (item as unknown as Record<string, string>).property || "";
                return (
                  <div key={`${group.key}-${i}`} className="group flex items-start gap-2 py-0.5">
                    <span className="w-[30%] shrink-0 text-[12px] font-mono text-[var(--color-text-muted)] truncate">
                      {name}
                    </span>
                    <span className="flex-1 min-w-0 text-[12px] font-mono text-[var(--color-text-primary)] break-all line-clamp-3">
                      {item.content}
                    </span>
                    <CopyIcon text={item.content} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── COOKIES Sub-tab ──────────────────────────────────────────────

function CookiesSubTab({ tabId }: { tabId: string }) {
  const cookies = useInspectorStore((s) => s.cookies);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addValue, setAddValue] = useState("");

  const doRefresh = useCallback(() => {
    evalInspector(tabId, "cookies").catch(() => {});
  }, [tabId]);

  const handleDelete = useCallback(
    (name: string) => {
      inspectorMutate(tabId, "delete-cookie", { name }).then(() => {
        setTimeout(doRefresh, 300);
      }).catch(() => {});
    },
    [tabId, doRefresh]
  );

  const handleSave = useCallback(
    (name: string, value: string) => {
      inspectorMutate(tabId, "set-cookie", { name, value }).then(() => {
        setTimeout(doRefresh, 300);
        setExpandedIdx(null);
      }).catch(() => {});
    },
    [tabId, doRefresh]
  );

  const handleAdd = useCallback(() => {
    if (!addName.trim()) return;
    inspectorMutate(tabId, "set-cookie", {
      name: addName,
      value: addValue,
    }).then(() => {
      setTimeout(doRefresh, 300);
      setAddName("");
      setAddValue("");
      setShowAdd(false);
    }).catch(() => {});
  }, [tabId, addName, addValue, doRefresh]);

  const handleClearAll = useCallback(() => {
    if (!window.confirm("Clear all non-HttpOnly cookies?")) return;
    inspectorMutate(tabId, "clear-cookies", {}).then(() => {
      setTimeout(doRefresh, 300);
    }).catch(() => {});
  }, [tabId, doRefresh]);

  return (
    <div className="px-2 py-1">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[13px] text-[var(--color-text-muted)]">
          {cookies.length} cookie{cookies.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={handleClearAll}
          className="text-[12px] text-[var(--color-danger, #ef4444)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
        >
          Clear All
        </button>
      </div>

      {/* Warning */}
      <div className="text-[12px] text-[#f59e0b] bg-[#f59e0b]/10 border border-[#f59e0b]/30 rounded p-1.5 mb-2">
        HttpOnly cookies are not shown — they are inaccessible to JavaScript for security reasons.
      </div>

      {/* Cookie list */}
      {cookies.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-disabled)] italic text-center py-4">
          No cookies on this page.
        </p>
      ) : (
        cookies.map((cookie, idx) => (
          <div
            key={`${cookie.name}-${idx}`}
            className="mb-1.5 border border-[var(--color-border-subtle)] rounded group"
          >
            <div
              className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-[var(--color-hover)]"
              onClick={() => {
                if (expandedIdx === idx) {
                  setExpandedIdx(null);
                } else {
                  setExpandedIdx(idx);
                  setEditValue(cookie.value);
                }
              }}
            >
              <span className="text-[13px] font-mono font-medium text-[var(--color-text-primary)]">
                {cookie.name}
              </span>
              <span className="text-[12px] font-mono text-[var(--color-text-muted)] truncate max-w-[120px]">
                {cookie.value}
              </span>
              <CopyIcon text={`${cookie.name}=${cookie.value}`} />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(cookie.name);
                }}
                className="opacity-0 group-hover:opacity-100 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-danger, #ef4444)] cursor-pointer transition-all"
              >
                del
              </button>
            </div>
            {expandedIdx === idx && (
              <div className="px-2 pb-2 border-t border-[var(--color-border-subtle)]">
                <textarea
                  rows={3}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="w-full mt-1 px-2 py-1 text-[12px] font-mono rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] resize-none"
                />
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => handleSave(cookie.name, editValue)}
                    className="text-[12px] px-2 py-0.5 rounded bg-[var(--color-accent)] text-white cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setExpandedIdx(null)}
                    className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))
      )}

      {/* Add Cookie */}
      {!showAdd ? (
        <button
          onClick={() => setShowAdd(true)}
          className="mt-2 text-[12px] text-[var(--color-accent)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
        >
          + Add Cookie
        </button>
      ) : (
        <div className="mt-2 p-2 border border-[var(--color-border-subtle)] rounded">
          <input
            type="text"
            placeholder="Cookie name"
            value={addName}
            onChange={(e) => setAddName(e.target.value)}
            className="w-full h-7 px-2 text-[12px] rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] mb-1"
          />
          <textarea
            rows={2}
            placeholder="Cookie value"
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
            className="w-full px-2 py-1 text-[12px] font-mono rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] resize-none mb-1"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!addName.trim()}
              className="text-[12px] px-2 py-0.5 rounded bg-[var(--color-accent)] text-white disabled:opacity-40 cursor-pointer"
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setAddName("");
                setAddValue("");
              }}
              className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── STORAGE Sub-tab ──────────────────────────────────────────────

function StorageSubTab({
  tabId,
  storageSubTab,
  setStorageSubTab,
}: {
  tabId: string;
  storageSubTab: "localStorage" | "sessionStorage";
  setStorageSubTab: (v: "localStorage" | "sessionStorage") => void;
}) {
  const localStorageItems = useInspectorStore((s) => s.localStorageItems);
  const sessionStorageItems = useInspectorStore((s) => s.sessionStorageItems);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addKey, setAddKey] = useState("");
  const [addValue, setAddValue] = useState("");

  const items =
    storageSubTab === "localStorage" ? localStorageItems : sessionStorageItems;

  const totalSize = items.reduce(
    (sum, item) => sum + item.key.length + item.value.length,
    0
  );

  const formatBytes = (chars: number) => {
    if (chars < 1024) return `${chars} B`;
    return `${(chars / 1024).toFixed(1)} KB`;
  };

  const doRefresh = useCallback(() => {
    evalInspector(tabId, storageSubTab).catch(() => {});
  }, [tabId, storageSubTab]);

  const handleDelete = useCallback(
    (key: string) => {
      inspectorMutate(tabId, "delete-storage", {
        storeType: storageSubTab,
        key,
      }).then(() => {
        setTimeout(doRefresh, 300);
      }).catch(() => {});
    },
    [tabId, storageSubTab, doRefresh]
  );

  const handleSave = useCallback(
    (key: string, value: string) => {
      inspectorMutate(tabId, "set-storage", {
        storeType: storageSubTab,
        key,
        value,
      }).then(() => {
        setTimeout(doRefresh, 300);
        setExpandedIdx(null);
      }).catch(() => {});
    },
    [tabId, storageSubTab, doRefresh]
  );

  const handleAdd = useCallback(() => {
    if (!addKey.trim()) return;
    inspectorMutate(tabId, "set-storage", {
      storeType: storageSubTab,
      key: addKey,
      value: addValue,
    }).then(() => {
      setTimeout(doRefresh, 300);
      setAddKey("");
      setAddValue("");
      setShowAdd(false);
    }).catch(() => {});
  }, [tabId, storageSubTab, addKey, addValue, doRefresh]);

  const handleClear = useCallback(() => {
    if (
      !window.confirm(
        `Clear all items in ${storageSubTab}?`
      )
    )
      return;
    inspectorMutate(tabId, "clear-storage", {
      storeType: storageSubTab,
    }).then(() => {
      setTimeout(doRefresh, 300);
    }).catch(() => {});
  }, [tabId, storageSubTab, doRefresh]);

  const formatValue = (val: string) => {
    try {
      const parsed = JSON.parse(val);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return val.length > 200 ? val.slice(0, 200) + "…" : val;
    }
  };

  return (
    <div className="px-2 py-1">
      {/* Toggle + size */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex gap-2">
          <button
            onClick={() => setStorageSubTab("localStorage")}
            className={`text-[12px] cursor-pointer transition-colors ${
              storageSubTab === "localStorage"
                ? "text-[var(--color-text-primary)] border-b border-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            Local Storage
          </button>
          <button
            onClick={() => setStorageSubTab("sessionStorage")}
            className={`text-[12px] cursor-pointer transition-colors ${
              storageSubTab === "sessionStorage"
                ? "text-[var(--color-text-primary)] border-b border-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            Session Storage
          </button>
        </div>
        <span className="text-[12px] text-[var(--color-text-disabled)]">
          Using {formatBytes(totalSize)}
        </span>
      </div>

      {/* Items */}
      {items.length === 0 ? (
        <p className="text-[13px] text-[var(--color-text-disabled)] italic text-center py-4">
          No items in {storageSubTab === "localStorage" ? "localStorage" : "sessionStorage"}.
        </p>
      ) : (
        items.map((item, idx) => (
          <div
            key={`${item.key}-${idx}`}
            className="mb-1.5 border border-[var(--color-border-subtle)] rounded group"
          >
            <div
              className="flex items-center gap-2 px-2 py-1 cursor-pointer hover:bg-[var(--color-hover)]"
              onClick={() => {
                if (expandedIdx === idx) {
                  setExpandedIdx(null);
                } else {
                  setExpandedIdx(idx);
                  setEditValue(item.value);
                }
              }}
            >
              <span className="text-[13px] font-mono font-medium text-[var(--color-text-primary)] truncate max-w-[100px]">
                {item.key}
              </span>
              <span className="flex-1 min-w-0 text-[12px] font-mono text-[var(--color-text-muted)] truncate">
                {formatValue(item.value).split("\n")[0]}
              </span>
              <CopyIcon text={item.value} />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(item.key);
                }}
                className="opacity-0 group-hover:opacity-100 text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-danger, #ef4444)] cursor-pointer transition-all"
              >
                del
              </button>
            </div>
            {expandedIdx === idx && (
              <div className="px-2 pb-2 border-t border-[var(--color-border-subtle)]">
                <textarea
                  rows={4}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="w-full mt-1 px-2 py-1 text-[12px] font-mono rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] resize-none"
                />
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => handleSave(item.key, editValue)}
                    className="text-[12px] px-2 py-0.5 rounded bg-[var(--color-accent)] text-white cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setExpandedIdx(null)}
                    className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        ))
      )}

      {/* Add Item */}
      {!showAdd ? (
        <button
          onClick={() => setShowAdd(true)}
          className="mt-2 text-[12px] text-[var(--color-accent)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
        >
          + Add Item
        </button>
      ) : (
        <div className="mt-2 p-2 border border-[var(--color-border-subtle)] rounded">
          <input
            type="text"
            placeholder="Key"
            value={addKey}
            onChange={(e) => setAddKey(e.target.value)}
            className="w-full h-7 px-2 text-[12px] rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] mb-1"
          />
          <textarea
            rows={3}
            placeholder="Value"
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
            className="w-full px-2 py-1 text-[12px] font-mono rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] resize-none mb-1"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!addKey.trim()}
              className="text-[12px] px-2 py-0.5 rounded bg-[var(--color-accent)] text-white disabled:opacity-40 cursor-pointer"
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setAddKey("");
                setAddValue("");
              }}
              className="text-[12px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Clear All */}
      {items.length > 0 && (
        <button
          onClick={handleClear}
          className="mt-2 w-full text-[12px] text-[var(--color-danger, #ef4444)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors py-1"
        >
          Clear All
        </button>
      )}
    </div>
  );
}

// ─── Main InspectorPanel ──────────────────────────────────────────

export function InspectorPanel() {
  const { workspaces, activeWorkspaceId } = useWorkspacesStore();
  const tabs = useTabsStore((s) => s.tabs);
  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);
  const activeTabId = activeTab?.id ?? null;

  const activeSubTab = useInspectorStore((s) => s.activeSubTab);
  const isLoading = useInspectorStore((s) => s.isLoading);
  const error = useInspectorStore((s) => s.error);
  const meta = useInspectorStore((s) => s.meta);
  const cookies = useInspectorStore((s) => s.cookies);
  const localStorageItems = useInspectorStore((s) => s.localStorageItems);

  const [storageSubTab, setStorageSubTab] = useState<
    "localStorage" | "sessionStorage"
  >("localStorage");

  const refresh = useCallback(
    (subTab: InspectorSubTab) => {
      if (!activeTabId) return;
      const store = useInspectorStore.getState();
      const type =
        subTab === "storage"
          ? storageSubTab
          : subTab;
      store.setIsLoading(true);
      evalInspector(activeTabId, type as "meta" | "cookies" | "localStorage" | "sessionStorage").catch(
        (e) => {
          const s = useInspectorStore.getState();
          s.setError(String(e));
          s.setIsLoading(false);
        }
      );
    },
    [activeTabId, storageSubTab]
  );

  // Refresh on active tab or subtab change — clear stale data on tab switch
  useEffect(() => {
    if (!activeTabId || !activeTab?.url) return;
    const store = useInspectorStore.getState();
    if (store.lastTabId !== activeTabId) {
      store.clearAll();
      store.setIsLoading(true);
      store.setLastTabId(activeTabId);
    }
    refresh(activeSubTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, activeSubTab, storageSubTab]);

  // Auto-refresh every 3 seconds
  useEffect(() => {
    if (!activeTabId || !activeTab?.url) return;
    const id = setInterval(() => {
      refresh(activeSubTab);
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, activeTab?.url, activeSubTab, storageSubTab]);

  // Safety net: force isLoading false after 5 seconds if stuck
  useEffect(() => {
    if (!isLoading) return;
    const timeout = setTimeout(() => {
      const s = useInspectorStore.getState();
      if (s.isLoading) {
        s.setIsLoading(false);
        s.setError("Inspector request timed out");
      }
    }, 5000);
    return () => clearTimeout(timeout);
  }, [isLoading]);

  if (!activeTabId || !activeTab?.url) {
    return (
      <div className="flex items-center justify-center h-full px-4">
        <div className="text-center">
          <Globe
            size={28}
            className="mx-auto mb-2 text-[var(--color-text-disabled)]"
          />
          <p className="text-[12px] text-[var(--color-text-muted)]">
            Navigate to a page to use the Inspector.
          </p>
        </div>
      </div>
    );
  }

  const subTabs: { key: InspectorSubTab; label: string }[] = [
    { key: "meta", label: "META" },
    { key: "cookies", label: "COOKIES" },
    { key: "storage", label: "STORAGE" },
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Sub-tab strip */}
      <div className="h-8 flex items-center border-b border-[var(--color-border-subtle)] flex-shrink-0">
        <div className="flex items-center flex-1">
          {subTabs.map((st) => (
            <button
              key={st.key}
              onClick={() => useInspectorStore.getState().setActiveSubTab(st.key)}
              className={`text-[12px] font-semibold uppercase tracking-wide px-2 py-1.5 cursor-pointer transition-colors ${
                activeSubTab === st.key
                  ? "text-[var(--color-text-primary)] border-b-2 border-[var(--color-accent)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => refresh(activeSubTab)}
          title="Refresh inspector data"
          className="px-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
        >
          <RotateCw
            size={12}
            className={isLoading ? "animate-spin" : ""}
          />
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-2 py-1 text-[12px] text-[#f59e0b] bg-[#f59e0b]/10 border-b border-[#f59e0b]/30 flex items-center gap-2">
          <span className="shrink-0">⚠</span>
          <span className="flex-1 truncate">{error}</span>
          <button
            onClick={() => refresh(activeSubTab)}
            className="text-[var(--color-accent)] hover:text-[var(--color-text-primary)] cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading state (first load) */}
        {isLoading &&
          !meta &&
          cookies.length === 0 &&
          localStorageItems.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <RotateCw
                size={20}
                className="animate-spin text-[var(--color-accent)]"
              />
            </div>
          )}

        {/* Meta sub-tab */}
        {activeSubTab === "meta" && <MetaSubTab />}

        {/* Cookies sub-tab */}
        {activeSubTab === "cookies" && (
          <CookiesSubTab tabId={activeTabId} />
        )}

        {/* Storage sub-tab */}
        {activeSubTab === "storage" && (
          <StorageSubTab
            tabId={activeTabId}
            storageSubTab={storageSubTab}
            setStorageSubTab={setStorageSubTab}
          />
        )}
      </div>
    </div>
  );
}
