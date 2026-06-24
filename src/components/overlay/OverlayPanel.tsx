import { useRef, useCallback, useEffect, useState } from "react";
import { X, GripHorizontal } from "lucide-react";
import { useUIStore } from "@/stores/ui";

interface OverlayPanelProps {
  apiTesterContent?: React.ReactNode;
  notesContent?: React.ReactNode;
}

export function OverlayPanel({ apiTesterContent, notesContent }: OverlayPanelProps) {
  const overlayPanel = useUIStore((s) => s.overlayPanel);
  const overlayHeight = useUIStore((s) => s.overlayHeight);
  const closeOverlay = useUIStore((s) => s.closeOverlay);
  const setOverlayHeight = useUIStore((s) => s.setOverlayHeight);

  const panelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  // Esc to close overlay
  useEffect(() => {
    if (overlayPanel === "none") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        closeOverlay();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [overlayPanel, closeOverlay]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = overlayHeight;
      setDragging(true);
    },
    [overlayHeight]
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const container = panelRef.current?.parentElement;
      if (!container) return;
      const containerHeight = container.getBoundingClientRect().height;
      const delta = e.clientY - startYRef.current;
      const newHeight = startHeightRef.current + delta / containerHeight;
      setOverlayHeight(newHeight);
    };

    const handleMouseUp = () => {
      draggingRef.current = false;
      setDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, setOverlayHeight]);

  if (overlayPanel === "none") return null;

  const heightPercent = overlayHeight * 100;

  return (
    <div
      ref={panelRef}
      className="absolute top-0 left-0 right-0 z-10 flex flex-col overflow-hidden border-b"
      style={{
        height: `${heightPercent}%`,
        background: "var(--color-elevated)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header with close button */}
      <div
        className="flex items-center justify-between h-8 px-2 border-b flex-shrink-0"
        style={{ borderColor: "var(--color-border-subtle)" }}
      >
        <span className="text-[11px] font-semibold text-[var(--color-text-muted)]">
          {overlayPanel === "api-tester" ? "API Tester" : "Notes"}
        </span>
        <button
          onClick={closeOverlay}
          className="w-5 h-5 flex items-center justify-center rounded text-[var(--color-text-disabled)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-hover)] transition-colors"
          title="Close panel (Esc)"
          aria-label="Close panel"
        >
          <X size={12} />
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {overlayPanel === "api-tester" && apiTesterContent}
        {overlayPanel === "notes-notepad" && notesContent}
      </div>

      {/* Drag handle */}
      <div
        onMouseDown={handleDragStart}
        className="h-1.5 flex items-center justify-center cursor-ns-resize flex-shrink-0 hover:bg-[var(--color-hover)] transition-colors"
        style={{ borderTop: "1px solid var(--color-border-subtle)" }}
      >
        <GripHorizontal
          size={10}
          className="text-[var(--color-text-disabled)]"
        />
      </div>
    </div>
  );
}
