import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_ENGINE,
  SEARCH_ENGINES,
  hostOf,
  originOf,
  resolveInput,
  searchUrl,
  titleFromUrl,
} from "./url";

describe("resolveInput", () => {
  it("passes through an already-absolute URL", () => {
    expect(resolveInput("https://example.com", "google")).toBe("https://example.com");
    expect(resolveInput("http://example.com", "google")).toBe("http://example.com");
  });

  it("adds http:// to localhost and loopback addresses", () => {
    expect(resolveInput("localhost:3000", "google")).toBe("http://localhost:3000");
    expect(resolveInput("localhost", "google")).toBe("http://localhost");
    expect(resolveInput("127.0.0.1:8080", "google")).toBe("http://127.0.0.1:8080");
  });

  it("adds https:// to a bare domain", () => {
    expect(resolveInput("example.com", "google")).toBe("https://example.com");
    expect(resolveInput("example.com/path", "google")).toBe("https://example.com/path");
  });

  it("falls back to the search engine for anything else", () => {
    expect(resolveInput("how to center a div", "google")).toBe(
      "https://www.google.com/search?q=how%20to%20center%20a%20div",
    );
  });

  it("returns an empty string for blank input", () => {
    expect(resolveInput("   ", "google")).toBe("");
  });
});

describe("searchUrl", () => {
  // These exact paths/params were verified against each engine — a wrong path
  // (DuckDuckGo) or wrong param (Yahoo) returns a page with no results.
  it.each([
    ["google", "https://www.google.com/search?q=hello%20world"],
    ["bing", "https://www.bing.com/search?q=hello%20world"],
    ["duckduckgo", "https://duckduckgo.com/?q=hello%20world"],
    ["brave", "https://search.brave.com/search?q=hello%20world"],
    ["yahoo", "https://search.yahoo.com/search?p=hello%20world"],
    ["qwant", "https://www.qwant.com/?q=hello%20world"],
  ])("builds a %s results URL", (engine, expected) => {
    expect(searchUrl("hello world", engine)).toBe(expected);
    expect(resolveInput("hello world", engine)).toBe(expected);
  });

  it("falls back to Google for an unknown engine (e.g. the removed 'custom')", () => {
    expect(searchUrl("cats", "custom")).toBe("https://www.google.com/search?q=cats");
    expect(searchUrl("cats", "")).toBe("https://www.google.com/search?q=cats");
  });

  // searchUrl falls back to SEARCH_ENGINES[0]; keep that the declared default.
  it("lists the default engine first", () => {
    expect(SEARCH_ENGINES[0].id).toBe(DEFAULT_SEARCH_ENGINE);
  });

  it("every shipped engine has a %s placeholder and encodes the query", () => {
    for (const engine of SEARCH_ENGINES) {
      expect(engine.template).toContain("%s");
      expect(searchUrl("a b&c", engine.id)).toContain("a%20b%26c");
    }
  });
});

describe("originOf", () => {
  it("returns scheme+host+port", () => {
    expect(originOf("https://example.com:8080/path")).toBe("https://example.com:8080");
  });

  it("returns the fallback for an unparseable URL", () => {
    expect(originOf("not a url", "*")).toBe("*");
    expect(originOf("not a url")).toBe("");
  });
});

describe("hostOf", () => {
  it("returns hostname only, no port", () => {
    expect(hostOf("https://example.com:8080/path")).toBe("example.com");
  });

  it("returns the fallback for an unparseable URL", () => {
    expect(hostOf("", "example.com")).toBe("example.com");
  });
});

describe("titleFromUrl", () => {
  it("strips scheme and www, keeps the port, drops the path", () => {
    expect(titleFromUrl("https://www.example.com:8080/foo/bar")).toBe("example.com:8080");
    expect(titleFromUrl("http://localhost:3000/foo")).toBe("localhost:3000");
  });

  it("never throws on a malformed string", () => {
    expect(titleFromUrl("")).toBe("");
    expect(titleFromUrl("not a url at all")).toBe("not a url at all");
  });
});
