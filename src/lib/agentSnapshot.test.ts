import { describe, expect, it } from "vitest";
import { type AXNode, diffSnapshot, formatSnapshot } from "./agentSnapshot";

let next = 0;
const node = (
  role: string,
  name = "",
  children: AXNode[] = [],
  extra: Partial<AXNode> = {},
): AXNode[] => {
  const n: AXNode = {
    nodeId: String(++next),
    role: { value: role },
    name: { value: name },
    childIds: children.filter((c) => c).map((c) => c.nodeId),
    backendDOMNodeId: next + 100,
    ...extra,
  };
  return [n];
};

/** Flattens a tree built with `tree()` into CDP's flat list, root first. */
function tree(role: string, name: string, kids: AXNode[][] = [], extra: Partial<AXNode> = {}) {
  const [n] = node(
    role,
    name,
    kids.map((k) => k[0]),
    extra,
  );
  return [n, ...kids.flat()];
}

describe("formatSnapshot", () => {
  it("keeps actionable elements with refs, and the headings and landmarks around them", () => {
    const nodes = tree("RootWebArea", "Shop", [
      tree("heading", "Checkout", [], {
        properties: [{ name: "level", value: { value: 2 } }],
      }),
      tree("generic", "", [tree("StaticText", "Some prose nobody acts on")]),
      tree("navigation", "", []),
      tree("main", "", [
        tree("textbox", "Coupon", [], { value: { value: "" } }),
        tree("button", "Apply", [tree("StaticText", "Apply")]),
        tree("button", "Pay", [], {
          properties: [{ name: "disabled", value: { value: true } }],
        }),
        tree("alert", "", [tree("StaticText", "Coupon expired")]),
      ]),
    ]);
    const out = formatSnapshot(nodes);
    const ref = (name: string) => `e${nodes.find((n) => n.name?.value === name)?.backendDOMNodeId}`;
    expect(out).toBe(
      [
        'h2 "Checkout"',
        "main",
        `  textbox "Coupon" [${ref("Coupon")}] value=""`,
        `  button "Apply" [${ref("Apply")}]`,
        `  button "Pay" [${ref("Pay")}] disabled`,
        '  alert "Coupon expired"',
      ].join("\n"),
    );
  });

  it("walks through ignored nodes and can root at one element", () => {
    const form = tree("form", "Login", [tree("button", "Sign in")]);
    const nodes = tree("RootWebArea", "", [
      tree("generic", "", [form], { ignored: true }),
      tree("button", "Elsewhere"),
    ]);
    expect(formatSnapshot(nodes)).toContain('form "Login"\n  button "Sign in"');
    const only = formatSnapshot(nodes, { within: form[0].backendDOMNodeId });
    expect(only).toContain("Sign in");
    expect(only).not.toContain("Elsewhere");
    expect(formatSnapshot(nodes, { within: 9999 })).toBe("No element e9999 on the page.");
  });

  it("full mode keeps text", () => {
    const nodes = tree("RootWebArea", "", [tree("paragraph", "", [tree("StaticText", "Hello")])]);
    expect(formatSnapshot(nodes)).toBe("(nothing actionable on the page)");
    expect(formatSnapshot(nodes, { full: true })).toContain('"Hello"');
  });
});

describe("diffSnapshot", () => {
  it("reports what appeared and what went away, ignoring indentation", () => {
    const before = 'main\n  button "Apply" [e1]\n  textbox "Coupon" [e2] value=""';
    const after =
      'main\n  button "Apply" [e1]\n  textbox "Coupon" [e2] value="SAVE20"\n  alert "Expired"';
    expect(diffSnapshot(before, after)).toEqual([
      '- textbox "Coupon" [e2] value=""',
      '+ textbox "Coupon" [e2] value="SAVE20"',
      '+ alert "Expired"',
    ]);
    expect(diffSnapshot(before, before)).toEqual([]);
  });

  it("counts repeated lines", () => {
    expect(diffSnapshot('link "More"\nlink "More"', 'link "More"')).toEqual(['- link "More"']);
  });
});
