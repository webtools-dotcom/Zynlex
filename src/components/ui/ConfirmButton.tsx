import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A destructive-action button that confirms in place.
 *
 * `window.confirm()` cannot be used anywhere in this app: tab webviews are
 * native child HWNDs stacked above the main window's webview, so the WebView2
 * script dialog renders *behind* the page and its buttons are unreachable.
 * Confirming inline — inside the sidebar/panel that owns the button, which is
 * never inside the webview's rectangle — makes occlusion structurally
 * impossible, with no webview hide/show flicker.
 */
export function ConfirmButton({
  onConfirm,
  children,
  className,
  confirmLabel = "Sure?",
  title,
  disabled,
}: {
  onConfirm: () => void;
  children: React.ReactNode;
  className?: string;
  confirmLabel?: string;
  title?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Disarm on Escape or after a few idle seconds, so a stray click never
  // leaves a destructive action one keystroke away indefinitely.
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setArmed(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    timerRef.current = setTimeout(() => setArmed(false), 4000);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        title={title}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (disabled) return;
          setArmed(true);
        }}
        className={className}
      >
        {children}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setArmed(false);
          onConfirm();
        }}
        className={cn(
          "text-xs px-1.5 py-0.5 rounded bg-[var(--color-dead)] text-white cursor-pointer",
          className
        )}
      >
        {confirmLabel}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setArmed(false);
        }}
        className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
      >
        No
      </button>
    </span>
  );
}
