"""TeamHub API. State that belongs to one visitor (bookings, comments,
preferences) lives in cookies, so every browser session starts clean."""
import json, time
from urllib.parse import quote, unquote

EVENTS = [
    {"id": 1, "title": "Sunrise Yoga", "city": "Berlin", "date": "2026-12-02", "price": 1250, "seats_left": 15,
     "description": "An easy flow on the rooftop terrace. Mats are provided."},
    {"id": 2, "title": "Holiday Party", "city": "Berlin", "date": "2026-12-18", "price": 0, "seats_left": 30,
     "description": "Food, music and the yearly awards. Partners welcome."},
    {"id": 3, "title": "Cooking Class", "city": "Lisbon", "date": "2026-12-05", "price": 4500, "seats_left": 8,
     "description": "Learn three classic Portuguese dishes with chef Rita."},
    {"id": 4, "title": "Bowling Night", "city": "Berlin", "date": "2026-12-09", "price": 603, "seats_left": 20,
     "description": "Tickets are $6.03 each (lane and shoes included)."},
    {"id": 5, "title": "Board Games Day", "city": "Lisbon", "date": "2026-12-12", "price": 800, "seats_left": 12,
     "description": "Bring your favourite game or learn a new one."},
    {"id": 6, "title": "City Walking Tour", "city": "Lisbon", "date": "2026-12-06", "price": 1500, "seats_left": 25,
     "description": "Two hours through Alfama with a local guide."},
    {"id": 7, "title": "Climbing Gym", "city": "Berlin", "date": "2026-12-14", "price": 2200, "seats_left": 10,
     "description": "Beginners welcome, shoes can be rented on site."},
    {"id": 8, "title": "Wine Tasting", "city": "Lisbon", "date": "2026-12-16", "price": 3000, "seats_left": 14,
     "description": "Six wines from the Douro valley, with snacks."},
    {"id": 9, "title": "Karaoke Evening", "city": "Berlin", "date": "2026-12-11", "price": 1000, "seats_left": 18,
     "description": "Private booth for the whole team."},
    {"id": 10, "title": "Yoga in the Park", "city": "Lisbon", "date": "2026-12-13", "price": 0, "seats_left": 40,
     "description": "Weather permitting. Bring water and a towel."},
    {"id": 11, "title": "Pottery Workshop", "city": "Berlin", "date": "2026-12-15", "price": 3800, "seats_left": 9,
     "description": "Make a mug and pick it up glazed a week later."},
    {"id": 12, "title": "Hackathon Friday", "city": "Lisbon", "date": "2026-12-19", "price": 0, "seats_left": 50,
     "description": "Build anything in a day. Pizza from 6 pm."},
]

SEED_COMMENTS = {
    2: [{"author": "Anna", "text": "I'll bring snacks!"}],
    4: [{"author": "Tom", "text": "Who wants to share a lane?"}],
}

DEFAULT_PREFS = {"city": "all", "compact": False}


def read_cookie(cookies, name, default):
    raw = cookies.get(name)
    if not raw:
        return default
    try:
        return json.loads(unquote(raw))
    except ValueError:
        return default


def set_cookie(name, value, path="/"):
    return {"Set-Cookie": f"{name}={quote(json.dumps(value, separators=(',', ':')), safe='')}; Path={path}; SameSite=Lax"}


def summary(ev):
    return {k: ev[k] for k in ("id", "title", "city", "date", "price")}


def find_event(event_id):
    return next((e for e in EVENTS if str(e["id"]) == str(event_id)), None)


def handle(method, path, query, body, cookies):
    parts = [p for p in path.split("/") if p][1:]  # drop "api"
    body = body or {}

    if method == "GET" and parts == ["events"]:
        q = (query.get("q") or [""])[0].strip().lower()
        city = (query.get("city") or ["all"])[0]
        if q:
            # Search is backed by a slow full-text index; short queries scan more.
            time.sleep(max(0.0, 0.5 - 0.12 * len(q)))
        items = [summary(e) for e in EVENTS
                 if (not q or q in e["title"].lower()) and (city == "all" or e["city"] == city)]
        items.sort(key=lambda e: e["date"])
        return 200, {"events": items}

    if parts[:1] == ["events"] and len(parts) >= 2:
        ev = find_event(parts[1])
        if not ev:
            return 404, {"error": "no such event"}
        comments = read_cookie(cookies, "comments", {})
        mine = comments.get(str(ev["id"]), [])
        if method == "GET" and len(parts) == 2:
            return 200, ev
        if method == "GET" and parts[2:] == ["comments"]:
            return 200, {"comments": SEED_COMMENTS.get(ev["id"], []) + mine}
        if method == "POST" and parts[2:] == ["comments"]:
            text = str(body.get("text", "")).strip()
            if not text:
                return 400, {"error": "comment is empty"}
            mine = mine + [{"author": "You", "text": text[:500]}]
            comments[str(ev["id"])] = mine
            return 201, {"ok": True}, set_cookie("comments", comments)

    if parts == ["bookings"]:
        bookings = read_cookie(cookies, "bookings", [])
        if method == "GET":
            return 200, {"bookings": bookings}
        ev = find_event(body.get("event_id"))
        name = str(body.get("name", "")).strip()
        try:
            seats = int(body.get("seats"))
        except (TypeError, ValueError):
            seats = 0
        if not ev or not name or seats < 1:
            return 400, {"error": "invalid booking"}
        booking = {"id": max([b["id"] for b in bookings], default=0) + 1, "event_id": ev["id"],
                   "title": ev["title"], "date": ev["date"], "seats": seats, "name": name,
                   "total": seats * ev["price"]}
        return 201, booking, set_cookie("bookings", bookings + [booking])

    if method == "POST" and parts == ["bookings", "cancel"]:
        bookings = read_cookie(cookies, "bookings", [])
        left = [b for b in bookings if b["id"] != body.get("id")]
        if len(left) == len(bookings):
            return 404, {"error": "no such booking"}
        return 200, {"ok": True}, set_cookie("bookings", left)

    if parts == ["prefs"]:
        if method == "GET":
            return 200, read_cookie(cookies, "prefs", DEFAULT_PREFS)
        prefs = {"city": body.get("city") if body.get("city") in ("all", "Berlin", "Lisbon") else "all",
                 "compact": bool(body.get("compact"))}
        return 200, prefs, set_cookie("prefs", prefs, path="/api/prefs/")

    return 404, {"error": "not found"}
