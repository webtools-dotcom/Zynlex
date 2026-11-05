PRODUCTS = [
    {"id": 1, "name": "Desk Lamp", "price": 40},
    {"id": 2, "name": "Office Chair", "price": 120},
    {"id": 3, "name": "Notebook", "price": 6},
    {"id": 4, "name": "Monitor Stand", "price": 35},
]

COUPONS = {"SAVE10": 0.10, "HALF": 0.50}


def handle(method, path, query, body):
    if method == "GET" and path == "/api/products":
        q = (query.get("q") or [""])[0].lower()
        return 200, [p for p in PRODUCTS if q in p["name"].lower()]
    if method == "POST" and path == "/api/coupon":
        rate = COUPONS.get(body["coupon"].upper())
        if rate is None:
            return 400, {"error": "unknown coupon"}
        return 200, {"rate": rate}
    return 404, {"error": "not found"}
