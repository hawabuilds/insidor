/** In-memory cache with optional stale-while-revalidate. */
const store = new Map();
const inflight = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry || Date.now() > entry.exp) {
    store.delete(key);
    return null;
  }
  return entry.val;
}

function set(key, val, ttlMs = 300000) {
  store.set(key, { val, at: Date.now(), exp: Date.now() + ttlMs, staleMs: ttlMs });
}

/**
 * SWR lookup — entry kept until staleMs elapses.
 * @returns {{ hit:false } | { hit:true, value, fresh:boolean, stale:boolean, age:number }}
 */
function swr(key, { ttlMs = 120000, staleMs = 900000 } = {}) {
  const entry = store.get(key);
  if (!entry) return { hit: false };

  const age = Date.now() - entry.at;
  const maxAge = entry.staleMs ?? staleMs;

  if (age > maxAge) {
    store.delete(key);
    return { hit: false };
  }

  return {
    hit: true,
    value: entry.val,
    fresh: age <= ttlMs,
    stale: age > ttlMs,
    age,
  };
}

function setSwr(key, val, { staleMs = 900000 } = {}) {
  store.set(key, { val, at: Date.now(), exp: Date.now() + staleMs, staleMs });
}

function refreshBackground(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const job = Promise.resolve()
    .then(fn)
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

module.exports = { get, set, swr, setSwr, refreshBackground };
