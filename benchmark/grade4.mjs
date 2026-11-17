// Graders for fixture4 (TeamHub). grade4(task, page, port) drives the app with
// real clicks and typing and returns null for PASS or a short reason string.
// Give each call a fresh browser context: the app keeps visitor state in cookies.

const titles = (page) => page.$$eval("#events li .title", (els) => els.map((e) => e.textContent.trim()));
const text = (page, sel) => page.textContent(sel).then((t) => t.trim());
const clickCenter = async (page, sel) => {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error(`${sel} is not visible`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};

async function openEvent(page, base, id) {
  await page.goto(`${base}#/event/${id}`);
  await page.waitForFunction(() => document.querySelector("#ev-title").textContent.trim() !== "", null, { timeout: 5000 });
}

async function book(page, base, id, name, seats) {
  await openEvent(page, base, id);
  await page.fill("#name", name);
  await page.fill("#seats", String(seats));
  await page.click("#book");
  await page.waitForTimeout(300);
  return text(page, "#book-status");
}

export async function grade4(task, page, port) {
  const base = `http://127.0.0.1:${port}/`;

  if (task === "search") {
    await page.goto(`${base}#/events`);
    await page.waitForSelector("#events li", { timeout: 5000 });
    await page.type("#search", "yoga", { delay: 60 });
    await page.waitForTimeout(1000);
    const got = await titles(page);
    if (got.join("|") !== "Sunrise Yoga|Yoga in the Park") return `results for "yoga": ${got.join(", ")}`;
    await page.fill("#search", "");
    await page.waitForTimeout(400);
    const all = await titles(page);
    return all.length === 12 ? null : `clearing the search shows ${all.length} events, want 12`;
  }

  if (task === "details") {
    await page.goto(`${base}#/events`);
    await page.waitForSelector("text=Hackathon Friday", { timeout: 5000 });
    await page.click("text=Hackathon Friday");
    await page.waitForTimeout(400);
    const t = await text(page, "#ev-title");
    if (t !== "Hackathon Friday") return `opening Hackathon Friday shows "${t}"`;
    await page.goBack();
    await page.waitForSelector("text=Cooking Class", { timeout: 3000 });
    await page.click("text=Cooking Class");
    await page.waitForTimeout(400);
    const t2 = await text(page, "#ev-title");
    return t2 === "Cooking Class" ? null : `opening Cooking Class shows "${t2}"`;
  }

  if (task === "price") {
    await openEvent(page, base, 4);
    const p = await text(page, "#price");
    if (p !== "$6.03") return `Bowling Night price shows ${p}, want $6.03`;
    const s = await book(page, base, 4, "Sam", 2);
    if (!s.endsWith("$12.06")) return `booking 2 Bowling tickets: "${s}", want total $12.06`;
    await openEvent(page, base, 1);
    const p1 = await text(page, "#price");
    return p1 === "$12.50" ? null : `Sunrise Yoga price shows ${p1}, want $12.50`;
  }

  if (task === "seats") {
    for (const n of [10, 12, 9]) {
      const s = await book(page, base, 3, "Sam", n);
      if (s !== "Only 8 seats left") return `booking ${n} of 8 seats left: "${s}"`;
    }
    const s = await book(page, base, 3, "Sam", 8);
    if (!s.startsWith("Booked 8 seats")) return `booking 8 of 8 seats left: "${s}"`;
    const s2 = await book(page, base, 3, "Sam", 0);
    return s2 === "Enter a number of seats" ? null : `booking 0 seats: "${s2}"`;
  }

  if (task === "comments") {
    await openEvent(page, base, 2);
    await page.fill("#comment-text", "See you all there");
    await page.click("#post-comment");
    await page.waitForTimeout(500);
    if (!(await text(page, "#comments")).includes("See you all there")) return "posted comment is not listed";
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#comments li"), null, { timeout: 5000 });
    const after = await text(page, "#comments");
    if (!after.includes("See you all there")) return "posted comment is gone after reload";
    return after.includes("I'll bring snacks!") ? null : "the existing comment disappeared";
  }

  if (task === "cancel") {
    for (const [id, title] of [[1, "Sunrise Yoga"], [5, "Board Games Day"]]) {
      const s = await book(page, base, id, "Sam", 1);
      if (!s.startsWith("Booked")) return `could not book ${title}: "${s}"`;
    }
    await page.goto(`${base}#/bookings`);
    await page.waitForSelector("#bookings li", { timeout: 5000 });
    await clickCenter(page, "#bookings li:has-text('Sunrise Yoga') button");
    await page.waitForTimeout(500);
    const t = await text(page, "#bookings");
    if (t.includes("Sunrise Yoga")) return "Sunrise Yoga is still listed after Cancel booking";
    if (!t.includes("Board Games Day")) return "cancelling one booking removed the other too";
    await page.reload();
    await page.waitForSelector("#bookings li", { timeout: 5000 });
    return (await text(page, "#bookings")).includes("Sunrise Yoga") ? "the cancelled booking came back after reload" : null;
  }

  if (task === "settings") {
    await page.goto(`${base}#/settings`);
    await page.waitForTimeout(300);
    await page.selectOption("#pref-city", "Lisbon");
    await page.check("#pref-compact");
    await page.click("#save-prefs");
    await page.waitForSelector("text=Saved", { timeout: 3000 });
    await page.reload();
    await page.waitForTimeout(500);
    const city = await page.inputValue("#pref-city");
    const compact = await page.isChecked("#pref-compact");
    if (city !== "Lisbon" || !compact) return `after reload: home city=${city}, compact=${compact}`;
    await page.click("#nav a[data-view='events']");
    await page.waitForSelector("#events li", { timeout: 5000 });
    const cities = await page.$$eval("#events li .when", (els) => els.map((e) => e.textContent.split("·")[1].trim()));
    return cities.every((c) => c === "Lisbon") ? null : `events list after reload shows ${[...new Set(cities)].join(", ")}`;
  }

  if (task === "mobile") {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`${base}#/events`);
    await page.waitForSelector("#events li", { timeout: 5000 });
    await clickCenter(page, "#cities button[data-city='Lisbon']");
    await page.waitForTimeout(400);
    const hash = await page.evaluate(() => location.hash);
    if (hash !== "#/events") return `tapping the Lisbon filter went to ${hash}`;
    const when = await page.$$eval("#events li .when", (els) => els.map((e) => e.textContent));
    if (!when.length || when.some((w) => !w.includes("Lisbon"))) return "tapping the Lisbon filter didn't filter the list";
    await clickCenter(page, "#menu-btn");
    await page.waitForTimeout(300);
    await clickCenter(page, "#nav a[data-view='bookings']");
    await page.waitForTimeout(400);
    const shown = await page.isVisible("#view-bookings");
    return shown ? null : "the menu's My bookings link no longer works on a narrow window";
  }

  return `unknown task ${task}`;
}
