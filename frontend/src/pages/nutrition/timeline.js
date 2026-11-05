// The day as events in time: what was eaten, and when. Pure helpers (no React, no network), so they can be unit-tested.

/** When a meal is usually eaten, for an entry that has no time of its own. */
export const MEAL_HOUR = { breakfast: 8, lunch: 13, snack: 16, dinner: 19.5, other: 12 };

/** "07:40" -> 7.67. Anything else (missing, odd text) -> null. */
export function hourOf(text) {
  const m = /^(\d{1,2}):(\d{2})/.exec(text || "");
  if (!m) return null;
  const h = Number(m[1]) + Number(m[2]) / 60;
  return h >= 0 && h < 24 ? h : null;
}

/** Every diary entry of the day as { h, kcal, p, c, f, meal }, earliest first. An entry without a time of its own sits at its meal's usual hour. */
export function dayEvents(day) {
  const out = [];
  for (const m of day?.meals || []) {
    for (const e of m.entries || []) {
      const n = e.nutrients || {};
      out.push({ h: hourOf(e.eaten_at) ?? MEAL_HOUR[m.meal_type] ?? 12, kcal: n.energy_kcal || 0, p: n.protein_g || 0, c: n.carbs_available_g ?? n.carbs_g ?? 0, f: n.fat_g || 0, meal: m.meal_type });
    }
  }
  return out.sort((a, b) => a.h - b.h);
}

/** Running totals up to hour `h` (inclusive). */
export function totalsUntil(events, h) {
  return events.reduce((a, e) => (e.h <= h ? { kcal: a.kcal + e.kcal, p: a.p + e.p, c: a.c + e.c, f: a.f + e.f } : a), { kcal: 0, p: 0, c: 0, f: 0 });
}

/** The line of the cumulative energy: steps up over about 35 minutes at each entry. Returns [hour, kcal] knots from `from` to `to` (or to `now`). */
export function cumulativeKnots(events, from = 6, to = 22, now = null) {
  const knots = [[from, 0]];
  let c = 0;
  for (const e of events) {
    knots.push([Math.max(from, e.h - 0.2), c]);
    c += e.kcal;
    knots.push([Math.min(to, e.h + 0.45), c]);
  }
  knots.push([now != null ? Math.max(now, knots[knots.length - 1][0]) : to, c]);
  return knots;
}
