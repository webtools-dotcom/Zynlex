import { originOf } from "@/lib/url";

interface StatusBarProps {
  isLoading: boolean;
  loadTime: number | null;
  url: string;
  hoveredUrl: string | null;
  zoom: number;
}

export function StatusBar({ isLoading, loadTime, url, hoveredUrl, zoom }: StatusBarProps) {
  const origin = url ? originOf(url) : "";

  let leftContent: React.ReactNode = null;
  if (hoveredUrl) {
    const display = hoveredUrl.length > 60 ? hoveredUrl.slice(0, 60) + "…" : hoveredUrl;
    leftContent = <span style={{ color: "var(--color-text-muted)" }}>{display}</span>;
  } else if (isLoading) {
    leftContent = (
      <span className="animate-pulse" style={{ color: "var(--color-accent)" }}>
        Loading…
      </span>
    );
  } else if (loadTime !== null) {
    leftContent = (
      <span>
        <span style={{ color: "var(--color-text-muted)", fontFeatureSettings: '"tnum" 1' }}>
          {loadTime}
        </span>
        <span style={{ color: "var(--color-text-disabled)" }}> ms</span>
      </span>
    );
  }

  return (
    <div
      className="flex items-center h-7 px-3 gap-4 shrink-0"
      style={{
        background: "var(--color-base)",
        borderTop: "1px solid var(--color-border)",
        color: "var(--color-text-disabled)",
        fontSize: "11px",
      }}
    >
      {leftContent}
      <div className="flex-1" />
      {zoom !== 1 && (
        <span style={{ color: "var(--color-text-muted)" }}>{Math.round(zoom * 100)}%</span>
      )}
      {origin && <span style={{ color: "var(--color-text-disabled)" }}>{origin}</span>}
    </div>
  );
}
