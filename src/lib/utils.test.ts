import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps our custom font sizes next to a text colour", () => {
    expect(cn("text-micro", "text-[var(--color-text-muted)]")).toBe(
      "text-micro text-[var(--color-text-muted)]",
    );
    expect(cn("text-md text-red-500")).toBe("text-md text-red-500");
    expect(cn("text-micro", "text-md")).toBe("text-md");
  });
});
