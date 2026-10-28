/**
 * Stale-while-revalidate cache: show the last data we saw instantly, then replace it with fresh data.
 *
 * Entries are namespaced by user id (a shared browser never shows one account's data to another) and
 * cleared on logout. They live in memory for instant reads and in localStorage so the last view survives
 * a reload. Entries older than MAX_AGE_MS are ignored.
 */
const PREFIX = "lm_cache:";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const mem = new Map();

const keyOf = (userId, key) => `${PREFIX}${userId}:${key}`;

export function readCache(userId, key) {
  if (!userId) return null;
  const k = keyOf(userId, key);
  if (mem.has(k)) return mem.get(k).data;
  try {
    const raw = localStorage.getItem(k);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || Date.now() - entry.t > MAX_AGE_MS) { localStorage.removeItem(k); return null; }
    mem.set(k, entry);
    return entry.data;
  } catch { return null; }
}

export function cacheAge(userId, key) {
  if (!userId) return Infinity;
  const entry = mem.get(keyOf(userId, key));
  return entry ? Date.now() - entry.t : Infinity;
}

export function writeCache(userId, key, data) {
  if (!userId) return;
  const k = keyOf(userId, key);
  const entry = { t: Date.now(), data };
  mem.set(k, entry);
  try { localStorage.setItem(k, JSON.stringify(entry)); } catch { /* storage full or blocked: memory copy still works */ }
}

export function clearCaches() {
  mem.clear();
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
}
