export function formatBytes(bytes: number): string {
  if (bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Tailwind text colour for an HTTP status code. */
export function statusColor(code: number): string {
  if (code >= 200 && code < 300) return "text-status-2xx";
  if (code >= 300 && code < 400) return "text-status-3xx";
  if (code >= 400 && code < 500) return "text-status-4xx";
  if (code >= 500) return "text-status-5xx";
  return "text-[var(--color-text-disabled)]";
}
