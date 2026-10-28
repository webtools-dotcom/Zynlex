import { describe, expect, it } from "vitest";
import { migratePins } from "./keybindings";

describe("migratePins", () => {
  it("gives existing users the default pins, keeping their own after them", () => {
    expect(migratePins({ overrides: {}, pinned: [] }, 1)).toEqual({
      overrides: {},
      pinned: ["screenshot.full", "bugReport.copy", "color.pick"],
    });
    expect(migratePins({ pinned: ["snippet.a", "bugReport.copy"] }, 1)).toEqual({
      pinned: ["screenshot.full", "color.pick", "snippet.a", "bugReport.copy"],
    });
  });

  it("leaves a current state alone", () => {
    expect(migratePins({ pinned: ["snippet.a"] }, 2)).toEqual({ pinned: ["snippet.a"] });
  });
});
