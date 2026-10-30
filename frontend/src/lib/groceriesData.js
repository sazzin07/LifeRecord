import { api } from "@/lib/api";
import { inScope } from "@/lib/refreshScope";
import { cacheAge, readCache, writeCache } from "@/lib/swrCache";

export const GROCERIES_CACHE_KEY = "groceries";

/** Everything the Groceries page shows, fetched in parallel and shaped for the page's state. */
export async function fetchGroceries(listId) {
  const [inv, shop, low, sugg, rec, locs, prods, ideas, apps] = await Promise.all([
    api.get("/groceries"),
    api.get("/shopping", { params: listId ? { list_id: listId } : {} }),
    api.get("/groceries/low-stock"),
    api.get("/groceries/suggestions"),
    api.get("/shopping/recurring"),
    api.get("/storage-locations"),
    api.get("/products"),
    api.get("/recipes/suggestions"),
    api.get("/appliances"),
  ]);
  return {
    inventory: inv.data, shopping: shop.data, lowStock: low.data, suggestions: sugg.data, recurring: rec.data,
    locations: locs.data, products: prods.data, recipeIdeas: ideas.data, appliances: apps.data,
  };
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
