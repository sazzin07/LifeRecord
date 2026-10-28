import { prefetchGroceries } from "@/lib/groceriesData";
import { prefetchQuery } from "@/lib/query";
import { moneyPaths } from "@/lib/periods";

/**
 * Lazy page chunks. App.js lazy()-loads these same functions, so calling one early (on hover, or when idle)
 * downloads the chunk once and the real navigation finds it already there.
 */
export const pageLoaders = {
  "/": () => import("@/pages/Home"),
  "/money": () => import("@/pages/Money"),
  "/people": () => import("@/pages/People"),
  "/groceries": () => import("@/pages/Groceries"),
  "/nutrition": () => import("@/pages/Nutrition"),
  "/fitness": () => import("@/pages/Fitness"),
  "/body": () => import("@/pages/Body"),
  "/tasks": () => import("@/pages/Tasks"),
  "/calendar": () => import("@/pages/Calendar"),
  "/settings": () => import("@/pages/Settings"),
  "/people/:id": () => import("@/pages/PersonDetail"),
};

const today = () => new Date().toISOString().slice(0, 10);

/** The requests each page makes on arrival (must match the page's own paths so the cache lines up). */
const routeQueries = {
  "/": () => ["/analytics/summary", "/tasks", "/people", "/weight", `/meals?date=${today()}`, "/groceries", `/transactions?start=${today()}&end=${today()}`],
  "/money": () => { const m = moneyPaths("week"); return [m.summary, m.transactions, m.categories]; },
  "/people": () => ["/people"],
  "/nutrition": () => [`/meals?date=${today()}`, "/recipes"],
  "/fitness": () => ["/workouts", "/workouts/prs"],
  "/body": () => ["/weight", "/photos"],
  "/tasks": () => ["/tasks"],
  "/calendar": () => ["/tasks"],
  "/settings": () => ["/categories", "/accounts"],
};

/** Download a route's code and warm its data. Cheap to call repeatedly. */
export function prefetchRoute(to, userId, { maxAgeMs = 15_000, data = true } = {}) {
  pageLoaders[to]?.().catch(() => {});
  if (!data || !userId) return;
  if (to === "/groceries") prefetchGroceries(userId, { maxAgeMs });
  else (routeQueries[to]?.() || []).forEach((path) => prefetchQuery(path, maxAgeMs));
}

const ORDER = ["/", "/money", "/groceries", "/tasks", "/people", "/nutrition", "/fitness", "/body", "/calendar", "/settings"];

/** After sign-in, once the browser is idle: fetch every page's code, then its data one page at a time. */
export function warmAllRoutes(userId) {
  let cancelled = false;
  ORDER.forEach((to) => pageLoaders[to]?.().catch(() => {}));
  const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 300));
  (function next(i) {
    if (cancelled || i >= ORDER.length) return;
    idle(() => {
      if (cancelled) return;
      prefetchRoute(ORDER[i], userId, { maxAgeMs: 2 * 60_000 });
      setTimeout(() => next(i + 1), 400);
    });
  })(0);
  return () => { cancelled = true; };
}
