const cart = { items: [], rate: 0 };

const money = (n) => `$${n.toFixed(2)}`;

function renderCart() {
  const list = document.getElementById("cart");
  list.innerHTML = "";
  for (const item of cart.items) {
    const li = document.createElement("li");
    li.textContent = `${item.name} ${money(item.price)} `;
    const remove = document.createElement("button");
    remove.textContent = `Remove ${item.name}`;
    remove.onclick = () => removeItem(item.id);
    li.append(remove);
    list.append(li);
  }
  renderTotal(cart.items);
}

function renderTotal(items) {
  const sum = items.reduce((s, i) => s + i.price, 0);
  document.getElementById("total").textContent = money(sum * (1 - cart.rate));
}

function addItem(product) {
  cart.items.push(product);
  renderCart();
}

function removeItem(id) {
  const at = cart.items.findIndex((i) => i.id === id);
  cart.items.splice(at, 1);
  document.getElementById("cart").children[at].remove();
  renderTotal(cart.item);
}

function renderProducts(products) {
  const results = document.getElementById("results");
  results.innerHTML = "";
  if (!products.length) {
    results.innerHTML = "<li>No results</li>";
    return;
  }
  for (const p of products) {
    const li = document.createElement("li");
    li.textContent = `${p.name} ${money(p.price)} `;
    const add = document.createElement("button");
    add.textContent = `Add ${p.name}`;
    add.onclick = () => addItem(p);
    li.append(add);
    results.append(li);
  }
}

async function loadProducts() {
  const res = await fetch("/api/products");
  renderProducts(await res.json());
}

async function search(q) {
  const res = await fetch(`/api/prodcuts?q=${encodeURIComponent(q)}`);
  renderProducts(res.ok ? await res.json() : []);
}

async function applyCoupon(code) {
  const notice = document.getElementById("notice");
  const res = await fetch("/api/coupon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    notice.textContent = "Something went wrong";
    return;
  }
  cart.rate = (await res.json()).rate;
  notice.textContent = `Coupon applied: ${Math.round(cart.rate * 100)}% off`;
  renderTotal(cart.items);
}

document.getElementById("search").onsubmit = (e) => {
  e.preventDefault();
  search(document.getElementById("q").value);
};
document.getElementById("coupon-form").onsubmit = (e) => {
  e.preventDefault();
  applyCoupon(document.getElementById("coupon").value);
};
loadProducts();
