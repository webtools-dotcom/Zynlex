import { useState, useEffect, useCallback } from "react";
import {
  Globe,
  RotateCw,
  CheckCircle2,
  XCircle,
  ClipboardCheck,
} from "lucide-react";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { useInspectorStore } from "@/stores/inspector";
import { evalInspector, inspectorMutate } from "@/services/browser";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";
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
        <ClipboardCheck size={10} className="text-[var(--color-success, #22c55e)]" />
      ) : (
        <span className="text-[9px]">copy</span>
      )}
    </button>
  );
}

// ─── META Sub-tab ──────────────────────────────────────────────────

const SEO_CHECKS = [
  { label: "Page title", test: (m: { title: string }) => !!m.title },
  {
    label: "Meta description",
    test: (m: { metas: Array<{ name: string }> }) =>
      m.metas.some((t) => t.name === "description"),
  },
  {
    label: "og:title",
    test: (m: { metas: Array<{ name: string }> }) =>
      m.metas.some(
        (t) => t.name === "og:title" || (t as unknown as Record<string, string>).property === "og:title"
      ),
  },
  {
    label: "og:description",
    test: (m: { metas: Array<{ name: string }> }) =>
      m.metas.some(
        (t) =>
          t.name === "og:description" ||
          (t as unknown as Record<string, string>).property === "og:description"
      ),
  },
  {
    label: "og:image",
    test: (m: { metas: Array<{ name: string }> }) =>
      m.metas.some(
        (t) =>
          t.name === "og:image" ||
          (t as unknown as Record<string, string>).property === "og:image"
      ),
  },
  {
    label: "twitter:card",
    test: (m: { metas: Array<{ name: string }> }) =>
      m.metas.some((t) => t.name === "twitter:card"),
  },
];

function MetaSubTab() {
  const meta = useInspectorStore((s) => s.meta);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set()
  );

  if (!meta) return null;

  const passed = SEO_CHECKS.filter((c) => c.test(meta)).length;

  const seoGroup = meta.metas.filter((m) =>
    ["description", "keywords", "robots", "googlebot", "author"].includes(
      m.name
    )
  );
  const ogGroup = meta.metas.filter(
    (m) => m.name.startsWith("og:") || (m as unknown as Record<string, string>).property?.startsWith("og:")
  );
  const twitterGroup = meta.metas.filter((m) => m.name.startsWith("twitter:"));
  const otherGroup = meta.metas.filter(
    (m) =>
      !seoGroup.includes(m) && !ogGroup.includes(m) && !twitterGroup.includes(m)
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

  return (
    <div className="px-2 py-1">
      {/* SEO Score */}
      <div className="mb-2">
        <p className="text-[11px] text-[var(--color-text-muted)] mb-1">
          {passed} / {SEO_CHECKS.length} checks passed
        </p>
        <div className="space-y-0.5">
          {SEO_CHECKS.map((check) => {
            const ok = check.test(meta);
            return (
              <div key={check.label} className="flex items-center gap-1.5">
                {ok ? (
                  <CheckCircle2
                    size={12}
                    className="text-[var(--color-success, #22c55e)] shrink-0"
                  />
                ) : (
                  <XCircle
                    size={12}
                    className="text-[var(--color-danger, #ef4444)] shrink-0"
                  />
                )}
                <span className="text-[11px] text-[var(--color-text-primary)]">
                  {check.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Canonical */}
      {meta.canonical && (
        <div className="mb-2 text-[11px]">
          <span className="text-[var(--color-text-muted)]">Canonical: </span>
          <a
            href={meta.canonical}
            className="text-[var(--color-accent)] hover:underline font-mono text-[10px] break-all"
          >
            {meta.canonical}
          </a>
        </div>
      )}

      {/* Meta Groups */}
      {groups.map((group) => (
        <div key={group.key} className="mb-2">
          <button
            onClick={() => toggleGroup(group.key)}
            className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] cursor-pointer w-full text-left py-0.5"
          >
            <span>{collapsedGroups.has(group.key) ? "▸" : "▾"}</span>
            <span>{group.label}</span>
            <span className="text-[var(--color-text-disabled)]">
              ({group.items.length})
            </span>
          </button>
          {!collapsedGroups.has(group.key) && (
            <div className="ml-2">
              {group.items.map((item, i) => {
                const name =
                  item.name ||
                  (item as unknown as Record<string, string>).property ||
                  "";
                return (
                  <div
                    key={`${group.key}-${i}`}
                    className="group flex items-start gap-2 py-0.5"
                  >
                    <span className="w-[30%] shrink-0 text-[10px] font-mono text-[var(--color-text-muted)] truncate">
                      {name}
                    </span>
                    <span className="flex-1 min-w-0 text-[10px] font-mono text-[var(--color-text-primary)] break-all line-clamp-3">
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
      });
    },
    [tabId, doRefresh]
  );

  const handleSave = useCallback(
    (name: string, value: string) => {
      inspectorMutate(tabId, "set-cookie", { name, value }).then(() => {
        setTimeout(doRefresh, 300);
        setExpandedIdx(null);
      });
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
    });
  }, [tabId, addName, addValue, doRefresh]);

  const handleClearAll = useCallback(() => {
    if (!window.confirm("Clear all non-HttpOnly cookies?")) return;
    inspectorMutate(tabId, "clear-cookies", {}).then(() => {
      setTimeout(doRefresh, 300);
    });
  }, [tabId, doRefresh]);

  return (
    <div className="px-2 py-1">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-[var(--color-text-muted)]">
          {cookies.length} cookie{cookies.length !== 1 ? "s" : ""}
        </span>
        <button
          onClick={handleClearAll}
          className="text-[10px] text-[var(--color-danger, #ef4444)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
        >
          Clear All
        </button>
      </div>

      {/* Warning */}
      <div className="text-[10px] text-[#f59e0b] bg-[#f59e0b]/10 border border-[#f59e0b]/30 rounded p-1.5 mb-2">
        HttpOnly cookies are not shown — they are inaccessible to JavaScript for security reasons.
      </div>

      {/* Cookie list */}
      {cookies.length === 0 ? (
        <p className="text-[11px] text-[var(--color-text-disabled)] italic text-center py-4">
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
              <span className="text-[11px] font-mono font-medium text-[var(--color-text-primary)]">
                {cookie.name}
              </span>
              <span className="text-[10px] font-mono text-[var(--color-text-muted)] truncate max-w-[120px]">
                {cookie.value}
              </span>
              <CopyIcon text={`${cookie.name}=${cookie.value}`} />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(cookie.name);
                }}
                className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-danger, #ef4444)] cursor-pointer transition-all"
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
                  className="w-full mt-1 px-2 py-1 text-[10px] font-mono rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] resize-none"
                />
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => handleSave(cookie.name, editValue)}
                    className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-accent)] text-white cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setExpandedIdx(null)}
                    className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
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
          className="mt-2 text-[10px] text-[var(--color-accent)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
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
            className="w-full h-6 px-2 text-[10px] rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] mb-1"
          />
          <textarea
            rows={2}
            placeholder="Cookie value"
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
            className="w-full px-2 py-1 text-[10px] font-mono rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] resize-none mb-1"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!addName.trim()}
              className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-accent)] text-white disabled:opacity-40 cursor-pointer"
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setAddName("");
                setAddValue("");
              }}
              className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
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
      });
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
      });
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
    });
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
    });
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
            className={`text-[10px] cursor-pointer transition-colors ${
              storageSubTab === "localStorage"
                ? "text-[var(--color-text-primary)] border-b border-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            Local Storage
          </button>
          <button
            onClick={() => setStorageSubTab("sessionStorage")}
            className={`text-[10px] cursor-pointer transition-colors ${
              storageSubTab === "sessionStorage"
                ? "text-[var(--color-text-primary)] border-b border-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            }`}
          >
            Session Storage
          </button>
        </div>
        <span className="text-[10px] text-[var(--color-text-disabled)]">
          Using {formatBytes(totalSize)}
        </span>
      </div>

      {/* Items */}
      {items.length === 0 ? (
        <p className="text-[11px] text-[var(--color-text-disabled)] italic text-center py-4">
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
              <span className="text-[11px] font-mono font-medium text-[var(--color-text-primary)] truncate max-w-[100px]">
                {item.key}
              </span>
              <span className="flex-1 min-w-0 text-[10px] font-mono text-[var(--color-text-muted)] truncate">
                {formatValue(item.value).split("\n")[0]}
              </span>
              <CopyIcon text={item.value} />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(item.key);
                }}
                className="opacity-0 group-hover:opacity-100 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-danger, #ef4444)] cursor-pointer transition-all"
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
                  className="w-full mt-1 px-2 py-1 text-[10px] font-mono rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] resize-none"
                />
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => handleSave(item.key, editValue)}
                    className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-accent)] text-white cursor-pointer"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setExpandedIdx(null)}
                    className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
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
          className="mt-2 text-[10px] text-[var(--color-accent)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
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
            className="w-full h-6 px-2 text-[10px] rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] mb-1"
          />
          <textarea
            rows={3}
            placeholder="Value"
            value={addValue}
            onChange={(e) => setAddValue(e.target.value)}
            className="w-full px-2 py-1 text-[10px] font-mono rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)] resize-none mb-1"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!addKey.trim()}
              className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-accent)] text-white disabled:opacity-40 cursor-pointer"
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowAdd(false);
                setAddKey("");
                setAddValue("");
              }}
              className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
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
          className="mt-2 w-full text-[10px] text-[var(--color-danger, #ef4444)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors py-1"
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

  const inspectorStore = useInspectorStore();
  const [storageSubTab, setStorageSubTab] = useState<
    "localStorage" | "sessionStorage"
  >("localStorage");

  const refresh = useCallback(
    (subTab: InspectorSubTab) => {
      if (!activeTabId) return;
      const type =
        subTab === "storage"
          ? storageSubTab
          : subTab;
      inspectorStore.setIsLoading(true);
      evalInspector(activeTabId, type as "meta" | "cookies" | "localStorage" | "sessionStorage").catch(
        (e) => {
          inspectorStore.setError(String(e));
          inspectorStore.setIsLoading(false);
        }
      );
    },
    [activeTabId, storageSubTab, inspectorStore]
  );

  // Refresh on active tab or subtab change
  useEffect(() => {
    if (!activeTabId || !activeTab?.url) return;
    refresh(inspectorStore.activeSubTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, inspectorStore.activeSubTab]);

  // Auto-refresh every 3 seconds
  useEffect(() => {
    if (!activeTabId || !activeTab?.url) return;
    const id = setInterval(() => {
      refresh(inspectorStore.activeSubTab);
    }, 3000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, activeTab?.url, inspectorStore.activeSubTab]);

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
              onClick={() => inspectorStore.setActiveSubTab(st.key)}
              className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1.5 cursor-pointer transition-colors ${
                inspectorStore.activeSubTab === st.key
                  ? "text-[var(--color-text-primary)] border-b-2 border-[var(--color-accent)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => refresh(inspectorStore.activeSubTab)}
          title="Refresh inspector data"
          className="px-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
        >
          <RotateCw
            size={12}
            className={inspectorStore.isLoading ? "animate-spin" : ""}
          />
        </button>
      </div>

      {/* Error banner */}
      {inspectorStore.error && (
        <div className="px-2 py-1 text-[10px] text-[#f59e0b] bg-[#f59e0b]/10 border-b border-[#f59e0b]/30 flex items-center gap-2">
          <span className="shrink-0">⚠</span>
          <span className="flex-1 truncate">{inspectorStore.error}</span>
          <button
            onClick={() => refresh(inspectorStore.activeSubTab)}
            className="text-[var(--color-accent)] hover:text-[var(--color-text-primary)] cursor-pointer shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading state (first load) */}
        {inspectorStore.isLoading &&
          !inspectorStore.meta &&
          inspectorStore.cookies.length === 0 &&
          inspectorStore.localStorageItems.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <RotateCw
                size={20}
                className="animate-spin text-[var(--color-accent)]"
              />
            </div>
          )}

        {/* Meta sub-tab */}
        {inspectorStore.activeSubTab === "meta" && <MetaSubTab />}

        {/* Cookies sub-tab */}
        {inspectorStore.activeSubTab === "cookies" && (
          <CookiesSubTab tabId={activeTabId} />
        )}

        {/* Storage sub-tab */}
        {inspectorStore.activeSubTab === "storage" && (
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
