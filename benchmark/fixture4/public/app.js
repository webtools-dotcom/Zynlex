const $ = (sel) => document.querySelector(sel);

const state = {
  city: "all",
  query: "",
  prefs: { city: "all", compact: false },
  eventId: null,
};

async function get(url) {
  const res = await fetch(url);
  return res.json();
}

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json() };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function setStatus(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle("error", isError);
}

// ── routing ────────────────────────────────────────────────────────────────

function parseRoute(hash) {
  const m = hash.match(/^#\/event\/(\d)/);
  if (m) return { view: "event", id: Number(m[1]) };
  const name = hash.replace(/^#\//, "");
  return { view: ["bookings", "settings"].includes(name) ? name : "events" };
}

function showView(view) {
  for (const sec of document.querySelectorAll(".view")) sec.hidden = sec.id !== `view-${view}`;
  for (const a of document.querySelectorAll("#nav a")) {
    a.classList.toggle("active", a.dataset.view === view || (view === "event" && a.dataset.view === "events"));
  }
}

async function route() {
  const r = parseRoute(location.hash);
  showView(r.view);
  closeMenu();
  if (r.view === "events") await loadEvents();
  if (r.view === "event") await loadEvent(r.id);
  if (r.view === "bookings") await loadBookings();
  if (r.view === "settings") fillPrefsForm();
}

// ── events list ────────────────────────────────────────────────────────────

function eventsUrl() {
  const params = new URLSearchParams({ city: state.city });
  if (state.query) params.set("q", state.query);
  return `/api/events?${params}`;
}

async function loadEvents() {
  markCity();
  const { events } = await get(eventsUrl());
  renderEvents(events);
}

function renderEvents(events) {
  $("#events").innerHTML = events
    .map(
      (ev) => `<li><a href="#/event/${ev.id}">
        <span class="title">${escapeHtml(ev.title)}</span>
        <span class="price">${money(ev.price)}</span>
        <span class="when">${formatDate(ev.date)} · ${escapeHtml(ev.city)}</span>
      </a></li>`,
    )
    .join("");
  $("#events-empty").hidden = events.length > 0;
}

function markCity() {
  for (const b of document.querySelectorAll("#cities button")) {
    b.classList.toggle("active", b.dataset.city === state.city);
  }
}

$("#search").addEventListener("input", (e) => {
  state.query = e.target.value.trim();
  loadEvents();
});

$("#cities").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-city]");
  if (!btn) return;
  state.city = btn.dataset.city;
  loadEvents();
});

// ── event detail ───────────────────────────────────────────────────────────

async function loadEvent(id) {
  state.eventId = id;
  const ev = await get(`/api/events/${id}`);
  $("#ev-title").textContent = ev.title;
  $("#ev-date").textContent = formatDate(ev.date);
  $("#ev-city").textContent = ev.city;
  $("#price").textContent = money(ev.price);
  $("#ev-left").textContent = ev.seats_left;
  $("#ev-desc").textContent = ev.description;
  $("#book").dataset.left = ev.seats_left;
  $("#book").dataset.price = ev.price;
  $("#seats").value = "1";
  setStatus($("#book-status"), "");
  $("#comment-text").value = "";
  await loadComments(id);
}

function validateBooking(name, seats, left) {
  if (!name) return "Please enter your name";
  if (!/^\d+$/.test(seats) || seats < 1) return "Enter a number of seats";
  if (seats > left) return `Only ${left} seats left`;
  return null;
}

$("#book-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const status = $("#book-status");
  const name = $("#name").value.trim();
  const seats = $("#seats").value.trim();
  const { left, price } = $("#book").dataset;
  const problem = validateBooking(name, seats, left);
  if (problem) return setStatus(status, problem, true);

  const res = await post("/api/bookings", { event_id: state.eventId, name, seats: Number(seats) });
  if (!res.ok) return setStatus(status, "Booking failed, please try again", true);
  setStatus(status, `Booked ${plural(res.data.seats, "seat")} · total ${money(res.data.seats * Number(price))}`);
});

async function loadComments(id) {
  const { comments } = await get(`/api/events/${id}/comments`);
  $("#comments").innerHTML = comments
    .map((c) => `<li><b>${escapeHtml(c.author)}</b>${escapeHtml(c.text)}</li>`)
    .join("");
}

$("#post-comment").addEventListener("click", async () => {
  const text = $("#comment-text").value.trim();
  if (!text) return;
  await post(`/api/events/${state.eventId}/comment`, { text });
  $("#comment-text").value = "";
  await loadComments(state.eventId);
});

// ── bookings ───────────────────────────────────────────────────────────────

async function loadBookings() {
  const { bookings } = await get("/api/bookings");
  $("#bookings").innerHTML = bookings
    .map(
      (b) => `<li>
        <span><b>${escapeHtml(b.title)}</b> · ${formatDate(b.date)} · ${plural(b.seats, "seat")} · ${money(b.total)}</span>
        <button class="cancel" data-id="${b.id}"><span class="label">Cancel booking</span></button>
      </li>`,
    )
    .join("");
  $("#bookings-empty").hidden = bookings.length > 0;
}

$("#bookings").addEventListener("click", async (e) => {
  if (!e.target.classList.contains("cancel")) return;
  e.target.disabled = true;
  await post("/api/bookings/cancel", { id: Number(e.target.dataset.id) });
  await loadBookings();
});

// ── settings ───────────────────────────────────────────────────────────────

function applyPrefs(prefs) {
  state.prefs = prefs;
  state.city = prefs.city;
  document.body.classList.toggle("compact", prefs.compact);
}

function fillPrefsForm() {
  $("#pref-city").value = state.prefs.city;
  $("#pref-compact").checked = state.prefs.compact;
  setStatus($("#prefs-status"), "");
}

$("#prefs-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const res = await post("/api/prefs", {
    city: $("#pref-city").value,
    compact: $("#pref-compact").checked,
  });
  if (!res.ok) return setStatus($("#prefs-status"), "Could not save settings", true);
  applyPrefs(res.data);
  setStatus($("#prefs-status"), "Saved");
});

// ── mobile menu ────────────────────────────────────────────────────────────

function closeMenu() {
  $("#nav").classList.remove("open");
  $("#menu-btn").setAttribute("aria-expanded", "false");
}

$("#menu-btn").addEventListener("click", () => {
  const open = $("#nav").classList.toggle("open");
  $("#menu-btn").setAttribute("aria-expanded", String(open));
});

// ── start ──────────────────────────────────────────────────────────────────

window.addEventListener("hashchange", route);

(async function start() {
  applyPrefs(await get("/api/prefs"));
  if (!location.hash) history.replaceState(null, "", "#/events");
  await route();
})();
