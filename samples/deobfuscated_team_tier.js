function TaskScheduler(maxConcurrent) {
  const queue = [];
  const completed = [];

  function add(name, priority) {
    const id = "task_" + Math.random().toString(36).substr(2, 6);
    const task = { id, name, priority, status: "queued" };
    queue.push(task);
    queue.sort((a, b) => b.priority - a.priority);
    return task;
  }

  function processNext() {
    if (queue.length === 0) {
      return null;
    }
    const task = queue.shift();
    task.status = "completed";
    task.completedAt = Date.now();
    completed.push(task);
    return task;
  }

  function getStats() {
    return {
      queued: queue.length,
      completed: completed.length,
      nextUp: queue.length > 0 ? queue[0].name : null,
    };
  }

  return { maxConcurrent, add, processNext, getStats };
}

// === Task Scheduler Demo ===
console.log("=== Task Scheduler Demo ===");

const scheduler = TaskScheduler(3);

scheduler.add("Send emails", 1);
scheduler.add("Generate report", 3);
scheduler.add("Resize images", 2);
scheduler.add("Sync database", 5);
scheduler.add("Clear cache", 0);

console.log("Stats:", JSON.stringify(scheduler.getStats()));

for (let i = 0; i < 3; i++) {
  const task = scheduler.processNext();
  console.log("Process:", JSON.stringify(task));
}

console.log("Remaining:", JSON.stringify(scheduler.getStats()));
