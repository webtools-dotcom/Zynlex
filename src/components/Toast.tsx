/**
 * Toast — the newest notification, inline in the status bar.
 *
 * Not a floating stack: anything drawn over the tab's area is hidden behind the
 * tab's native webview. Each toast auto-dismisses after 2.5s (the store's
 * pushToast); clicking dismisses it early.
 */
import { Check, Info, X } from "lucide-react";
import { useUIStore, type Toast as ToastData } from "@/stores/ui";

const KIND_COLORS: Record<ToastData["kind"], { bg: string; border: string; fg: string }> = {
  success: { bg: "var(--color-live)", border: "var(--color-live)", fg: "#0f0f0f" },
  info: {
    bg: "var(--color-elevated)",
    border: "var(--color-border)",
    fg: "var(--color-text-primary)",
  },
  danger: { bg: "var(--color-dead)", border: "var(--color-dead)", fg: "#fff" },
};

function ToastItem({ toast }: { toast: ToastData }) {
  const dismiss = useUIStore((s) => s.dismissToast);
  const c = KIND_COLORS[toast.kind];
  const Icon = toast.kind === "success" ? Check : toast.kind === "danger" ? X : Info;
  return (
    <button
      onClick={() => dismiss(toast.id)}
      className="flex items-center gap-1.5 h-5 px-2 rounded-[4px] border text-left min-w-0 max-w-[480px]"
      style={{
        background: c.bg,
        borderColor: c.border,
        color: c.fg,
        animation: "toastIn var(--duration-normal) var(--ease-out)",
      }}
    >
      <Icon size={12} className="flex-shrink-0" />
      <span className="text-micro font-mono truncate">{toast.message}</span>
    </button>
  );
}

export function Toast() {
  const toast = useUIStore((s) => s.toasts[s.toasts.length - 1]);
  return toast ? <ToastItem key={toast.id} toast={toast} /> : null;
}
