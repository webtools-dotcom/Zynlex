import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));

import { type BugReport, bugReportMarkdown } from "./bugReport";

const base: BugReport = {
  title: "Checkout",
  url: "https://staging.example.com/cart",
  env: null,
  device: null,
  userAgent: "UA",
  zoom: 1.1,
  version: "0.18.0",
  time: new Date("2026-10-28T10:00:00Z"),
  screenshot: null,
  errors: [],
  failed: [],
};

describe("bugReportMarkdown", () => {
  it("lists the facts and leaves out what's missing", () => {
    const md = bugReportMarkdown(base);
    expect(md).toContain("## Bug report: Checkout");
    expect(md).toContain("- **URL:** https://staging.example.com/cart");
    expect(md).toContain("- **Zoom:** 110%");
    expect(md).toContain("- **Time:** 2026-10-28T10:00:00.000Z");
    expect(md).not.toContain("Environment");
    expect(md).not.toContain("Screenshot");
    expect(md).not.toContain("###");
  });

  it("adds environment, screenshot and error sections when present", () => {
    const md = bugReportMarkdown({
      ...base,
      env: "Staging",
      screenshot: "C:\\Downloads\\zynlex-bug-1.png",
      errors: ["TypeError: x is undefined"],
      failed: ["GET 404 https://staging.example.com/api"],
    });
    expect(md).toContain("- **Environment:** Staging");
    expect(md).toContain("- **Screenshot:** `C:\\Downloads\\zynlex-bug-1.png`");
    expect(md).toContain("### Errors (1)\n```\nTypeError: x is undefined\n```");
    expect(md).toContain(
      "### Failed requests (1)\n```\nGET 404 https://staging.example.com/api\n```",
    );
  });
});
