import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, addTask, toggleTask, removeTask, getStats, filterByPriority } from "../src/tasks.js";

test("addTask creates a pending task with a priority", () => {
  const store = createStore();
  const task = addTask(store, { title: "Write pitch", priority: "high" });
  assert.equal(task.completed, false);
  assert.equal(task.priority, "high");
  assert.deepEqual(getStats(store), { pending: 1, completed: 0, total: 1 });
});

test("addTask rejects empty titles and unknown priorities", () => {
  const store = createStore();
  assert.throws(() => addTask(store, { title: "   " }), /title is required/);
  assert.throws(() => addTask(store, { title: "x", priority: "urgent" }), /Unknown priority/);
});

test("toggleTask marks a task as completed", () => {
  const store = createStore();
  const task = addTask(store, { title: "Demo" });
  toggleTask(store, task.id);
  assert.equal(store.tasks[0].completed, true);
});

test("completing a task moves it from the pending counter to the completed counter", () => {
  const store = createStore();
  const a = addTask(store, { title: "A" });
  addTask(store, { title: "B" });
  toggleTask(store, a.id);
  assert.deepEqual(getStats(store), { pending: 1, completed: 1, total: 2 });
  toggleTask(store, a.id);
  assert.deepEqual(getStats(store), { pending: 2, completed: 0, total: 2 });
});

test("filterByPriority returns only matching tasks", () => {
  const store = createStore();
  addTask(store, { title: "Low", priority: "low" });
  addTask(store, { title: "High", priority: "high" });
  assert.equal(filterByPriority(store, "high").length, 1);
  assert.equal(filterByPriority(store, "all").length, 2);
});

test("removeTask keeps the counters consistent", () => {
  const store = createStore();
  const a = addTask(store, { title: "A" });
  removeTask(store, a.id);
  assert.deepEqual(getStats(store), { pending: 0, completed: 0, total: 0 });
});
