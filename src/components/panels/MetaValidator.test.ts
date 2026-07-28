import { describe, expect, it } from "vitest";
import { metaTagsToRecord, validateMetaTags } from "./MetaValidator";

describe("metaTagsToRecord", () => {
  it("maps name -> content", () => {
    const record = metaTagsToRecord([
      { name: "description", content: "A page" },
      { name: "og:title", content: "Hello" },
    ]);
    expect(record).toEqual({ description: "A page", "og:title": "Hello" });
  });

  it("keeps the first value when a name repeats", () => {
    const record = metaTagsToRecord([
      { name: "description", content: "first" },
      { name: "description", content: "second" },
    ]);
    expect(record.description).toBe("first");
  });

  it("skips entries with no name", () => {
    const record = metaTagsToRecord([{ name: "", content: "ignored" }]);
    expect(record).toEqual({});
  });
});

describe("validateMetaTags", () => {
  it("flags a missing title as an error", () => {
    const validations = validateMetaTags({});
    const title = validations.find((v) => v.field === "title");
    expect(title?.status).toBe("error");
  });

  it("warns on a title longer than 60 characters", () => {
    const longTitle = "a".repeat(61);
    const validations = validateMetaTags({ title: longTitle });
    const title = validations.find((v) => v.field === "title");
    expect(title?.status).toBe("warning");
  });

  it("accepts a title within the length limit", () => {
    const validations = validateMetaTags({ title: "A good title" });
    const title = validations.find((v) => v.field === "title");
    expect(title?.status).toBe("valid");
  });

  it("treats an absolute og:image URL as valid, relative as a warning", () => {
    const absolute = validateMetaTags({ "og:image": "https://example.com/img.png" });
    expect(absolute.find((v) => v.field === "og:image")?.status).toBe("valid");

    const relative = validateMetaTags({ "og:image": "/img.png" });
    expect(relative.find((v) => v.field === "og:image")?.status).toBe("warning");

    const missing = validateMetaTags({});
    expect(missing.find((v) => v.field === "og:image")?.status).toBe("error");
  });

  it("errors when there is no twitter:image and no og:image", () => {
    const validations = validateMetaTags({});
    expect(validations.find((v) => v.field === "twitter:image")?.status).toBe("error");
  });

  it("does not error on twitter:image when og:image is present", () => {
    const validations = validateMetaTags({ "og:image": "https://example.com/img.png" });
    expect(validations.find((v) => v.field === "twitter:image")).toBeUndefined();
  });
});
