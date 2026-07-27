import { describe, expect, it } from "vitest";
import { hostOf, originOf, resolveInput, titleFromUrl } from "./url";

describe("resolveInput", () => {
  it("passes through an already-absolute URL", () => {
    expect(resolveInput("https://example.com", "google", "")).toBe("https://example.com");
    expect(resolveInput("http://example.com", "google", "")).toBe("http://example.com");
  });

  it("adds http:// to localhost and loopback addresses", () => {
    expect(resolveInput("localhost:3000", "google", "")).toBe("http://localhost:3000");
    expect(resolveInput("localhost", "google", "")).toBe("http://localhost");
    expect(resolveInput("127.0.0.1:8080", "google", "")).toBe("http://127.0.0.1:8080");
  });

  it("adds https:// to a bare domain", () => {
    expect(resolveInput("example.com", "google", "")).toBe("https://example.com");
    expect(resolveInput("example.com/path", "google", "")).toBe("https://example.com/path");
  });

  it("falls back to the search engine for anything else", () => {
    expect(resolveInput("how to center a div", "google", "")).toBe(
      "https://google.com/search?q=how%20to%20center%20a%20div",
    );
    expect(resolveInput("hello world", "duckduckgo", "")).toBe(
      "https://duckduckgo.com/search?q=hello%20world",
    );
    expect(resolveInput("hello world", "bing", "")).toBe("https://bing.com/search?q=hello%20world");
  });

  it("uses the custom search URL when searchEngine is custom", () => {
    expect(resolveInput("cats", "custom", "https://kagi.com/search?q=%s")).toBe(
      "https://kagi.com/search?q=cats",
    );
  });

  it("returns an empty string for blank input", () => {
    expect(resolveInput("   ", "google", "")).toBe("");
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
