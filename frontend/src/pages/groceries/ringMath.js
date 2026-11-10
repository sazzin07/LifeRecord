/* The freshness ring's numbers, with no drawing in them, so they can be tested.
   The ring is one circle of path length 100: each share is simply its percentage of it. A zero share is not drawn at all. */
export const RING_LENGTH = 100;
const CAP = 1.68;   // path length one round end adds to a share (half the stroke width, as a part of the whole ring): ends are rounded
const GAP = 0.8;    // the clear space between two rounded ends
const INSET = CAP + GAP / 2;

/** parts: [{key, n, color}] in drawing order; total: the count the shares are shares of.
 *  Returns one entry per part: {key, color, n, start, len, draw, drawStart}. `start`/`len` are the exact share of the ring (they add up to 100);
 *  `drawStart`/`draw` are what is painted: with two or more shares each is pulled in so its rounded ends sit a small gap apart, and a lone share
 *  is the whole ring, closed. */
export function ringArcs(parts, total) {
  const sum = Math.max(0, Number(total) || 0);
  let at = 0;
  const arcs = parts.map((p) => {
    const n = Math.max(0, Number(p.n) || 0), share = sum > 0 ? (n / sum) * RING_LENGTH : 0;
    const arc = { key: p.key, color: p.color, n, start: at, len: share, drawStart: at, draw: share };
    at += share;
    return arc;
  });
  const live = arcs.filter((a) => a.len > 0);
  if (live.length > 1) live.forEach((a) => { a.draw = Math.max(0.01, a.len - 2 * INSET); a.drawStart = a.start + Math.min(INSET, a.len / 2); });
  return arcs.map((a) => ({ ...a, start: round(a.start), len: round(a.len), draw: round(a.draw), drawStart: round(a.drawStart) }));
}

/** The number in the middle: the whole-number share that is fresh, or null when there is nothing to measure (shown as an em dash). */
export function freshPercent(fresh, total) {
  const t = Number(total) || 0;
  if (t <= 0) return null;
  const f = Math.max(0, Number(fresh) || 0), pct = Math.round((f / t) * 100);
  return pct >= 100 && f < t ? 99 : pct;   // 100 means everything is fresh, never 1999 of 2000
}

function round(n) { return Math.round(n * 1000) / 1000; }
