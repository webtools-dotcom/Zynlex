/**
 * LoadingBar — thin progress bar under the address bar.
 *
 * Shows a 2px bar that grows from 0% → 90% while loading, then
 * briefly fills to 100% and fades out when the page finishes.
 * Pure CSS animation, no JS timer needed for the visual itself.
 */
import { useEffect, useRef, useState } from "react";

interface LoadingBarProps {
  isLoading: boolean;
}

type BarState = "idle" | "loading" | "finishing";

export function LoadingBar({ isLoading }: LoadingBarProps) {
  const [state, setState] = useState<BarState>("idle");
  const wasLoading = useRef<boolean>(false);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const innerBarRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const startWidthRef = useRef<number>(90);

  useEffect(() => {
    // Transition true→false: play the "done" animation, then hide
    if (wasLoading.current && !isLoading) {
      const innerRect = innerBarRef.current?.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      startWidthRef.current =
        innerRect && containerRect && containerRect.width > 0
          ? (innerRect.width / containerRect.width) * 100
          : 90;
      setState("finishing");
      if (finishTimer.current) clearTimeout(finishTimer.current);
      finishTimer.current = setTimeout(() => {
        setState("idle");
        finishTimer.current = null;
      }, 350);
    } else if (isLoading) {
      // Reset any pending hide, start loading animation
      if (finishTimer.current) {
        clearTimeout(finishTimer.current);
        finishTimer.current = null;
      }
      setState("loading");
    }
    wasLoading.current = isLoading;
  }, [isLoading]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (finishTimer.current) clearTimeout(finishTimer.current);
    };
  }, []);

  if (state === "idle") return null;

  const animation =
    state === "loading"
      ? "xevo-progress 8s ease-out forwards"
      : "xevo-progress-done 0.3s ease-out forwards";

  return (
    <div
      ref={containerRef}
      className="w-full flex-shrink-0"
      style={{
        position: "relative",
        height: 2,
        background: "transparent",
        overflow: "hidden",
      }}
    >
      <div
        ref={innerBarRef}
        style={
          {
            height: "100%",
            width: 0,
            background: "var(--color-accent)",
            "--loading-start-width": `${startWidthRef.current}%`,
            animation,
          } as React.CSSProperties
        }
      />
    </div>
  );
}
