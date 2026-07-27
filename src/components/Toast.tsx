/**
 * Toast — small bottom-right notification stack.
 *
 * Renders toasts from useUIStore.toasts. Each toast auto-dismisses after 2.5s
 * (configured in the store's pushToast). Clicking a toast dismisses it early.
 * Stack grows upward; max 5 visible (older ones clipped).
 */
import { Check, Info, X } from "lucide-react";
import { useUIStore, type Toast as ToastData } from "@/stores/ui";

const KIND_COLORS: Record<ToastData["kind"], { bg: string; border: string; fg: string }> = {
  success: { bg: "var(--color-live)", border: "var(--color-live)", fg: "#0f0f0f" },
  info: { bg: "var(--color-elevated)", border: "var(--color-border)", fg: "var(--color-text-primary)" },
  danger: { bg: "var(--color-dead)", border: "var(--color-dead)", fg: "#fff" },
};

function ToastItem({ toast }: { toast: ToastData }) {
  const dismiss = useUIStore((s) => s.dismissToast);
  const c = KIND_COLORS[toast.kind];
  const Icon = toast.kind === "success" ? Check : toast.kind === "danger" ? X : Info;
  return (
    <button
      onClick={() => dismiss(toast.id)}
      className="flex items-center gap-2 px-3 py-2.5 rounded-md border text-left max-w-[360px]"
      style={{
        background: c.bg,
        borderColor: c.border,
        color: c.fg,
        animation: "toastIn var(--duration-normal) var(--ease-out)",
      }}
    >
      <Icon size={14} className="flex-shrink-0" />
      <span className="text-xs font-mono truncate">{toast.message}</span>
    </button>
  );
}

export function Toast() {
  const toasts = useUIStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-[9998] flex flex-col-reverse gap-1.5">
      {toasts.slice(-5).map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

export default Toast;
