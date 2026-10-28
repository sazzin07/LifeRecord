/** Date-range query params for the Money page's period filter (shared so prefetching can build the same URLs). */
export function periodParams(period) {
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (period === "day") return { start: iso(now), end: iso(now) };
  if (period === "week") { const s = new Date(now); s.setDate(s.getDate() - 6); return { start: iso(s), end: iso(now) }; }
  if (period === "all") return {};
  return { month: period };
}

/** The Money page's request paths for a period + payment-method filter. */
export function moneyPaths(period, pm = "all") {
  const p = periodParams(period);
  const qs = new URLSearchParams(p).toString();
  const tqs = new URLSearchParams({ ...p, ...(pm !== "all" ? { payment_method: pm } : {}) }).toString();
  return {
    summary: `/analytics/summary${qs ? `?${qs}` : ""}`,
    transactions: `/transactions${tqs ? `?${tqs}` : ""}`,
    categories: "/categories",
  };
}
