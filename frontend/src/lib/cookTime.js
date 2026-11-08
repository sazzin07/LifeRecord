/** A recipe's cooking time in words: "12 min", "1 h", "1 h 30 min". Null when the recipe has no cooking time (it is optional). */
export function cookTimeLabel(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return null;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
