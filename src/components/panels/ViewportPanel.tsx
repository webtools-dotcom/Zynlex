import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpFromLine,
  ChevronDown,
  Columns3,
  Keyboard,
  Monitor,
  MousePointer2,
  Plus,
  RotateCw,
  Smartphone,
  Square,
  Tablet,
  X,
  ZoomIn,
  AlertTriangle,
  Check,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { useUIStore, type Viewport } from "@/stores/ui";
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
  emulateViewport,
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

const ZOOM_OPTIONS = ["fit", 0.25, 0.33, 0.5, 0.67, 0.75, 1] as const;

/** Surface `p-3` padding and `gap-4` between cards. */
const SURFACE_PAD = 12;
const CARD_GAP = 16;
/** Card header + borders, until a real card can be measured. Font-size driven,
 *  so it is not a constant — compact mode shrinks it. */
const CARD_CHROME_FALLBACK = 34;

/**
 * Fit scale: the surface never scrolls, because these frames are native child
 * webviews of the main window and clip to the *window*, not to any DOM scroll
 * container — a partly-scrolled frame would draw over the toolbar and sidebar.
 * So instead of clipping, everything is scaled to fit in one row.
 *
 * Always measured against the **whole device list**, never just the visible one.
 * Scaling each device individually to fill the panel made every phone render at
 * the same on-screen size — a 360×780 and a 430×932 both ended up ~700px tall,
 * so switching devices looked like nothing happened. One shared scale, sized to
 * the largest device, is what makes the size differences visible.
 */
function fitZoom(
  all: { width: number; height: number }[],
  box: { width: number; height: number },
  cardChrome: number,
  layout: "focus" | "overview"
): number {
  if (all.length === 0 || box.width === 0 || box.height === 0) return 1;
  // Focus shows one frame at a time, so it only needs room for the widest.
  const overview = layout === "overview";
  const needW = overview
    ? all.reduce((n, vp) => n + vp.width, 0)
    : Math.max(...all.map((vp) => vp.width));
  const needH = Math.max(...all.map((vp) => vp.height));
  // Gaps are fixed pixels — they don't scale, so they come off the available
  // width rather than being divided into it (that overflows by a few px).
  const gaps = overview ? CARD_GAP * (all.length - 1) : 0;
  const availW = box.width - SURFACE_PAD * 2 - gaps;
  const availH = box.height - SURFACE_PAD * 2 - cardChrome;
  return Math.max(0.15, Math.min(1, availW / needW, availH / needH));
}

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
                    "w-7 h-7 flex items-center justify-center rounded text-xs transition-colors",
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
                        className="w-full text-left px-2 py-1 text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-hover)] transition-colors flex items-center gap-2"
                      >
                        <Plus size={12} className="shrink-0 opacity-50" />
                        <span>{p.label}</span>
                        <span className="ml-auto text-micro text-[var(--color-text-disabled)] font-mono">
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

        <span className="text-micro text-[var(--color-text-disabled)] ml-auto">
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
              <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-text-muted)]">
                {vp.label}
              </span>
              <span className="text-micro font-mono text-[var(--color-text-disabled)]">
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
  const viewportLayout = useUIStore((s) => s.viewportLayout);
  const setViewportLayout = useUIStore((s) => s.setViewportLayout);
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

  const btnCls = "w-8 h-8 flex items-center justify-center rounded text-xs transition-colors";
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
      <span className="text-xs text-[var(--color-text-muted)] font-medium truncate max-w-[120px]">
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
            className="w-12 h-7 text-xs text-center font-mono rounded border bg-transparent text-[var(--color-text-muted)]"
            style={{ borderColor: "var(--color-border-subtle)" }}
            min={120}
            max={3840}
          />
          <span className="text-micro text-[var(--color-text-disabled)]">×</span>
          {/* Height input */}
          <input
            type="number"
            value={heightInput}
            onChange={(e) => setHeightInput(e.target.value)}
            onBlur={commitSize}
            onKeyDown={(e) => { if (e.key === "Enter") commitSize(); }}
            className="w-12 h-7 text-xs text-center font-mono rounded border bg-transparent text-[var(--color-text-muted)]"
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

      {/* Focus / Overview. Focus is the default — one device fits at ~90%,
          three at ~47%, which is too small to actually work in. */}
      <button
        onClick={() => setViewportLayout("focus")}
        className={cn(btnCls, viewportLayout === "focus" ? activeCls : inactiveCls)}
        title="Focus — one device at a time"
      >
        <Square size={12} />
      </button>
      <button
        onClick={() => setViewportLayout("overview")}
        className={cn(btnCls, viewportLayout === "overview" ? activeCls : inactiveCls)}
        title="Overview — all devices side by side"
      >
        <Columns3 size={12} />
      </button>

      {/* Divider */}
      <div className="w-px h-4 mx-0.5" style={{ background: "var(--color-border-subtle)" }} />

      {/* Zoom */}
      <div className="relative flex items-center gap-0.5">
        <ZoomIn size={12} className="text-[var(--color-text-disabled)]" />
        <select
          value={viewportZoom}
          onChange={(e) =>
            setViewportZoom(e.target.value === "fit" ? "fit" : Number(e.target.value))
          }
          className="h-7 text-xs font-mono rounded border bg-transparent text-[var(--color-text-muted)] px-1 pr-4 appearance-none cursor-pointer"
          style={{ borderColor: "var(--color-border-subtle)" }}
        >
          {ZOOM_OPTIONS.map((z) => (
            <option key={z} value={z}>
              {z === "fit" ? "Fit" : `${Math.round(z * 100)}%`}
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
  const viewportLayout = useUIStore((s) => s.viewportLayout);
  const setViewportLayout = useUIStore((s) => s.setViewportLayout);
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
  const emulationByLabelRef = useRef<Map<string, string>>(new Map());
  const setupTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<Map<string, ViewportMetrics>>(new Map());
  const [surfaceBox, setSurfaceBox] = useState({ width: 0, height: 0 });
  const [cardChrome, setCardChrome] = useState(CARD_CHROME_FALLBACK);

  // Focus mode renders the selected device only, which is what makes the fit
  // scale usable — one phone fits at ~90%, three at ~47%. Falls back to the
  // first viewport so focus is never blank.
  const visible =
    viewportLayout === "focus"
      ? viewports.filter((vp) => vp.id === (selectedViewportId ?? viewports[0]?.id))
      : viewports;

  // Capped at fit even when a larger zoom is picked: the surface doesn't
  // scroll, so anything past its edge is both unreachable and drawn over the
  // browser chrome (these are native child webviews — they don't clip to the
  // panel). The card header's @N% chip reports the scale actually used.
  const fit = fitZoom(viewports, surfaceBox, cardChrome, viewportLayout);
  const effectiveZoom = viewportZoom === "fit" ? fit : Math.min(viewportZoom, fit);

  // Which viewports are rendered, as a stable dep. Switching between two
  // devices of identical dimensions changes neither `viewports` nor the zoom,
  // so without this the sync never fires and the old webview stays on screen.
  const visibleKey = visible.map((vp) => vp.id).join(",");

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

  // Keyed on the whole device signature, not just the scale — rotating swaps
  // width/height and must re-emulate, which a zoom-only check would miss.
  const applyEmulation = useCallback(
    (label: string, vp: Viewport, scale: number) => {
      const sig = `${vp.width}x${vp.height}:${vp.deviceScaleFactor}:${vp.mobile}:${vp.touch}:${scale}:${vp.userAgent ?? ""}`;
      if (emulationByLabelRef.current.get(label) === sig) return;
      emulationByLabelRef.current.set(label, sig);
      emulateViewport(label, {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: vp.deviceScaleFactor,
        mobile: vp.mobile,
        touch: vp.touch,
        scale,
        userAgent: vp.userAgent,
      }).catch(() => {});
    },
    []
  );

  const syncNativeViewports = useCallback(() => {
    if (!IS_TAURI) return;
    const surface = surfaceRef.current;

    const wanted = new Set(viewports.map((vp) => viewportLabel(vp.id)));
    for (const label of Array.from(createdLabelsRef.current)) {
      if (!wanted.has(label)) {
        destroyViewport(label).catch(() => {});
        createdLabelsRef.current.delete(label);
        urlByLabelRef.current.delete(label);
        emulationByLabelRef.current.delete(label);
      }
    }

    for (const vp of viewports) {
      const node = cardRefs.current.get(vp.id);
      const label = viewportLabel(vp.id);

      // No card = not rendered (focus mode hides every unselected device). The
      // webview isn't destroyed — hiding keeps the page and its scroll position
      // alive for switching back — but it MUST be hidden, or it stays painted
      // on top of the focused one.
      if (!node) {
        if (createdLabelsRef.current.has(label)) {
          hideViewport(label).catch(() => {});
        }
        continue;
      }

      // Visibility culling: hide off-screen viewport windows
      if (surface && !isCardVisible(node, surface)) {
        if (createdLabelsRef.current.has(label)) {
          hideViewport(label).catch(() => {});
        }
        continue;
      }

      const rect = node.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) continue;

      // Window-relative, not screen: viewport webviews are child webviews
      // (Rust create_viewport uses Window::add_child), so Tauri positions
      // them against the main window's client area — which is the same
      // space getBoundingClientRect() already reports in.
      const x = Math.round(rect.left);
      const y = Math.round(rect.top);
      const width = Math.round(Math.max(1, rect.width));
      const height = Math.round(Math.max(1, rect.height));
      const url = vp.url || activeUrl;

      if (!createdLabelsRef.current.has(label) || urlByLabelRef.current.get(label) !== url) {
        if (createdLabelsRef.current.has(label)) {
          destroyViewport(label).catch(() => {});
          createdLabelsRef.current.delete(label);
          urlByLabelRef.current.delete(label);
          emulationByLabelRef.current.delete(label);
        }
        createViewport(label, url, x, y, width, height)
          .then(() => {
            createdLabelsRef.current.add(label);
            urlByLabelRef.current.set(label, url);
            applyEmulation(label, vp, effectiveZoom);
            setupViewport(label);
          })
          .catch(() => {});
      } else {
        resizeViewport(label, x, y, width, height).catch(() => {});
        applyEmulation(label, vp, effectiveZoom);
        // Re-show in case it was hidden
        showViewport(label).catch(() => {});
      }
    }
  }, [activeUrl, setupViewport, viewports, effectiveZoom, visibleKey, isCardVisible]);

  // Surface size drives the fit scale, so it must never go stale — a stale box
  // means frames sized for the old surface, i.e. the overflow this fixes. Fed
  // by the observer plus every other signal that already moves this layout
  // (mount, sidebar, window resize); each is a cheap no-op when nothing moved.
  const measureSurface = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const r = surface.getBoundingClientRect();
    setSurfaceBox((prev) =>
      Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1
        ? prev
        : { width: r.width, height: r.height }
    );

    // Card chrome = header + borders, i.e. everything the scaled body doesn't
    // occupy. Font-size driven, so it never changes with zoom — measuring it
    // here can't feed back into the fit it feeds.
    const body = cardRefs.current.values().next().value;
    const card = body?.parentElement;
    if (!card) return;
    const chrome = card.getBoundingClientRect().height - body.getBoundingClientRect().height;
    if (chrome > 0) {
      setCardChrome((prev) => (Math.abs(prev - chrome) < 1 ? prev : chrome));
    }
  }, []);

  useEffect(() => {
    measureSurface();
    const timer = setTimeout(syncNativeViewports, 50);
    return () => clearTimeout(timer);
  }, [syncNativeViewports, measureSurface, sidebarOpen, sidebarWidth]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    measureSurface();
    const observer = new ResizeObserver(measureSurface);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [measureSurface]);

  useEffect(() => {
    if (!IS_TAURI) return;
    const observer = new ResizeObserver(() => syncNativeViewports());
    observer.observe(document.documentElement);
    if (surfaceRef.current) observer.observe(surfaceRef.current);
    for (const node of cardRefs.current.values()) observer.observe(node);

    // No onMoved listener: viewport webviews are children of the main window,
    // so the OS moves them with it. onResized stays — a window resize changes
    // the card layout, which is a real bounds change.
    let cancelled = false;
    let unresize: (() => void) | null = null;
    getCurrentWindow()
      .onResized(() => {
        measureSurface();
        setTimeout(syncNativeViewports, 50);
      })
      .then((fn) => {
        if (cancelled) fn();
        else unresize = fn;
      });

    return () => {
      cancelled = true;
      observer.disconnect();
      unresize?.();
    };
  }, [syncNativeViewports, measureSurface]);

  useEffect(() => {
    return () => {
      for (const timer of setupTimersRef.current.values()) clearTimeout(timer);
      setupTimersRef.current.clear();
      for (const label of createdLabelsRef.current) {
        destroyViewport(label).catch(() => {});
      }
      createdLabelsRef.current.clear();
      urlByLabelRef.current.clear();
      emulationByLabelRef.current.clear();
    };
  }, []);

  function remove(id: string) {
    const label = viewportLabel(id);
    destroyViewport(label).catch(() => {});
    createdLabelsRef.current.delete(label);
    urlByLabelRef.current.delete(label);
    emulationByLabelRef.current.delete(label);
    removeViewport(id);
  }

  function getMetricsBadge(vp: typeof viewports[0]) {
    const label = viewportLabel(vp.id);
    const m = metrics.get(label);
    if (!m) return null;

    // The webview is zoomed by the same factor its box is scaled by, so the
    // page reports the preset's true size at any zoom.
    const matches =
      Math.abs(m.innerWidth - vp.width) <= 2 && Math.abs(m.innerHeight - vp.height) <= 2;

    if (matches) {
      return (
        <span className="flex items-center gap-0.5 text-micro text-green-400" title={`Actual: ${m.innerWidth}×${m.innerHeight} DPR:${m.devicePixelRatio}`}>
          <Check size={11} />
        </span>
      );
    }

    return (
      <span
        className="flex items-center gap-0.5 text-micro text-amber-400"
        title={`Expected ${vp.width}×${vp.height}, actual ${m.innerWidth}×${m.innerHeight}`}
      >
        <AlertTriangle size={11} />
      </span>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <ViewportToolbar />
      {/* overflow-hidden, never auto: these frames are native child webviews
          that clip to the window, not to this box, so a scrolled-out frame
          would draw over the browser chrome. Everything is fit-scaled instead. */}
      <div ref={surfaceRef} className="flex-1 min-h-0 overflow-hidden p-3">
        {viewports.length === 0 ? (
          <div className="text-center py-8">
            <Monitor
              size={24}
              className="mx-auto mb-2 text-[var(--color-text-disabled)] opacity-30"
            />
            <p className="text-micro text-[var(--color-text-muted)]">
              No viewports
            </p>
            <p className="text-xs text-[var(--color-text-disabled)] mt-1">
              Click a device preset in the sidebar to add one
            </p>
          </div>
        ) : (
          <div
            className={cn(
              "flex flex-nowrap items-start gap-4",
              viewportLayout === "focus" && "justify-center"
            )}
          >
            {visible.map((vp) => {
              const scaledW = Math.round(vp.width * effectiveZoom);
              const scaledH = Math.round(vp.height * effectiveZoom);
              // Only meaningful when there is something to select between —
              // in focus mode the one frame is always selected, so the accent
              // ring just boxed every device in a bright ivory outline.
              const showSelection =
                viewportLayout === "overview" && selectedViewportId === vp.id;

              return (
                <div
                  key={vp.id}
                  onClick={() => {
                    // In overview the grid doubles as a device picker.
                    selectViewport(vp.id);
                    if (viewportLayout === "overview") setViewportLayout("focus");
                  }}
                  className="flex flex-col rounded overflow-hidden shrink-0 cursor-pointer transition-shadow"
                  style={{
                    width: scaledW,
                    border: showSelection
                      ? "1px solid var(--color-accent)"
                      : "1px solid var(--color-border)",
                    background: "var(--color-elevated)",
                  }}
                >
                  {/* Card header */}
                  <div
                    className="flex items-center gap-1 px-2 py-1 text-xs flex-shrink-0"
                    style={{
                      background: "var(--color-surface)",
                      borderBottom: "1px solid var(--color-border-subtle)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    <span className="font-medium truncate">{vp.label}</span>
                    <span className="text-micro font-mono text-[var(--color-text-disabled)]">
                      {vp.width}×{vp.height}
                    </span>
                    {/* Metrics badge */}
                    {getMetricsBadge(vp)}
                    {/* Scale indicator */}
                    {effectiveZoom < 1 && (
                      <span className="text-micro text-[var(--color-text-disabled)]">
                        @{Math.round(effectiveZoom * 100)}%
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
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--color-text-disabled)] pointer-events-none">
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
