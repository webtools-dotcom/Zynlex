// Grades one task against a running fixture: node grade.mjs <task> <port>.
// Prints PASS or FAIL: <reason>. Uses the installed Edge, headless.
import { chromium } from "playwright-core";

const [task, port] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const total = () => page.textContent("#total");

async function grade() {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector("text=Add Desk Lamp", { timeout: 5000 }).catch(() => {});
  if (task === "coupon") {
    await page.click("text=Add Desk Lamp");
    await page.fill("#coupon", "SAVE10");
    await page.click("text=Apply coupon");
    await page.waitForTimeout(500);
    const t = await total();
    return t === "$36.00" ? null : `total after SAVE10 on $40 is ${t}, want $36.00`;
  }
  if (task === "remove") {
    await page.click("text=Add Desk Lamp");
    await page.click("text=Add Notebook");
    await page.click("text=Remove Desk Lamp");
    await page.waitForTimeout(300);
    const t = await total();
    if (errors.length) return `page error: ${errors[0]}`;
    return t === "$6.00" ? null : `total after removing the lamp is ${t}, want $6.00`;
  }
  if (task === "search") {
    await page.fill("#q", "lamp");
    await page.click("button:has-text('Search')");
    await page.waitForTimeout(500);
    const text = await page.textContent("#results");
    return text.includes("Desk Lamp") && !text.includes("Chair")
      ? null
      : `results for "lamp": ${text.trim().slice(0, 80)}`;
  }
  // ── fixture2 ──
  const status = (id) => page.textContent(`#${id}`).then((t) => t.trim());
  if (task === "deals") {
    await page.waitForSelector("text=Add Lamp Bundle", { timeout: 5000 });
    const text = await page.textContent("#deals");
    if (!text.includes("$40.00") || text.includes("$4000")) return `deals list: ${text.trim()}`;
    await page.click("text=Add Lamp Bundle");
    const t = await total();
    return t === "$40.00" ? null : `total after adding the $40 bundle is ${t}`;
  }
  if (task === "discount") {
    await page.click("text=Add Desk Lamp");
    await page.fill("#coupon", "SAVE10");
    await page.click("text=Apply coupon");
    await page.waitForTimeout(400);
    await page.click("text=Add Notebook");
    const t = await total();
    return t === "$41.40" ? null : `total for $46 with SAVE10 is ${t}, want $41.40`;
  }
  if (task === "stock") {
    await page.click("#stock");
    await page.waitForTimeout(3000);
    const s = await status("stock-status");
    return s.startsWith("In stock") ? null : `stock status after 3s: ${s}`;
  }
  if (task === "signup") {
    const tryEmail = async (email) => {
      await page.fill("#signup-email", email);
      await page.fill("#signup-password", "pw");
      await page.click("text=Create account");
      await page.waitForTimeout(300);
      return status("signup-status");
    };
    for (const ok of ["jane@example.com", "a.b@shop.co.uk", "x@y.io"]) {
      const s = await tryEmail(ok);
      if (s !== "Thanks for signing up") return `${ok}: ${s}`;
    }
    const s = await tryEmail("not-an-email");
    return s === "Please enter a valid email" ? null : `"not-an-email" was accepted: ${s}`;
  }
  if (task === "login") {
    await page.fill("#login-email", "test@example.com");
    await page.fill("#login-password", "hunter2");
    await page.click("text=Log in");
    await page.waitForTimeout(500);
    const s = await status("account");
    if (s !== "Logged in as test@example.com") return `after login: ${s}`;
    await page.reload();
    await page.waitForTimeout(500);
    const after = await status("account");
    return after === "Logged in as test@example.com" ? null : `after reload: ${after}`;
  }
  if (task === "checkout") {
    await page.click("#close-promo");
    await page.waitForTimeout(400);
    // A real click at the button's centre: whatever is on top there gets it.
    const box = await page.locator("#checkout").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(400);
    const s = await status("checkout-status");
    return s === "Checkout started" ? null : `checkout status: "${s}"`;
  }
  // ── fixture3 (held out) ──
  const mineText = () => page.textContent("#mine");
  if (task === "iframe") {
    const frame = page.frameLocator("#feedback");
    await frame.locator("#fb-text").fill("Great app");
    await frame.locator("text=Send feedback").click();
    await page.waitForTimeout(500);
    const s = (await frame.locator("#fb-status").textContent()).trim();
    return s === "Thanks for your feedback!" ? null : `feedback status: "${s}"`;
  }
  if (task === "confirm") {
    page.on("dialog", (d) => d.accept());
    await page.click("text=Delete Buy milk");
    await page.waitForTimeout(300);
    const t = await mineText();
    if (t.includes("Buy milk")) return "Buy milk is still listed after confirming";
    // Cancelling must still keep the task.
    page.removeAllListeners("dialog");
    page.on("dialog", (d) => d.dismiss());
    await page.click("text=Delete Book dentist");
    await page.waitForTimeout(300);
    return (await mineText()).includes("Book dentist") ? null : "cancel deleted the task anyway";
  }
  if (task === "storage") {
    await page.check("#dark");
    await page.reload();
    await page.waitForTimeout(300);
    const dark = await page.evaluate(() => document.body.classList.contains("dark"));
    const box = await page.isChecked("#dark");
    if (!dark || !box) return `after reload: body.dark=${dark}, checkbox=${box}`;
    await page.uncheck("#dark");
    await page.reload();
    await page.waitForTimeout(300);
    const still = await page.evaluate(() => document.body.classList.contains("dark"));
    return still ? "turning dark mode off didn't stick either" : null;
  }
  if (task === "enter") {
    await page.fill("#new-task", "Walk the dog");
    await page.press("#new-task", "Enter");
    await page.waitForTimeout(200);
    if (!(await mineText()).includes("Walk the dog")) return "Enter didn't add the task";
    await page.fill("#new-task", "Water plants");
    await page.click("#add");
    await page.waitForTimeout(200);
    return (await mineText()).includes("Water plants") ? null : "the Add button stopped working";
  }
  if (task === "loadmore") {
    await page.waitForSelector("text=Task 5", { timeout: 5000 });
    await page.click("#more");
    await page.waitForTimeout(500);
    await page.click("#more");
    await page.waitForTimeout(500);
    const items = await page.$$eval("#team li", (lis) => lis.map((l) => l.textContent.trim()));
    const want = Array.from({ length: 15 }, (_, i) => `Task ${i + 1}`);
    if (JSON.stringify(items) !== JSON.stringify(want)) return `team list: ${items.join(", ")}`;
    return (await page.isHidden("#more")) ? null : "Load more still shown after the last page";
  }
  return `unknown task ${task}`;
}

const fail = await grade().catch((e) => e.message.split("\n")[0]);
console.log(fail ? `FAIL: ${fail}` : "PASS");
await browser.close();
