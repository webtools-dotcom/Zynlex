document.getElementById("fb").onsubmit = async (e) => {
  e.preventDefault();
  const status = document.getElementById("fb-status");
  const res = await fetch("/api/feedbak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: document.getElementById("fb-text").value }),
  });
  if (res.ok) status.textContent = "Thanks for your feedback!";
};
