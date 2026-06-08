interface StatusBarProps {
  isLoading: boolean;
  loadTime: number | null;
  url: string;
  hoveredUrl: string | null;
}

function getOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// TODO: hoveredUrl — requires injected hover-tracking script (see Task 63.3)

export function StatusBar({ isLoading, loadTime, url, hoveredUrl }: StatusBarProps) {
  const origin = url ? getOrigin(url) : null;

  let leftContent: React.ReactNode = null;
  if (hoveredUrl) {
    const display = hoveredUrl.length > 60 ? hoveredUrl.slice(0, 60) + "…" : hoveredUrl;
    leftContent = (
      <span style={{ color: "var(--xevo-text-muted)" }}>{display}</span>
    );
  } else if (isLoading) {
    leftContent = (
      <span className="animate-pulse" style={{ color: "var(--xevo-accent)" }}>
        Loading…
      </span>
    );
  } else if (loadTime !== null) {
    leftContent = (
      <span>
        <span style={{ color: "var(--xevo-text-muted)" }}>{loadTime}</span>
        <span style={{ color: "var(--xevo-text-faint)" }}> ms</span>
      </span>
    );
  }

  return (
    <div
      className="flex items-center h-5 px-3 gap-4 shrink-0"
      style={{
        background: "var(--xevo-workspace-bar)",
        borderTop: "1px solid var(--xevo-border)",
        color: "var(--xevo-text-faint)",
        fontSize: "10px",
      }}
    >
      {leftContent}
      <div className="flex-1" />
      {origin && (
        <span style={{ color: "var(--xevo-text-faint)" }}>{origin}</span>
      )}
    </div>
  );
}
