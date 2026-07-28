export interface MetaValidation {
  field: string;
  value: string;
  status: "valid" | "warning" | "error";
  message: string;
}

export function metaTagsToRecord(
  metas: { name: string; content: string }[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of metas) {
    const key = m.name || "";
    if (key && !map[key]) {
      map[key] = m.content;
    }
  }
  return map;
}

export function validateMetaTags(meta: Record<string, string>): MetaValidation[] {
  const validations: MetaValidation[] = [];

  if (!meta.title) {
    validations.push({ field: "title", value: "", status: "error", message: "Missing title tag" });
  } else if (meta.title.length > 60) {
    validations.push({
      field: "title",
      value: meta.title,
      status: "warning",
      message: `Title too long (${meta.title.length}/60 chars)`,
    });
  } else {
    validations.push({
      field: "title",
      value: meta.title,
      status: "valid",
      message: "Title present",
    });
  }

  if (!meta.description) {
    validations.push({
      field: "description",
      value: "",
      status: "error",
      message: "Missing meta description",
    });
  } else if (meta.description.length > 160) {
    validations.push({
      field: "description",
      value: meta.description,
      status: "warning",
      message: `Description too long (${meta.description.length}/160 chars)`,
    });
  } else {
    validations.push({
      field: "description",
      value: meta.description,
      status: "valid",
      message: "Description present",
    });
  }

  if (!meta.canonical) {
    validations.push({
      field: "canonical",
      value: "",
      status: "warning",
      message: "Missing canonical URL",
    });
  } else {
    validations.push({
      field: "canonical",
      value: meta.canonical,
      status: "valid",
      message: "Canonical present",
    });
  }

  if (!meta["og:title"]) {
    validations.push({
      field: "og:title",
      value: "",
      status: "error",
      message: "Missing og:title",
    });
  } else {
    validations.push({
      field: "og:title",
      value: meta["og:title"],
      status: "valid",
      message: "og:title present",
    });
  }

  if (!meta["og:description"]) {
    validations.push({
      field: "og:description",
      value: "",
      status: "error",
      message: "Missing og:description",
    });
  } else {
    validations.push({
      field: "og:description",
      value: meta["og:description"],
      status: "valid",
      message: "og:description present",
    });
  }

  if (!meta["og:image"]) {
    validations.push({
      field: "og:image",
      value: "",
      status: "error",
      message: "Missing og:image — link preview will have no image",
    });
  } else {
    try {
      new URL(meta["og:image"]);
      validations.push({
        field: "og:image",
        value: meta["og:image"],
        status: "valid",
        message: "og:image present (absolute URL)",
      });
    } catch {
      validations.push({
        field: "og:image",
        value: meta["og:image"],
        status: "warning",
        message: "og:image is relative URL — may fail for crawlers",
      });
    }
  }

  if (!meta["og:url"]) {
    validations.push({ field: "og:url", value: "", status: "warning", message: "Missing og:url" });
  }

  if (!meta["twitter:card"]) {
    validations.push({
      field: "twitter:card",
      value: "",
      status: "warning",
      message: "Missing twitter:card — defaults to summary",
    });
  } else if (meta["twitter:card"] !== "summary_large_image") {
    validations.push({
      field: "twitter:card",
      value: meta["twitter:card"],
      status: "warning",
      message: "Consider using summary_large_image for large image cards",
    });
  } else {
    validations.push({
      field: "twitter:card",
      value: meta["twitter:card"],
      status: "valid",
      message: "twitter:card is summary_large_image",
    });
  }

  if (!meta["twitter:image"] && !meta["og:image"]) {
    validations.push({
      field: "twitter:image",
      value: "",
      status: "error",
      message: "No twitter:image or og:image — link preview will have no image",
    });
  }

  return validations;
}
