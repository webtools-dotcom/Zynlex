import { describe, expect, it, vi } from "vitest";
import { cn, fitMenuOnScreen } from "./utils";

describe("cn", () => {
  it("keeps our custom font sizes next to a text colour", () => {
    expect(cn("text-micro", "text-[var(--color-text-muted)]")).toBe(
      "text-micro text-[var(--color-text-muted)]",
    );
    expect(cn("text-md text-red-500")).toBe("text-md text-red-500");
    expect(cn("text-micro", "text-md")).toBe("text-md");
  });
});

describe("fitMenuOnScreen", () => {
  it("leaves a menu that fits alone and pulls one that overflows back on screen", () => {
    vi.stubGlobal("window", { innerWidth: 1000, innerHeight: 800 });
    expect(fitMenuOnScreen(100, 100, 180, 220)).toEqual({ x: 100, y: 100 });
    expect(fitMenuOnScreen(950, 700, 180, 220)).toEqual({ x: 816, y: 576 });
    expect(fitMenuOnScreen(-10, -10, 180, 220)).toEqual({ x: 4, y: 4 });
    vi.unstubAllGlobals();
  });
});
