import { Globe } from "lucide-react";
import { hostOf } from "@/lib/url";

interface SocialPreviewCardProps {
  platform: "facebook" | "twitter" | "linkedin" | "discord";
  meta: Record<string, string>;
}

export function SocialPreviewCard({ platform, meta }: SocialPreviewCardProps) {
  const title = meta["og:title"] || meta.title || "Untitled";
  const description = meta["og:description"] || meta.description || "";
  const image = meta["twitter:image"] || meta["og:image"] || "";
  const url = meta["og:url"] || meta.canonical || "";
  const domain = hostOf(url, "example.com");

  const platformColors: Record<string, string> = {
    facebook: "#1877F2",
    twitter: "#1DA1F2",
    linkedin: "#0A66C2",
    discord: "#5865F2",
  };

  return (
    <div
      className="rounded overflow-hidden border text-[var(--color-text-primary)]"
      style={{
        borderColor: "var(--color-border)",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Platform label */}
      <div
        className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-white"
        style={{ backgroundColor: platformColors[platform] }}
      >
        <Globe size={12} />
        <span className="uppercase tracking-wider">{platform}</span>
        <span className="ml-auto opacity-70 text-micro">Preview</span>
      </div>

      {/* Image */}
      {image && (
        <div className="w-full" style={{ aspectRatio: "1.91 / 1", overflow: "hidden", background: "var(--color-elevated)" }}>
          <img
            src={image}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      )}

      {/* Content */}
      <div className="px-2 py-1.5" style={{ background: "var(--color-elevated)" }}>
        {(platform === "facebook" || platform === "linkedin") && (
          <span className="text-micro text-[var(--color-text-disabled)] uppercase tracking-wider block">
            {domain}
          </span>
        )}
        <h3
          className="text-sm font-semibold leading-tight mt-0.5 line-clamp-2"
          style={{ color: platform === "twitter" || platform === "discord" ? "var(--color-text-primary)" : "#1a1a2e" }}
        >
          {platform === "twitter"
            ? title.slice(0, 70)
            : platform === "discord"
              ? title.slice(0, 100)
              : title.slice(0, 100)}
        </h3>
        {description && (
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-2 leading-snug">
            {description.slice(0, 200)}
          </p>
        )}
        {(platform === "twitter" || platform === "discord") && (
          <span className="text-micro text-[var(--color-text-disabled)] mt-0.5 block">
            {domain}
          </span>
        )}
      </div>
    </div>
  );
}
