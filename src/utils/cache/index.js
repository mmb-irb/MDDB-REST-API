// Create a process-local cache for asynchronous endpoint results.
//
// `ttlMs` limits how long an entry can be reused and `maxEntries` bounds
// memory usage. Values are cached by key, while concurrent requests for the
// same missing or invalid key share the same producer promise.
const createCache = ({ ttlMs = 60 * 1000, maxEntries = 100 } = {}) => {
  const entries = new Map();
  const inFlight = new Map();

  // Return a cached value when it is fresh and valid; otherwise produce and
  // store a new value. `isValid` may be asynchronous and can invalidate an
  // otherwise unexpired entry when external data has changed.
  const getOrSet = async (key, producer, isValid = () => true) => {
    const entry = entries.get(key);
    // Use the cache if valid by time or by isValid function
    if (entry && entry.expiresAt > Date.now() && await isValid(entry.value)){
      return entry.value;}

    entries.delete(key);
    if (inFlight.has(key)) return inFlight.get(key);

    const pending = Promise.resolve().then(producer);
    inFlight.set(key, pending);
    try {
      const value = await pending;
      if (entries.size >= maxEntries)
        entries.delete(entries.keys().next().value);
      entries.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
      });
      return value;
    } finally {
      inFlight.delete(key);
    }
  };

  return {
    getOrSet,
    // Remove all completed values without affecting producers already running.
    clear: () => entries.clear(),
    // Remove one completed value so the next request produces it again.
    delete: key => entries.delete(key),
  };
};

module.exports = createCache;
