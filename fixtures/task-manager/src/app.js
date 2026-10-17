import { createStore, addTask, toggleTask, removeTask, getStats, filterByPriority } from "./tasks.js";

const store = createStore();
const $ = (id) => document.getElementById(id);

function render() {
  const stats = getStats(store);
  $("pending").textContent = stats.pending;
  $("completed").textContent = stats.completed;
  const list = $("list");
  list.innerHTML = "";
  for (const task of filterByPriority(store, $("filter").value)) {
    const li = document.createElement("li");
    li.className = task.completed ? "done" : "";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = task.completed;
    box.addEventListener("change", () => { toggleTask(store, task.id); render(); });
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = task.title;
    const badge = document.createElement("span");
    badge.className = `badge ${task.priority}`;
    badge.textContent = task.priority;
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.addEventListener("click", () => { removeTask(store, task.id); render(); });
    li.append(box, title, badge, del);
    list.append(li);
  }
}

$("new-task").addEventListener("submit", (e) => {
  e.preventDefault();
  addTask(store, { title: $("title").value, priority: $("priority").value });
  $("title").value = "";
  render();
});
$("filter").addEventListener("change", render);
render();
