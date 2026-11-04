import { api } from "@/lib/api";
import { inScope } from "@/lib/refreshScope";
import { cacheAge, readCache, writeCache } from "@/lib/swrCache";

export const GROCERIES_CACHE_KEY = "groceries";

/** Each piece of the Groceries page, by the name the page's state uses: its request and how it is shaped. A section asks for the pieces it
 *  needs, so one slow request never holds back the others. */
export const GROCERY_PARTS = {
  inventory: () => api.get("/groceries").then((r) => r.data),
  shopping: (listId) => api.get("/shopping", { params: listId ? { list_id: listId } : {} }).then((r) => r.data),
  lowStock: () => api.get("/groceries/low-stock").then((r) => r.data),
  suggestions: () => api.get("/groceries/suggestions").then((r) => r.data),
  recurring: () => api.get("/shopping/recurring").then((r) => r.data),
  locations: () => api.get("/storage-locations").then((r) => r.data),
  products: () => api.get("/products").then((r) => r.data),
  recipeIdeas: () => api.get("/recipes/suggestions").then((r) => r.data),
  appliances: () => api.get("/appliances").then((r) => r.data),
};

/** Everything the Groceries page shows, fetched in parallel and shaped for the page's state. */
export async function fetchGroceries(listId) {
  const keys = Object.keys(GROCERY_PARTS);
  const values = await Promise.all(keys.map((k) => GROCERY_PARTS[k](listId)));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
}

const inFlight = new Map();

/**
 * Warm the cache before the page is opened (on nav hover/focus, or when idle after sign-in) so the first
 * visit is instant too. Skips when the cache is fresh or a prefetch is already running.
 */
export function prefetchGroceries(userId, { maxAgeMs = 60_000 } = {}) {
  if (userId) lastUser = userId;
  if (!userId || cacheAge(userId, GROCERIES_CACHE_KEY) < maxAgeMs || inFlight.has(userId)) return;
  const previous = readCache(userId, GROCERIES_CACHE_KEY);
  const p = fetchGroceries(previous?.selectedListId)
    .then((data) => writeCache(userId, GROCERIES_CACHE_KEY, { ...data, selectedListId: previous?.selectedListId || "" }))
    .catch(() => {})
    .finally(() => inFlight.delete(userId));
  inFlight.set(userId, p);
}

// Mounted Groceries page refreshes itself on changes; when it is not mounted, keep its cache current in the background.
let mounted = 0;
export function watchGroceries() { mounted += 1; return () => { mounted = Math.max(0, mounted - 1); }; }
let timer = null;
if (typeof window !== "undefined") {
  window.addEventListener("lm:refresh", (e) => {
    const scope = e.detail?.scope; // a change that cannot touch groceries or shopping lists leaves them alone
    if (!inScope("/groceries", scope) && !inScope("/shopping", scope)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (mounted > 0 || !lastUser) return;
      prefetchGroceries(lastUser, { maxAgeMs: 0 });
    }, 1200);
  });
}
let lastUser = null;
