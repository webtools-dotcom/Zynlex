import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpFromLine,
  ChevronDown,
  Keyboard,
  Monitor,
  MousePointer2,
  Plus,
  RotateCw,
  Smartphone,
  Tablet,
  X,
  ZoomIn,
  AlertTriangle,
  Check,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";
import {
  DEVICE_PRESETS,
  type DevicePreset,
} from "@/components/panels/ViewportPresets";
import {
  createViewport,
  destroyViewport,
  evalRaw,
  resizeViewport,
  showViewport,
  hideViewport,
} from "@/services/browser";
import { listen } from "@tauri-apps/api/event";

const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  mobile: Smartphone,
  tablet: Tablet,
  laptop: Monitor,
};

const ZOOM_OPTIONS = [0.25, 0.33, 0.5, 0.67, 0.75, 1] as const;

function viewportLabel(id: string): string {
  return `viewport-${id}`;
}

function escapeSingleQuotedJs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildViewportSetupScript(label: string): string {
  const labelEsc = escapeSingleQuotedJs(label);
  return [
    "window.__XEVO_VIEWPORT_LABEL = '" + labelEsc + "';",
    "(function(){",
    "  if (window.__xevoVpScrollInited) return;",
    "  window.__xevoVpScrollInited = true;",
    "  var ticking = false;",
    '  document.addEventListener("scroll", function() {',
    "    if (window.__xevoApplyingScrollSync) return;",
    "    if (ticking) return;",
    "    ticking = true;",
    "    requestAnimationFrame(function() {",
    "      ticking = false;",
    "      var el = document.scrollingElement || document.documentElement;",
    "      if (!el || !window.__TAURI_INTERNALS__ || !window.__TAURI_INTERNALS__.invoke) return;",
    "      var maxX = el.scrollWidth - el.clientWidth;",
    "      var maxY = el.scrollHeight - el.clientHeight;",
    "      window.__TAURI_INTERNALS__.invoke('notify_viewport_scroll', {",
    "        sourceLabel: '" + labelEsc + "',",
    "        percentX: maxX > 0 ? el.scrollLeft / maxX : 0,",
    "        percentY: maxY > 0 ? el.scrollTop / maxY : 0",
    "      }).catch(function(){});",
    "    });",
    "  }, { passive: true });",
    "})();",
    "(function(){",
    "  if (window.__xevoVpClickInited) return;",
    "  window.__xevoVpClickInited = true;",
    '  document.addEventListener("click", function(e) {',
    "    if (window.__xevoApplyingClickSync) return;",
    "    if (!window.__TAURI_INTERNALS__ || !window.__TAURI_INTERNALS__.invoke) return;",
    "    window.__TAURI_INTERNALS__.invoke('notify_viewport_click', {",
    "      sourceLabel: '" + labelEsc + "',",
    "      x: e.clientX,",
    "      y: e.clientY",
    "    }).catch(function(){});",
    "  }, { capture: true });",
    "})();",
    "(function(){",
    "  if (window.__xevoVpInputInited) return;",
    "  window.__xevoVpInputInited = true;",
    "  function buildSelector(el) {",
    "    if (el.id) return '#' + CSS.escape(el.id);",
    '    if (el.name) return el.tagName.toLowerCase() + \'[name="\' + CSS.escape(el.name) + \'"]\';',
    "    var path = [];",
    "    var cur = el;",
    "    while (cur && cur !== document.body) {",
    "      var idx = 1;",
    "      var sib = cur.previousElementSibling;",
    "      while (sib) {",
    "        if (sib.tagName === cur.tagName) idx++;",
    "        sib = sib.previousElementSibling;",
    "      }",
    "      path.unshift(cur.tagName.toLowerCase() + ':nth-of-type(' + idx + ')');",
    "      cur = cur.parentElement;",
    "    }",
    "    return path.join(' > ');",
    "  }",
    '  document.addEventListener("input", function(e) {',
    "    var t = e.target;",
    "    if (!t || !/^(input|textarea|select)$/i.test(t.tagName)) return;",
    "    if (!window.__TAURI_INTERNALS__ || !window.__TAURI_INTERNALS__.invoke) return;",
    "    window.__TAURI_INTERNALS__.invoke('notify_viewport_input', {",
    "      sourceLabel: '" + labelEsc + "',",
    "      selector: buildSelector(t),",
    "      value: t.value || '',",
    "      checked: t.type === 'checkbox' ? t.checked : null,",
    "      inputType: t.type || 'text'",
    "    }).catch(function(){});",
    "  }, { capture: true });",
    "})();",
  ].join("\n");
}

function buildMetricsProbeScript(label: string): string {
  const labelEsc = escapeSingleQuotedJs(label);
  return [
    "(function(){",
    "  if (!window.__TAURI_INTERNALS__ || !window.__TAURI_INTERNALS__.invoke) return;",
    "  window.__TAURI_INTERNALS__.invoke('notify_viewport_metrics', {",
    "    sourceLabel: '" + labelEsc + "',",
    "    innerWidth: window.innerWidth,",
    "    innerHeight: window.innerHeight,",
    "    devicePixelRatio: window.devicePixelRatio,",
    "    touch: 'ontouchstart' in window || navigator.maxTouchPoints > 0,",
    "    userAgent: navigator.userAgent",
    "  }).catch(function(){});",
    "})();",
  ].join("\n");
}

// ─── Metrics tracking ──────────────────────────────────────────────

interface ViewportMetrics {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  touch: boolean;
  userAgent: string;
}

// ─── ViewportControlsPanel (sidebar) ───────────────────────────────

export function ViewportControlsPanel() {
  const viewports = useUIStore((s) => s.viewports);
  const addViewport = useUIStore((s) => s.addViewport);
  const removeViewport = useUIStore((s) => s.removeViewport);
  const selectedViewportId = useUIStore((s) => s.selectedViewportId);
  const selectViewport = useUIStore((s) => s.selectViewport);
  const [selectedCategory, setSelectedCategory] = useState<string>("mobile");

  function addPreset(preset: DevicePreset) {
    addViewport(preset);
  }

  function remove(id: string) {
    destroyViewport(viewportLabel(id)).catch(() => {});
    removeViewport(id);
  }

  return (
    <div className="p-2">
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        <div className="flex items-center gap-0.5">
          {Object.entries(DEVICE_PRESETS).map(([key, presets]) => {
            const Icon = CATEGORY_ICONS[key] || Monitor;
            return (
              <div key={key} className="relative group">
                <button
                  onClick={() =>
                    setSelectedCategory(selectedCategory === key ? "" : key)
                  }
                  className={cn(
                    "w-7 h-7 flex items-center justify-center rounded text-[12px] transition-colors",
                    selectedCategory === key
                      ? "bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-disabled)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
                  )}
                  title={key.charAt(0).toUpperCase() + key.slice(1)}
                >
                  <Icon size={12} />
                </button>
                {selectedCategory === key && (
                  <div
                    className="absolute top-full left-0 mt-1 z-50 bg-[var(--color-surface)] border rounded py-1 min-w-[160px]"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    {presets.map((p) => (
                      <button
                        key={p.label}
                        onClick={() => addPreset(p)}
                        className="w-full text-left px-2 py-1 text-[12px] text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] transition-colors flex items-center gap-2"
                      >
                        <Plus size={12} className="shrink-0 opacity-50" />
                        <span>{p.label}</span>
                        <span className="ml-auto text-[11px] text-[var(--color-text-disabled)] font-mono">
                          {p.width}x{p.height}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <span className="text-[11px] text-[var(--color-text-disabled)] ml-auto">
          {viewports.length} viewport{viewports.length !== 1 ? "s" : ""}
        </span>
      </div>

      {viewports.length > 0 && (
        <div className="space-y-1">
          {viewports.map((vp) => (
            <div
              key={vp.id}
              onClick={() => selectViewport(vp.id)}
              className={cn(
                "flex items-center gap-2 px-2 py-1 rounded border cursor-pointer transition-colors",
                selectedViewportId === vp.id
                  ? "border-[var(--color-accent)]"
                  : "hover:bg-[var(--color-hover)]"
              )}
              style={{
                borderColor: selectedViewportId === vp.id ? undefined : "var(--color-border-subtle)",
                background: "var(--color-elevated)",
              }}
            >
              <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-text-muted)]">
                {vp.label}
              </span>
              <span className="text-[11px] font-mono text-[var(--color-text-disabled)]">
                {vp.width}x{vp.height}
              </span>
              <button
                onClick={(e) => { e.stopPropagation(); remove(vp.id); }}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-hover)] text-[var(--color-text-disabled)] hover:text-[var(--color-dead)] transition-colors"
                title="Remove viewport"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ViewportToolbar (inside surface) ──────────────────────────────

function ViewportToolbar() {
  const viewports = useUIStore((s) => s.viewports);
  const selectedViewportId = useUIStore((s) => s.selectedViewportId);
  const viewportZoom = useUIStore((s) => s.viewportZoom);
  const setViewportZoom = useUIStore((s) => s.setViewportZoom);
  const rotateViewport = useUIStore((s) => s.rotateViewport);
  const resizeViewportDimensions = useUIStore((s) => s.resizeViewportDimensions);
  const syncScroll = useUIStore((s) => s.syncScroll);
  const syncClick = useUIStore((s) => s.syncClick);
  const syncInput = useUIStore((s) => s.syncInput);
  const toggleSyncScroll = useUIStore((s) => s.toggleSyncScroll);
  const toggleSyncClick = useUIStore((s) => s.toggleSyncClick);
  const toggleSyncInput = useUIStore((s) => s.toggleSyncInput);

  const selected = viewports.find((v) => v.id === selectedViewportId);

  const [widthInput, setWidthInput] = useState("");
  const [heightInput, setHeightInput] = useState("");

  useEffect(() => {
    if (selected) {
      setWidthInput(String(selected.width));
      setHeightInput(String(selected.height));
    }
  }, [selected?.id, selected?.width, selected?.height]);

  function commitSize() {
    if (!selected) return;
    const w = parseInt(widthInput, 10);
    const h = parseInt(heightInput, 10);
    if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
      resizeViewportDimensions(selected.id, w, h);
    }
  }

  const btnCls = "w-8 h-8 flex items-center justify-center rounded text-[12px] transition-colors";
  const activeCls = "bg-[var(--color-accent-dim)] text-[var(--color-accent)]";
  const inactiveCls = "text-[var(--color-text-disabled)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]";

  return (
    <div
      className="flex items-center gap-1 px-2 py-1 flex-shrink-0 flex-wrap"
      style={{
        borderBottom: "1px solid var(--color-border-subtle)",
        background: "var(--color-surface)",
      }}
    >
      {/* Selected device label */}
      <span className="text-[12px] text-[var(--color-text-muted)] font-medium truncate max-w-[120px]">
        {selected ? selected.label : "No viewport"}
      </span>

      {selected && (
        <>
          {/* Divider */}
          <div className="w-px h-4 mx-0.5" style={{ background: "var(--color-border-subtle)" }} />

          {/* Width input */}
          <input
            type="number"
            value={widthInput}
            onChange={(e) => setWidthInput(e.target.value)}
            onBlur={commitSize}
            onKeyDown={(e) => { if (e.key === "Enter") commitSize(); }}
            className="w-12 h-7 text-[12px] text-center font-mono rounded border bg-transparent text-[var(--color-text-muted)]"
            style={{ borderColor: "var(--color-border-subtle)" }}
            min={120}
            max={3840}
          />
          <span className="text-[11px] text-[var(--color-text-disabled)]">×</span>
          {/* Height input */}
          <input
            type="number"
            value={heightInput}
            onChange={(e) => setHeightInput(e.target.value)}
            onBlur={commitSize}
            onKeyDown={(e) => { if (e.key === "Enter") commitSize(); }}
            className="w-12 h-7 text-[12px] text-center font-mono rounded border bg-transparent text-[var(--color-text-muted)]"
            style={{ borderColor: "var(--color-border-subtle)" }}
            min={120}
            max={3840}
          />

          {/* Rotate */}
          <button
            onClick={() => rotateViewport(selected.id)}
            className={cn(btnCls, inactiveCls)}
            title="Rotate orientation"
          >
            <RotateCw size={12} />
          </button>
        </>
      )}

      {/* Divider */}
      <div className="w-px h-4 mx-0.5" style={{ background: "var(--color-border-subtle)" }} />

      {/* Zoom */}
      <div className="relative flex items-center gap-0.5">
        <ZoomIn size={12} className="text-[var(--color-text-disabled)]" />
        <select
          value={viewportZoom}
          onChange={(e) => setViewportZoom(Number(e.target.value))}
          className="h-7 text-[12px] font-mono rounded border bg-transparent text-[var(--color-text-muted)] px-1 pr-4 appearance-none cursor-pointer"
          style={{ borderColor: "var(--color-border-subtle)" }}
        >
          {ZOOM_OPTIONS.map((z) => (
            <option key={z} value={z}>
              {Math.round(z * 100)}%
            </option>
          ))}
        </select>
        <ChevronDown size={11} className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--color-text-disabled)]" />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Sync toggles */}
      <button
        onClick={toggleSyncScroll}
        className={cn(btnCls, syncScroll ? activeCls : inactiveCls)}
        title={syncScroll ? "Scroll sync on" : "Scroll sync off"}
      >
        <ArrowUpFromLine size={12} />
      </button>
      <button
        onClick={toggleSyncClick}
        className={cn(btnCls, syncClick ? activeCls : inactiveCls)}
        title={syncClick ? "Click sync on" : "Click sync off"}
      >
        <MousePointer2 size={12} />
      </button>
      <button
        onClick={toggleSyncInput}
        className={cn(btnCls, syncInput ? activeCls : inactiveCls)}
        title={syncInput ? "Input sync on" : "Input sync off"}
      >
        <Keyboard size={12} />
      </button>
    </div>
  );
}

// ─── ViewportSurface (main area) ──────────────────────────────────

export function ViewportSurface() {
  const viewports = useUIStore((s) => s.viewports);
  const removeViewport = useUIStore((s) => s.removeViewport);
  const selectedViewportId = useUIStore((s) => s.selectedViewportId);
  const selectViewport = useUIStore((s) => s.selectViewport);
  const viewportZoom = useUIStore((s) => s.viewportZoom);
  const rotateViewport = useUIStore((s) => s.rotateViewport);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const { workspaces, activeWorkspaceId } = useWorkspacesStore();
  const tabs = useTabsStore((s) => s.tabs);
  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);
  const activeUrl = activeTab?.url || "about:blank";

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const createdLabelsRef = useRef<Set<string>>(new Set());
  const urlByLabelRef = useRef<Map<string, string>>(new Map());
  const setupTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<Map<string, ViewportMetrics>>(new Map());

  const setCardRef = useCallback(
    (id: string) => (node: HTMLDivElement | null) => {
      if (node) cardRefs.current.set(id, node);
      else cardRefs.current.delete(id);
    },
    []
  );

  const setupViewport = useCallback((label: string) => {
    const existing = setupTimersRef.current.get(label);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      setupTimersRef.current.delete(label);
      evalRaw(label, buildViewportSetupScript(label)).catch(() => {});
      // Run metrics probe after setup
      setTimeout(() => {
        evalRaw(label, buildMetricsProbeScript(label)).catch(() => {});
      }, 1000);
    }, 500);
    setupTimersRef.current.set(label, timer);
  }, []);
  // Listen for metrics events
  useEffect(() => {
    if (!IS_TAURI) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    listen<{ sourceLabel: string; innerWidth: number; innerHeight: number; devicePixelRatio: number; touch: boolean; userAgent: string }>(
      "viewport://metrics",
      (e) => {
        if (cancelled) return;
        const { sourceLabel, ...data } = e.payload;
        setMetrics((prev) => {
          const next = new Map(prev);
          next.set(sourceLabel, data);
          return next;
        });
      }
    ).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Check if a card's rect intersects the visible surface scroll area
  const isCardVisible = useCallback((node: HTMLDivElement, surface: HTMLDivElement): boolean => {
    const sr = surface.getBoundingClientRect();
    const cr = node.getBoundingClientRect();
    // Card must overlap the surface's visible area
    return (
      cr.bottom > sr.top &&
      cr.top < sr.bottom &&
      cr.right > sr.left &&
      cr.left < sr.right
    );
  }, []);

  const syncNativeViewports = useCallback(() => {
    if (!IS_TAURI) return;
    const surface = surfaceRef.current;

    const wanted = new Set(viewports.map((vp) => viewportLabel(vp.id)));
    for (const label of Array.from(createdLabelsRef.current)) {
      if (!wanted.has(label)) {
        destroyViewport(label).catch(() => {});
        createdLabelsRef.current.delete(label);
        urlByLabelRef.current.delete(label);
      }
    }

    for (const vp of viewports) {
      const node = cardRefs.current.get(vp.id);
      if (!node) continue;

      const label = viewportLabel(vp.id);

      // Visibility culling: hide off-screen viewport windows
      if (surface && !isCardVisible(node, surface)) {
        if (createdLabelsRef.current.has(label)) {
          hideViewport(label).catch(() => {});
        }
        continue;
      }

      const rect = node.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) continue;

      const x = Math.round(rect.left + window.screenX);
      const y = Math.round(rect.top + window.screenY);
      const width = Math.round(Math.max(1, rect.width));
      const height = Math.round(Math.max(1, rect.height));
      const url = vp.url || activeUrl;

      if (!createdLabelsRef.current.has(label) || urlByLabelRef.current.get(label) !== url) {
        if (createdLabelsRef.current.has(label)) {
          destroyViewport(label).catch(() => {});
          createdLabelsRef.current.delete(label);
          urlByLabelRef.current.delete(label);
        }
        createViewport(label, url, x, y, width, height)
          .then(() => {
            createdLabelsRef.current.add(label);
            urlByLabelRef.current.set(label, url);
            setupViewport(label);
          })
          .catch(() => {});
      } else {
        resizeViewport(label, x, y, width, height).catch(() => {});
        // Re-show in case it was hidden
        showViewport(label).catch(() => {});
      }
    }
  }, [activeUrl, setupViewport, viewports, viewportZoom, isCardVisible]);

  useEffect(() => {
    const timer = setTimeout(syncNativeViewports, 50);
    return () => clearTimeout(timer);
  }, [syncNativeViewports, sidebarOpen, sidebarWidth]);

  useEffect(() => {
    if (!IS_TAURI) return;
    const observer = new ResizeObserver(() => syncNativeViewports());
    observer.observe(document.documentElement);
    if (surfaceRef.current) observer.observe(surfaceRef.current);
    for (const node of cardRefs.current.values()) observer.observe(node);

    let cancelled = false;
    let unmove: (() => void) | null = null;
    let unresize: (() => void) | null = null;
    getCurrentWindow()
      .onMoved(() => setTimeout(syncNativeViewports, 16))
      .then((fn) => {
        if (cancelled) fn();
        else unmove = fn;
      });
    getCurrentWindow()
      .onResized(() => setTimeout(syncNativeViewports, 50))
      .then((fn) => {
        if (cancelled) fn();
        else unresize = fn;
      });

    return () => {
      cancelled = true;
      observer.disconnect();
      unmove?.();
      unresize?.();
    };
  }, [syncNativeViewports]);

  useEffect(() => {
    return () => {
      for (const timer of setupTimersRef.current.values()) clearTimeout(timer);
      setupTimersRef.current.clear();
      for (const label of createdLabelsRef.current) {
        destroyViewport(label).catch(() => {});
      }
      createdLabelsRef.current.clear();
      urlByLabelRef.current.clear();
    };
  }, []);

  function remove(id: string) {
    const label = viewportLabel(id);
    destroyViewport(label).catch(() => {});
    createdLabelsRef.current.delete(label);
    urlByLabelRef.current.delete(label);
    removeViewport(id);
  }

  function getMetricsBadge(vp: typeof viewports[0]) {
    const label = viewportLabel(vp.id);
    const m = metrics.get(label);
    if (!m) return null;

    // At zoom != 1, native webview is scaled, so innerWidth/Height won't match preset
    const zoomedW = Math.round(vp.width * viewportZoom);
    const zoomedH = Math.round(vp.height * viewportZoom);
    const widthMatch = Math.abs(m.innerWidth - zoomedW) <= 2;
    const heightMatch = Math.abs(m.innerHeight - zoomedH) <= 2;
    const matches = widthMatch && heightMatch;
    const zoomWarning = viewportZoom < 1;

    if (matches && !zoomWarning) {
      return (
        <span className="flex items-center gap-0.5 text-[11px] text-green-400" title={`Actual: ${m.innerWidth}×${m.innerHeight} DPR:${m.devicePixelRatio}`}>
          <Check size={11} />
        </span>
      );
    }

    const tooltip = zoomWarning
      ? `Zoom ${Math.round(viewportZoom * 100)}% — page sees ${m.innerWidth}×${m.innerHeight} instead of ${vp.width}×${vp.height}`
      : `Expected ${zoomedW}×${zoomedH}, actual ${m.innerWidth}×${m.innerHeight}`;

    return (
      <span className="flex items-center gap-0.5 text-[11px] text-amber-400" title={tooltip}>
        <AlertTriangle size={11} />
      </span>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <ViewportToolbar />
      <div
        ref={surfaceRef}
        className="flex-1 min-h-0 overflow-auto p-3"
        onScroll={syncNativeViewports}
      >
        {viewports.length === 0 ? (
          <div className="text-center py-8">
            <Monitor
              size={24}
              className="mx-auto mb-2 text-[var(--color-text-disabled)] opacity-30"
            />
            <p className="text-[11px] text-[var(--color-text-muted)]">
              No viewports
            </p>
            <p className="text-[12px] text-[var(--color-text-disabled)] mt-1">
              Click a device preset in the sidebar to add one
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-start gap-4">
            {viewports.map((vp) => {
              const scaledW = Math.round(vp.width * viewportZoom);
              const scaledH = Math.round(vp.height * viewportZoom);
              const isSelected = selectedViewportId === vp.id;

              return (
                <div
                  key={vp.id}
                  onClick={() => selectViewport(vp.id)}
                  className={cn(
                    "flex flex-col rounded overflow-hidden shrink-0 cursor-pointer transition-shadow",
                    isSelected && "ring-1 ring-[var(--color-accent)]"
                  )}
                  style={{
                    width: scaledW,
                    maxWidth: "100%",
                    border: isSelected
                      ? "1px solid var(--color-accent)"
                      : "1px solid var(--color-border)",
                    background: "var(--color-elevated)",
                  }}
                >
                  {/* Card header */}
                  <div
                    className="flex items-center gap-1 px-2 py-1 text-[12px] flex-shrink-0"
                    style={{
                      background: "var(--color-surface)",
                      borderBottom: "1px solid var(--color-border-subtle)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    <span className="font-medium truncate">{vp.label}</span>
                    <span className="text-[11px] font-mono text-[var(--color-text-disabled)]">
                      {vp.width}×{vp.height}
                    </span>
                    {/* Metrics badge */}
                    {getMetricsBadge(vp)}
                    {/* Zoom warning */}
                    {viewportZoom < 1 && (
                      <span className="text-[11px] text-[var(--color-text-disabled)]">
                        @{Math.round(viewportZoom * 100)}%
                      </span>
                    )}
                    {/* Rotate */}
                    <button
                      onClick={(e) => { e.stopPropagation(); rotateViewport(vp.id); }}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-hover)] text-[var(--color-text-disabled)] hover:text-[var(--color-text-muted)] transition-colors"
                      title="Rotate"
                    >
                      <RotateCw size={11} />
                    </button>
                    {/* Remove */}
                    <button
                      onClick={(e) => { e.stopPropagation(); remove(vp.id); }}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-hover)] text-[var(--color-text-disabled)] hover:text-[var(--color-dead)] transition-colors ml-auto"
                      title="Remove viewport"
                    >
                      <X size={12} />
                    </button>
                  </div>
                  {/* Card body — native webview overlays this */}
                  <div
                    ref={setCardRef(vp.id)}
                    className="relative"
                    style={{
                      width: "100%",
                      height: scaledH,
                      minHeight: 120,
                      overflow: "hidden",
                    }}
                  >
                    <div className="absolute inset-0 flex items-center justify-center text-[12px] text-[var(--color-text-disabled)] pointer-events-none">
                      {vp.url || activeUrl}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export const ViewportPanel = ViewportControlsPanel;
