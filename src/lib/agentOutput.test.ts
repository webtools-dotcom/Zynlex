import { describe, expect, it } from "vitest";
import { clipRect, cutForInline, uploadPaths } from "./agentOutput";

describe("cutForInline", () => {
  it("leaves text that fits alone", () => {
    expect(cutForInline("a\nb\nc", { lines: 3 })).toBeNull();
    expect(cutForInline("abc", { chars: 3 })).toBeNull();
  });

  it("cuts by lines or by chars and says how much is left", () => {
    const lines = Array.from({ length: 305 }, (_, i) => `line ${i}`).join("\n");
    const cut = cutForInline(lines, { lines: 300 });
    expect(cut?.head.split("\n")).toHaveLength(300);
    expect(cut?.head.endsWith("line 299")).toBe(true);
    expect(cut?.more).toBe("5 more lines");
    expect(cutForInline("x".repeat(8010), { chars: 8000 })).toEqual({
      head: "x".repeat(8000),
      more: "10 more chars",
    });
  });
});

describe("clipRect", () => {
  // A quad is four corners: x1,y1 (top left) clockwise to x4,y4.
  const quad = (x: number, y: number, w: number, h: number) => [
    x,
    y,
    x + w,
    y,
    x + w,
    y + h,
    x,
    y + h,
  ];

  it("moves the element's box into page coordinates by the scroll offset", () => {
    expect(clipRect([quad(10, 20, 100, 40)], { x: 0, y: 500 })).toEqual({
      x: 10,
      y: 520,
      width: 100,
      height: 40,
    });
  });

  it("rounds outwards so fractional boxes aren't cut", () => {
    expect(clipRect([quad(10.6, 20.2, 99.6, 39.5)], { x: 0, y: 0 })).toEqual({
      x: 10,
      y: 20,
      width: 101,
      height: 40,
    });
  });

  it("covers every quad of an element that wraps across lines", () => {
    expect(clipRect([quad(200, 0, 50, 20), quad(0, 20, 80, 20)], { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 250,
      height: 40,
    });
  });

  it("keeps the area inside the page and Chromium's height limit", () => {
    expect(clipRect([quad(-20, -10, 50, 30)], { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 30,
      height: 20,
    });
    expect(clipRect([quad(0, 0, 10, 50_000)], { x: 0, y: 0 })?.height).toBe(16384);
  });

  it("is null when there's nothing to capture", () => {
    expect(clipRect([], { x: 0, y: 0 })).toBeNull();
    expect(clipRect([quad(5, 5, 0, 10)], { x: 0, y: 0 })).toBeNull();
    expect(clipRect([quad(-50, 0, 20, 10)], { x: 0, y: 0 })).toBeNull();
  });
});

describe("uploadPaths", () => {
  it("takes absolute Windows paths, one or many", () => {
    expect(uploadPaths("C:\\Users\\me\\a.png")).toEqual(["C:\\Users\\me\\a.png"]);
    expect(uploadPaths([" D:/x/b.pdf ", "\\\\server\\share\\c.txt"])).toEqual([
      "D:/x/b.pdf",
      "\\\\server\\share\\c.txt",
    ]);
  });

  it("refuses missing, empty and relative paths", () => {
    expect(() => uploadPaths(undefined)).toThrow("upload needs files");
    expect(() => uploadPaths([])).toThrow("upload needs files");
    expect(() => uploadPaths(["C:\\a.png", ""])).toThrow("upload needs files");
    expect(() => uploadPaths([42])).toThrow("upload needs files");
    expect(() => uploadPaths(["a.png"])).toThrow('"a.png" isn\'t an absolute path');
    expect(() => uploadPaths(["..\\a.png"])).toThrow("isn't an absolute path");
    expect(() => uploadPaths(["/home/me/a.png"])).toThrow("isn't an absolute path");
  });
});
