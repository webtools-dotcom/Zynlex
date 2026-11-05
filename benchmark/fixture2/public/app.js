const cart = { items: [], rate: 0 };

const money = (n) => `$${n.toFixed(2)}`;
const $ = (id) => document.getElementById(id);

function renderTotal() {
  const sum = cart.items.reduce((s, i) => s + i.price, 0);
  $("total").textContent = money(sum * (1 - cart.rate));
}

function renderCart() {
  $("cart").innerHTML = "";
  for (const item of cart.items) {
    const li = document.createElement("li");
    li.textContent = `${item.name} ${money(item.price)}`;
    $("cart").append(li);
  }
  renderTotal();
}

function addItem(product) {
  cart.items.push(product);
  // Prices may have changed, so start the cart over from a clean state.
  cart.rate = 0;
  renderCart();
}

function listItem(name, price, onAdd) {
  const li = document.createElement("li");
  li.textContent = `${name} ${money(price)} `;
  const add = document.createElement("button");
  add.textContent = `Add ${name}`;
  add.onclick = onAdd;
  li.append(add);
  return li;
}

async function loadProducts() {
  const products = await (await fetch("/api/products")).json();
  for (const p of products) $("products").append(listItem(p.name, p.price, () => addItem(p)));
}

async function loadDeals() {
  const deals = await (await fetch("/api/deals")).json();
  for (const d of deals) {
    $("deals").append(listItem(d.name, d.price, () => addItem({ ...d, price: d.price / 100 })));
  }
}

$("coupon-form").onsubmit = async (e) => {
  e.preventDefault();
  const res = await fetch("/api/coupon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: $("coupon").value }),
  });
  if (!res.ok) {
    $("notice").textContent = "Unknown coupon";
    return;
  }
  cart.rate = (await res.json()).rate;
  $("notice").textContent = `Coupon applied: ${Math.round(cart.rate * 100)}% off`;
  renderTotal();
};

$("stock").onclick = async () => {
  $("stock-status").textContent = "Checking...";
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 1000);
  try {
    const res = await fetch("/api/stock", { signal: ctrl.signal });
    const { inStock, count } = await res.json();
    $("stock-status").textContent = inStock ? `In stock (${count} left)` : "Out of stock";
  } catch {
    $("stock-status").textContent = "Out of stock";
  }
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2}$/i;
$("signup").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("signup-email").value.trim();
  if (!EMAIL.test(email)) {
    $("signup-status").textContent = "Please enter a valid email";
    return;
  }
  await fetch("/api/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: $("signup-password").value }),
  });
  $("signup-status").textContent = "Thanks for signing up";
};

async function loadAccount() {
  const res = await fetch("/api/account");
  $("account").textContent = res.ok ? `Logged in as ${(await res.json()).email}` : "Please log in";
}

$("login").onsubmit = async (e) => {
  e.preventDefault();
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: $("login-email").value, password: $("login-password").value }),
  });
  if (!res.ok) {
    $("account").textContent = "Wrong email or password";
    return;
  }
  await loadAccount();
};

$("close-promo").onclick = () => $("promo").classList.add("closed");

$("checkout").onclick = async () => {
  await fetch("/api/checkout", { method: "POST" });
  $("checkout-status").textContent = "Checkout started";
};

loadProducts();
loadDeals();
loadAccount();
