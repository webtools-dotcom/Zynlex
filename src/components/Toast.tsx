/**
 * Toast — small bottom-right notification stack.
 *
 * Renders toasts from useUIStore.toasts. Each toast auto-dismisses after 2.5s
 * (configured in the store's pushToast). Clicking a toast dismisses it early.
 * Stack grows upward; max 5 visible (older ones clipped).
 */
import { Check, Info, X } from "lucide-react";
import { useUIStore, type Toast } from "@/stores/ui";

const KIND_COLORS: Record<Toast["kind"], { bg: string; border: string; fg: string }> = {
  success: { bg: "var(--xevo-success)", border: "var(--xevo-success)", fg: "#0f0f0f" },
  info: { bg: "var(--xevo-modal-bg)", border: "var(--xevo-modal-border)", fg: "var(--xevo-text)" },
  danger: { bg: "var(--xevo-danger)", border: "var(--xevo-danger)", fg: "#fff" },
};

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useUIStore((s) => s.dismissToast);
  const c = KIND_COLORS[toast.kind];
  const Icon = toast.kind === "success" ? Check : toast.kind === "danger" ? X : Info;
  return (
    <button
      onClick={() => dismiss(toast.id)}
      className="flex items-center gap-2 px-3 py-2 rounded-md border text-left shadow-lg max-w-[340px] animate-[slideIn_0.2s_ease-out]"
      style={{
        background: c.bg,
        borderColor: c.border,
        color: c.fg,
      }}
    >
      <Icon size={13} className="flex-shrink-0" />
      <span className="text-[11px] font-mono truncate">{toast.message}</span>
    </button>
  );
}

export function Toast() {
  const toasts = useUIStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <>
      <style>{`@keyframes slideIn { from { transform: translateX(20px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`}</style>
      <div className="fixed bottom-4 right-4 z-[9998] flex flex-col-reverse gap-1.5">
        {toasts.slice(-5).map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>
    </>
  );
}

export default Toast;
