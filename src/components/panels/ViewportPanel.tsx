import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Monitor, Plus, RotateCw, Smartphone, Tablet, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/stores/ui";
import { useWorkspacesStore } from "@/stores/workspaces";
import { useTabsStore } from "@/stores/tabs";
import { getLiveWorkspaceActiveTab } from "@/lib/workspaceTabs";
import { DEVICE_PRESETS, type DevicePreset } from "@/components/panels/ViewportPresets";
import {
  createViewport,
  destroyViewport,
  navigateViewport,
  resizeViewport,
  showViewport,
  probeViewport,
  onViewportLoaded,
  type DeviceSpec,
  type ViewportProbe,
} from "@/services/browser";

const IS_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  mobile: Smartphone,
  tablet: Tablet,
  laptop: Monitor,
};

/**
 * One device at a time, under one reused native webview.
 *
 * The frame is a `Window::add_child` webview, which clips to the *window*, not
 * to any DOM box — a frame bigger than the panel draws straight over the
 * toolbar and sidebar. It is rendered 1:1 and clamped to the panel by CSS, so
 * exceeding the panel is structurally impossible and there is no scale factor
 * to get wrong. The page scrolls inside it, like a phone with a shorter screen.
 */
const VIEWPORT_LABEL = "viewport-active";

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

  return (
    <div className="p-2">
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        <div className="flex items-center gap-0.5">
          {Object.entries(DEVICE_PRESETS).map(([key, presets]) => {
            const Icon = CATEGORY_ICONS[key] || Monitor;
            return (
              <div key={key} className="relative group">
                <button
                  onClick={() => setSelectedCategory(selectedCategory === key ? "" : key)}
                  className={cn(
                    "w-7 h-7 flex items-center justify-center rounded text-xs transition-colors",
                    selectedCategory === key
                      ? "bg-[var(--color-accent-dim)] text-[var(--color-accent)]"
                      : "text-[var(--color-text-disabled)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]",
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
          {viewports.length} device{viewports.length !== 1 ? "s" : ""}
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
                  : "hover:bg-[var(--color-hover)]",
              )}
              style={{
                borderColor:
                  selectedViewportId === vp.id ? undefined : "var(--color-border-subtle)",
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
                onClick={(e) => {
                  e.stopPropagation();
                  removeViewport(vp.id);
                }}
                className="w-6 h-6 flex items-center justify-center rounded hover:bg-[var(--color-hover)] text-[var(--color-text-disabled)] hover:text-[var(--color-dead)] transition-colors"
                title="Remove device"
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
  const rotateViewport = useUIStore((s) => s.rotateViewport);
  const resizeViewportDimensions = useUIStore((s) => s.resizeViewportDimensions);

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
  const inactiveCls =
    "text-[var(--color-text-disabled)] hover:text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]";

  return (
    <div
      className="flex items-center gap-1 px-2 py-1 flex-shrink-0 flex-wrap"
      style={{
        borderBottom: "1px solid var(--color-border-subtle)",
        background: "var(--color-surface)",
      }}
    >
      {/* Selected device label */}
      <span className="text-xs text-[var(--color-text-muted)] font-medium truncate max-w-[160px]">
        {selected ? selected.label : "No device"}
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
            onKeyDown={(e) => {
              if (e.key === "Enter") commitSize();
            }}
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
            onKeyDown={(e) => {
              if (e.key === "Enter") commitSize();
            }}
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
    </div>
  );
}

// ─── ViewportSurface (main area) ──────────────────────────────────

export function ViewportSurface() {
  const viewports = useUIStore((s) => s.viewports);
  const selectedViewportId = useUIStore((s) => s.selectedViewportId);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const { workspaces, activeWorkspaceId } = useWorkspacesStore();
  const tabs = useTabsStore((s) => s.tabs);
  const ws = workspaces[activeWorkspaceId];
  const activeTab = getLiveWorkspaceActiveTab(ws, tabs);
  const activeUrl = activeTab?.url || "about:blank";

  const cardRef = useRef<HTMLDivElement | null>(null);
  // Identity of the device the webview was *built* for. The user agent is a
  // build-time builder attribute, so a different device means a rebuild.
  const builtForRef = useRef<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  const [probe, setProbe] = useState<ViewportProbe | null>(null);
  // The size we last handed to the webview. The probe is checked against this,
  // not against a fresh DOM measurement taken during render — measuring in
  // render races layout and compares the page to a rect it never received.
  const [sentSize, setSentSize] = useState<{ width: number; height: number } | null>(null);

  const device = viewports.find((vp) => vp.id === selectedViewportId) ?? viewports[0] ?? null;

  const sync = useCallback(() => {
    if (!IS_TAURI || busyRef.current) return;

    if (!device) {
      if (builtForRef.current) {
        destroyViewport(VIEWPORT_LABEL).catch(() => {});
        builtForRef.current = null;
        urlRef.current = null;
      }
      return;
    }

    const node = cardRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;

    // Window-relative, not screen: this is a child webview, so Tauri positions
    // it against the main window's client area — the same space
    // getBoundingClientRect() already reports in.
    const x = Math.round(rect.left);
    const y = Math.round(rect.top);
    const width = Math.round(Math.max(1, rect.width));
    const height = Math.round(Math.max(1, rect.height));

    // The measured rect drives BOTH the webview bounds and the CDP layout
    // viewport. They are the same number, so the layout viewport can never be
    // wider than the surface showing it — which is what cropped the page — and
    // there is no scale factor left to get lost.
    const spec: DeviceSpec = {
      width,
      height,
      deviceScaleFactor: device.deviceScaleFactor,
      mobile: device.mobile,
      touch: device.touch,
      userAgent: device.userAgent,
    };
    setSentSize((prev) =>
      prev && prev.width === width && prev.height === height ? prev : { width, height },
    );

    if (builtForRef.current !== device.id) {
      // New device — rebuild, because the user agent can only be set on the
      // builder. That reloads the page, which is what makes server-side mobile
      // detection correct from the very first request.
      busyRef.current = true;
      const hadOne = builtForRef.current !== null;
      builtForRef.current = device.id;
      const start = hadOne ? destroyViewport(VIEWPORT_LABEL).catch(() => {}) : Promise.resolve();
      start
        .then(() => createViewport(VIEWPORT_LABEL, activeUrl, x, y, width, height, spec))
        .then(() => {
          urlRef.current = activeUrl;
          return showViewport(VIEWPORT_LABEL).catch(() => {});
        })
        .catch(() => {
          // Leave it unbuilt so the next sync retries.
          builtForRef.current = null;
        })
        .finally(() => {
          busyRef.current = false;
        });
      return;
    }

    // Bounds + emulation together, unconditionally. Not cached on a signature:
    // a controller resize resets the emulated viewport, so the override has to
    // be re-asserted after every bounds change even when the spec is unchanged.
    resizeViewport(VIEWPORT_LABEL, x, y, width, height, spec).catch(() => {});

    if (urlRef.current !== activeUrl) {
      // Navigate the existing webview. Destroy+recreate used to drop the
      // emulation, leaving the frame rendering full-size over the chrome.
      urlRef.current = activeUrl;
      navigateViewport(VIEWPORT_LABEL, activeUrl).catch(() => {});
    }
  }, [device, activeUrl]);

  useEffect(() => {
    const timer = setTimeout(sync, 50);
    return () => clearTimeout(timer);
  }, [sync, sidebarOpen, sidebarWidth]);

  // The card is CSS-clamped, so its rect changes on any layout change. Watching
  // the card itself is what keeps bounds and the CDP viewport in step.
  useEffect(() => {
    if (!IS_TAURI) return;
    const observer = new ResizeObserver(() => sync());
    observer.observe(document.documentElement);
    if (cardRef.current) observer.observe(cardRef.current);

    // No onMoved listener: the viewport webview is a child of the main window,
    // so the OS moves it with the window. onResized stays — a window resize
    // changes the card layout, which is a real bounds change.
    let cancelled = false;
    let unresize: (() => void) | null = null;
    getCurrentWindow()
      .onResized(() => setTimeout(sync, 50))
      .then((fn) => {
        if (cancelled) fn();
        else unresize = fn;
      });

    return () => {
      cancelled = true;
      observer.disconnect();
      unresize?.();
    };
  }, [sync]);

  // Probe after each load. This is the whole point of the rewrite: the frame
  // reports what it actually is, instead of it being inferred from screenshots.
  useEffect(() => {
    if (!IS_TAURI) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    const take = () => {
      probeViewport(VIEWPORT_LABEL)
        .then((p) => {
          if (!cancelled) setProbe(p);
        })
        .catch(() => {
          if (!cancelled) setProbe(null);
        });
    };
    onViewportLoaded(() => setTimeout(take, 60)).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // ...and again whenever the frame is resized. Probing only on load meant the
  // readout kept reporting the size the page had when it loaded, so any window
  // resize showed a false mismatch even though the emulation had re-applied.
  useEffect(() => {
    if (!IS_TAURI || !sentSize) return;
    let cancelled = false;
    const t = setTimeout(() => {
      probeViewport(VIEWPORT_LABEL)
        .then((p) => {
          if (!cancelled) setProbe(p);
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [sentSize]);

  // A different device means different expected metrics — drop the stale probe
  // rather than showing the previous device's numbers against the new one.
  useEffect(() => {
    setProbe(null);
  }, [device?.id]);

  useEffect(() => {
    return () => {
      destroyViewport(VIEWPORT_LABEL).catch(() => {});
      builtForRef.current = null;
      urlRef.current = null;
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      <ViewportToolbar />
      {/* overflow-hidden, never auto: the frame is a native child webview that
          clips to the window, not to this box, so anything past this box's edge
          would draw over the browser chrome. The card is CSS-clamped to fit. */}
      <div className="flex-1 min-h-0 overflow-hidden p-3 flex justify-center">
        {!device ? (
          <div className="text-center py-8">
            <Monitor
              size={24}
              className="mx-auto mb-2 text-[var(--color-text-disabled)] opacity-30"
            />
            <p className="text-micro text-[var(--color-text-muted)]">No device</p>
            <p className="text-xs text-[var(--color-text-disabled)] mt-1">
              Click a device preset in the sidebar to add one
            </p>
          </div>
        ) : (
          <div
            className="flex flex-col rounded overflow-hidden"
            style={{
              // Explicit width, not shrink-to-fit. Without this the card sizes
              // to its widest child — the header — and the body stretches to
              // match, so the frame came out wider than the device and that
              // wrong width was what got sent to CDP.
              //
              // content-box so the 1px border sits outside the device width;
              // under the global border-box the frame came out 2px narrow, and
              // that 410 would have been the emulated viewport.
              boxSizing: "content-box",
              width: device.width,
              maxWidth: "100%",
              maxHeight: "100%",
              border: "1px solid var(--color-border)",
              background: "var(--color-elevated)",
            }}
          >
            {/* Card header — the probe readout is the point: what the page says
                it is, not what we assume it is. `min-w-0` + truncation keep it
                from ever pushing the card wider than the device. */}
            <div
              className="flex items-center gap-1.5 px-2 py-1 text-xs flex-shrink-0 min-w-0 overflow-hidden"
              style={{
                background: "var(--color-surface)",
                borderBottom: "1px solid var(--color-border-subtle)",
                color: "var(--color-text-muted)",
              }}
            >
              <span className="font-medium truncate shrink">{device.label}</span>
              <span className="text-micro font-mono text-[var(--color-text-disabled)] shrink-0">
                {device.width}×{device.height}
              </span>
              {probe && <ProbeReadout probe={probe} expected={sentSize} />}
            </div>
            {/* Card body — 1:1, clamped by CSS. Its measured rect is the single
                source of truth for the webview bounds AND the CDP viewport. */}
            <div
              ref={cardRef}
              className="relative min-h-0"
              style={{
                width: "100%",
                height: device.height,
                maxHeight: "100%",
                overflow: "hidden",
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--color-text-disabled)] pointer-events-none">
                {activeUrl}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Shows what the page reports, and flags it when that disagrees with the size
 *  the webview was actually given. Replaces inferring emulation from screenshots. */
function ProbeReadout({
  probe,
  expected,
}: {
  probe: ViewportProbe;
  expected: { width: number; height: number } | null;
}) {
  // Against the LAYOUT viewport. `innerWidth`/`innerHeight` are the visual
  // viewport and move with page scale, so comparing them flagged a correct
  // 412 layout as wrong whenever Chromium shrink-to-fit the page.
  const ok =
    !!expected &&
    Math.abs(probe.clientWidth - expected.width) <= 2 &&
    Math.abs(probe.clientHeight - expected.height) <= 2;

  // Float32 round-trips DPR to things like 3.4999999403953552.
  const dpr = Math.round(probe.devicePixelRatio * 100) / 100;

  return (
    <span
      className={cn(
        "flex items-center gap-1 text-micro font-mono shrink-0",
        ok ? "text-green-400" : "text-amber-400",
      )}
      title={
        `layout ${probe.clientWidth}×${probe.clientHeight} · DPR ${dpr} · ` +
        `touch ${probe.maxTouchPoints}` +
        (expected ? `\nframe is ${expected.width}×${expected.height}` : "") +
        `\nscreen ${probe.screenWidth}×${probe.screenHeight}` +
        // Diverges from layout only when a page scale is in play — the signal
        // that made the shrink-to-fit diagnosable.
        `\nvisual ${probe.innerWidth}×${probe.innerHeight}` +
        `\n${probe.userAgent}`
      }
    >
      {ok ? <Check size={11} /> : <AlertTriangle size={11} />}
      {probe.clientWidth}×{probe.clientHeight}
      <span className="text-[var(--color-text-disabled)]">@{dpr}x</span>
    </span>
  );
}
