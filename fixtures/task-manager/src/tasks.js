// Core task-manager state. Pure functions over a plain store object so the
// browser UI and the Node test suite share exactly the same logic.

export const PRIORITIES = ["low", "medium", "high"];

export function createStore() {
  return {
    tasks: [],
    nextId: 1,
    // Dashboard counters, kept in sync by every mutation below.
    stats: { pending: 0, completed: 0 },
  };
}

export function addTask(store, { title, priority = "medium" } = {}) {
  const clean = typeof title === "string" ? title.trim() : "";
  if (!clean) throw new Error("Task title is required");
  if (!PRIORITIES.includes(priority)) throw new Error(`Unknown priority: ${priority}`);

  const task = { id: store.nextId++, title: clean, priority, completed: false };
  store.tasks.push(task);
  store.stats.pending += 1;
  return task;
}

export function toggleTask(store, id) {
  const task = store.tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task ${id} not found`);
  task.completed = !task.completed;
  return task;
}

export function removeTask(store, id) {
  const index = store.tasks.findIndex((t) => t.id === id);
  if (index === -1) throw new Error(`Task ${id} not found`);
  const [task] = store.tasks.splice(index, 1);
  if (task.completed) store.stats.completed -= 1;
  else store.stats.pending -= 1;
  return task;
}

export function getStats(store) {
  return { ...store.stats, total: store.tasks.length };
}

export function filterByPriority(store, priority) {
  if (priority === "all") return [...store.tasks];
  return store.tasks.filter((t) => t.priority === priority);
}
