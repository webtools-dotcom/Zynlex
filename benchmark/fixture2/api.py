import time

PRODUCTS = [
    {"id": 1, "name": "Desk Lamp", "price": 40},
    {"id": 2, "name": "Office Chair", "price": 120},
    {"id": 3, "name": "Notebook", "price": 6},
]

# Deal prices are in cents, like the payment provider's API.
DEALS = [
    {"id": 11, "name": "Lamp Bundle", "price": 4000},
    {"id": 12, "name": "Chair + Cushion", "price": 12900},
]

COUPONS = {"SAVE10": 0.10, "HALF": 0.50}
USERS = {"test@example.com": "hunter2"}


def handle(method, path, query, body, cookies):
    if method == "GET" and path == "/api/products":
        return 200, PRODUCTS
    if method == "GET" and path == "/api/deals":
        return 200, DEALS
    if method == "POST" and path == "/api/coupon":
        rate = COUPONS.get(str(body.get("code", "")).upper())
        return (200, {"rate": rate}) if rate else (400, {"error": "unknown coupon"})
    if method == "GET" and path == "/api/stock":
        time.sleep(1.5)  # the warehouse API is slow
        return 200, {"inStock": True, "count": 3}
    if method == "POST" and path == "/api/signup":
        return 200, {"ok": True}
    if method == "POST" and path == "/api/login":
        email, password = body.get("email"), body.get("password")
        if USERS.get(email) != password:
            return 401, {"error": "wrong email or password"}
        return 200, {"ok": True}, {"Set-Cookie": f"session={email}; Path=/api/login; HttpOnly"}
    if method == "GET" and path == "/api/account":
        email = cookies.get("session")
        return (200, {"email": email}) if email in USERS else (401, {"error": "not logged in"})
    if method == "POST" and path == "/api/checkout":
        return 200, {"ok": True}
    return 404, {"error": "not found"}
