// Small per-key async mutex. JSON persistence is synchronous, but a chat turn
// awaits the model, so two requests on the same conversation can interleave
// and overwrite each other. Serialize those turns by conversation id.
const queues = new Map();

export async function withKeyLock(key, fn) {
  const previous = queues.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  queues.set(key, current);
  try {
    await previous;
    return await fn();
  } finally {
    release();
    if (queues.get(key) === current) queues.delete(key);
  }
}
