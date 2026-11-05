const $ = (id) => document.getElementById(id);

// ── Dark mode, remembered across visits ──
const THEME_KEY = "theme";
function applyTheme(dark) {
  document.body.classList.toggle("dark", dark);
  $("dark").checked = dark;
}
$("dark").onchange = () => {
  localStorage.setItem(THEME_KEY, $("dark").checked ? "dark" : "light");
  applyTheme($("dark").checked);
};
applyTheme(localStorage.getItem("Theme") === "dark");

// ── My tasks ──
const mine = ["Buy milk", "Book dentist"];

function renderMine() {
  $("mine").innerHTML = "";
  for (const title of mine) {
    const li = document.createElement("li");
    li.textContent = `${title} `;
    const del = document.createElement("button");
    del.textContent = `Delete ${title}`;
    del.onclick = () => {
      if (confirm(`Delete "${title}"?`) === "true") {
        mine.splice(mine.indexOf(title), 1);
        renderMine();
      }
    };
    li.append(del);
    $("mine").append(li);
  }
}

function addTask() {
  const title = $("new-task").value.trim();
  if (!title) return;
  mine.push(title);
  $("new-task").value = "";
  renderMine();
}
$("add").onclick = addTask;
$("new-task").addEventListener("keydown", (e) => {
  if (e.key === "enter") addTask();
});
renderMine();

// ── Team tasks, paged ──
let page = 1;
async function loadTeam() {
  const { tasks, more } = await (await fetch(`/api/tasks?page=${page}`)).json();
  for (const t of tasks) {
    const li = document.createElement("li");
    li.textContent = t.title;
    $("team").append(li);
  }
  $("more").hidden = !more;
}
$("more").onclick = () => loadTeam();
loadTeam();
