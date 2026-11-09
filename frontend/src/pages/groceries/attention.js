/* What the page means by a food that needs a look, in one place. Plain functions with no app imports, so they are easy to test. */

export function isLow(g) {
  return Number(g.low_threshold) > 0 && Number(g.quantity) <= Number(g.low_threshold);
}

/** Something to look at today: running low, or going off within three days. */
export const needsAttention = (g) => isLow(g) || (daysUntil(g.expiration) ?? 99) <= 3;

/** The one meaning of "needs you" for the whole page: food in stock that goes off within three days (or already has). Today counts these. */
export const needsYou = (g) => Number(g.quantity) > 0 && (daysUntil(g.expiration) ?? 99) <= 3;

/** What a space or unit says about its contents, in the page's own words: "2 need you" are the ones Today counts, "1 running low" is the stock. */
export function attentionWords(items) {
  const you = items.filter(needsYou).length, low = items.filter(isLow).length;
  return [you && `${you} ${you === 1 ? "needs" : "need"} you`, low && `${low} running low`].filter(Boolean).join(" · ");
}

/** Whole days from today until the expiration date (negative = already expired); null when unset. */
export function daysUntil(expiration) {
  if (!expiration) return null;
  const d = new Date(`${expiration}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}
