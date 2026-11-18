/**
 * In-page selector engine for the `script` tool (zynlex-mcp runs the agent's
 * Playwright-style script; each `page.*` call becomes a `page` call here).
 * Agents write Playwright selectors from memory, so this covers the ones they
 * reach for: CSS, `text=` (quoted: exact), `:has-text("…")`, `role=button[name="…"]`
 * (getByRole), `label=` (getByLabel), `nth=N`, `has-text=` (filter), `frame` (into an iframe), XPath (`xpath=`, `//`, `..`), and `>>` to scope each part
 * within the matches of the one before. Matching is Playwright's: substring,
 * case-insensitive, whitespace collapsed; quoted means exact.
 *
 * ponytail: roles come from tags and `role=` only (no full ARIA computation);
 * names from aria-label, labels, title, alt, placeholder, button value, text.
 */
export const QUERY = `((sel, root) => {
  const norm = (s) => String(s ?? "").replace(/\\s+/g, " ").trim();
  const textOf = (el) => norm(el.innerText ?? el.textContent);
  const unq = (s) => {
    const m = /^(["'])(.*)\\1$/.exec(s.trim());
    return m ? { t: m[2], exact: true } : { t: s.trim(), exact: false };
  };
  const hit = (have, want) => want.exact ? norm(have) === want.t : norm(have).toLowerCase().includes(want.t.toLowerCase());
  const nameOf = (el) => norm(
    el.getAttribute("aria-label") ||
    (el.labels && el.labels.length ? [...el.labels].map(textOf).join(" ") : "") ||
    el.getAttribute("title") || el.getAttribute("alt") ||
    (el.matches("input[type=button],input[type=submit],input[type=reset]") ? el.value : "") ||
    (el.matches("input,textarea,select") ? el.getAttribute("placeholder") : "") ||
    textOf(el));
  const ROLES = {
    button: "button,input[type=button],input[type=submit],input[type=reset],[role=button]",
    link: "a[href],[role=link]",
    textbox: "input:not([type]),input[type=text],input[type=email],input[type=search],input[type=tel],input[type=url],input[type=password],input[type=number],textarea,[role=textbox],[contenteditable=''],[contenteditable=true]",
    searchbox: "input[type=search],[role=searchbox]",
    checkbox: "input[type=checkbox],[role=checkbox]",
    radio: "input[type=radio],[role=radio]",
    combobox: "select,[role=combobox]",
    option: "option,[role=option]",
    list: "ul,ol,[role=list]",
    listitem: "li,[role=listitem]",
    heading: "h1,h2,h3,h4,h5,h6,[role=heading]",
    img: "img,[role=img]",
    dialog: "dialog,[role=dialog],[role=alertdialog]",
    table: "table,[role=table]",
    row: "tr,[role=row]",
    cell: "td,[role=cell]",
    form: "form,[role=form]",
    navigation: "nav,[role=navigation]",
    main: "main,[role=main]",
    tab: "[role=tab]",
    menuitem: "[role=menuitem]",
    switch: "[role=switch]",
    slider: "input[type=range],[role=slider]",
    spinbutton: "input[type=number],[role=spinbutton]",
  };
  const all = (scope, css) => [...scope.querySelectorAll(css)];
  // The deepest matches only: text= on a list would otherwise match the list, its item and the page.
  const innermost = (els) => els.filter((e) => !els.some((o) => o !== e && e.contains(o)));
  const step = (part, scopes) => {
    let m;
    // frameLocator(): into each same-origin iframe's document (a cross-origin one can't be read).
    if (part === "frame") {
      return scopes.flatMap((e) => {
        try {
          return e.contentDocument ? [e.contentDocument] : [];
        } catch {
          return [];
        }
      });
    }
    // XPath, as Playwright reads it: xpath=…, or a part starting with // or .. (locator("..") is the parent).
    if ((m = /^xpath=(.*)$/s.exec(part)) || /^(\\/\\/|\\.\\.)/.test(part)) {
      const xp = m ? m[1] : part;
      return scopes.flatMap((s) => {
        const r = (s.ownerDocument ?? s).evaluate(xp, s, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        return Array.from({ length: r.snapshotLength }, (_, i) => r.snapshotItem(i)).filter((n) => n.nodeType === 1);
      });
    }
    if ((m = /^nth=(-?\\d+)$/.exec(part))) {
      const i = Number(m[1]);
      const el = scopes.at(i);
      return el ? [el] : [];
    }
    // filter({ hasText }): keeps the current matches that contain the text.
    if ((m = /^has-text=(.*)$/s.exec(part))) {
      const want = unq(m[1]);
      return scopes.filter((e) => e.nodeType === 1 && hit(textOf(e), want));
    }
    if ((m = /^text=(.*)$/s.exec(part))) {
      const want = unq(m[1]);
      return scopes.flatMap((s) => innermost(all(s, "*").filter((e) => hit(textOf(e), want))));
    }
    if ((m = /^label=(.*)$/s.exec(part))) {
      const want = unq(m[1]);
      return scopes.flatMap((s) => all(s, "input,textarea,select,[contenteditable],[role=textbox],[role=combobox]").filter((e) => hit(nameOf(e), want)));
    }
    if ((m = /^role=([a-z]+)(?:\\[name=(.*)\\])?$/s.exec(part))) {
      const css = ROLES[m[1]] ?? "[role=" + m[1] + "]";
      const want = m[2] == null ? null : unq(m[2]);
      return scopes.flatMap((s) => all(s, css).filter((e) => !want || hit(nameOf(e), want)));
    }
    // CSS, with any :has-text("…") taken out and applied as a filter.
    const texts = [];
    const css = part.replace(/:has-text\\((["'])(.*?)\\1\\)/g, (_, q, t) => { texts.push({ t, exact: false }); return ""; }) || "*";
    return scopes.flatMap((s) => all(s, css).filter((e) => texts.every((w) => hit(textOf(e), w))));
  };
  let found = [root ?? document];
  for (const part of sel.split(/\\s*>>\\s*/)) {
    found = [...new Set(step(part.trim(), found))];
  }
  return found;
})`;

/**
 * In-page: the visible controls (up to 15) as `tag#id placeholder= label= "text"`,
 * for a selector that matched nothing, so the agent's next try is right instead
 * of a snapshot to find out what's there.
 */
export const HINT = `(() => [...document.querySelectorAll("input,textarea,select,button,a[href],[role=button],[role=link],[contenteditable=true]")]
  .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
  .slice(0, 15)
  .map((e) => {
    const tag = e.tagName.toLowerCase();
    const bits = [tag + (e.id ? "#" + e.id : "")];
    const q = (s) => JSON.stringify(String(s).replace(/\\s+/g, " ").trim().slice(0, 40));
    const ph = e.getAttribute("placeholder");
    if (ph) bits.push("placeholder=" + q(ph));
    const label = e.labels && e.labels[0] ? e.labels[0].innerText : e.getAttribute("aria-label");
    if (label && label.trim()) bits.push("label=" + q(label));
    const text = tag === "input" || tag === "textarea" ? "" : e.innerText;
    if (text && text.trim()) bits.push(q(text));
    return bits.join(" ");
  })
  .join("; "))()`;

/** A selector a `page` call names, checked before anything runs in the page. */
export function parseSelector(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) throw new Error("Pass a selector.");
  return v.trim();
}

/** In-page expression: the `nth` match of `sel`, or a string saying why there's none to use. */
export function findExpression(sel: string, nth: number | null): string {
  return `(() => {
  const els = ${QUERY}(${JSON.stringify(sel)});
  const nth = ${nth == null ? "null" : Number(nth)};
  if (nth == null && els.length > 1) {
    const show = els.slice(0, 3).map((e) => "<" + e.tagName.toLowerCase() + "> " + JSON.stringify(String(e.innerText ?? e.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 40)));
    return "strict:" + els.length + ": " + show.join(", ");
  }
  return els.at(nth ?? 0) ?? "none:" + els.length;
})()`;
}

/** The error for a `findExpression` string result, in Playwright's words where agents know them. */
export function findError(sel: string, why: string): string {
  if (why.startsWith("strict:")) {
    const [, n, ...rest] = why.split(":");
    return `strict mode violation: ${JSON.stringify(sel)} matches ${n} elements (${rest.join(":").trim()}). Use .first(), .nth(i) or a narrower selector.`;
  }
  return `No element matches ${JSON.stringify(sel)} after waiting.`;
}
