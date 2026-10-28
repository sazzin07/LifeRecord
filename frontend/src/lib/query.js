import { api } from "@/lib/api";
import { cacheAge, readCache, writeCache } from "@/lib/swrCache";

/**
 * Query layer shared by every page: GET results are cached per signed-in user so a page can paint the
 * last-seen data immediately and refresh it in the background.
 *
 * Staleness rules: a normal load joins an identical request already in flight (so prefetching and the page
 * share one round trip). A forced reload (after you change something) always starts a new request, and only
 * the newest request for a path may update the cache, so an older response can never overwrite newer data.
 */
let currentUser = null;
export function setCacheUser(id) { currentUser = id || null; }

const kind = (path) => `q:${path}`;
const inflight = new Map();
const newest = new Map();
const subscribers = new Map(); // path -> mounted hooks watching it (they refresh themselves)
const known = new Set(); // paths cached during this session

export function peekQuery(path) {
  return currentUser ? readCache(currentUser, kind(path)) : null;
}

export function writeQuery(path, data) {
  if (currentUser) writeCache(currentUser, kind(path), data);
}

export function fetchQuery(path, { force = false } = {}) {
  const uid = currentUser;
  const k = `${uid}|${path}`;
  if (!force && inflight.has(k)) return inflight.get(k);
  const id = (newest.get(k) || 0) + 1;
  newest.set(k, id);
  const p = api.get(path)
    .then(({ data }) => {
      if (newest.get(k) === id && uid === currentUser) { writeCache(uid, kind(path), data); known.add(path); }
      return data;
    })
    .finally(() => { if (inflight.get(k) === p) inflight.delete(k); });
  inflight.set(k, p);
  return p;
}

/** Fire-and-forget warm-up; skipped when the cached copy is younger than maxAgeMs. */
export function prefetchQuery(path, maxAgeMs = 30_000) {
  if (!currentUser || cacheAge(currentUser, kind(path)) < maxAgeMs) return;
  fetchQuery(path).catch(() => {});
}

/**
 * Call `cb` with the cached copy right away (if any), then again with fresh data.
 * Resolves with the fresh data, or null if the request failed (the cached copy stays on screen).
 */
export function swr(path, cb, { force = false } = {}) {
  const cached = peekQuery(path);
  if (cached != null) cb(cached);
  return fetchQuery(path, { force }).then((d) => { cb(d); return d; }).catch(() => null);
}

export function subscribeQuery(path) {
  subscribers.set(path, (subscribers.get(path) || 0) + 1);
  return () => subscribers.set(path, Math.max(0, (subscribers.get(path) || 1) - 1));
}

// After you change something, pages you are not on would otherwise hold stale numbers until visited.
// Refresh their cached queries in the background (once per burst of changes) so they are current when you arrive.
let refreshTimer = null;
if (typeof window !== "undefined") {
  window.addEventListener("lm:refresh", () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (!currentUser) return;
      known.forEach((path) => { if (!(subscribers.get(path) > 0)) fetchQuery(path, { force: true }).catch(() => {}); });
    }, 1200);
  });
}
