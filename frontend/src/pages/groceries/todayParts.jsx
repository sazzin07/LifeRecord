import { useEffect, useId, useRef, useState } from "react";
import { Glyph } from "./glyphs";
import { daysUntil, needsYou as stockNeedsYou } from "./shared";

/* Small pieces and figures the Today page shares between its hero and its widgets. */
export const qtyOf = (g) => Number(g.quantity) || 0;
export const daysOf = (g) => daysUntil(g.expiration);
export const needsYou = stockNeedsYou;   // one definition, shared with Storage (see shared.jsx)
export const worth = (g) => (Number(g.price) || 0) * qtyOf(g);
export const stepOf = (unit) => (unit === "g" || unit === "ml" ? 100 : unit === "kg" || unit === "L" || unit === "l" ? 0.5 : 1);
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const cap1 = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function dayWords(d) {
  if (d === null) return "";
  if (d < 0) return `expired ${-d} day${d === -1 ? "" : "s"} ago`;
  if (d === 0) return "expires today";
  return `${d} day${d === 1 ? "" : "s"} left`;
}

/** How fresh a set of items is: gone off, going off within three days, or fine, plus what the risky part is worth. */
export function freshStats(items) {
  const live = items.filter((g) => qtyOf(g) > 0);
  const gone = live.filter((g) => daysOf(g) !== null && daysOf(g) < 0);
  const soon = live.filter((g) => daysOf(g) !== null && daysOf(g) >= 0 && daysOf(g) <= 3);
  return { live, gone, soon, fresh: live.length - gone.length - soon.length, risk: [...gone, ...soon].reduce((s, g) => s + worth(g), 0), value: live.reduce((s, g) => s + worth(g), 0) };
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** A figure that counts up to its value (and between values) instead of snapping. */
export function CountUp({ value, format = (n) => String(Math.round(n)) }) {
  const [shown, setShown] = useState(reduced() ? value : 0);
  const from = useRef(reduced() ? value : 0);
  useEffect(() => {
    if (reduced() || from.current === value) { from.current = value; setShown(value); return undefined; }
    const start = from.current, t0 = performance.now();
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / 950);
      setShown(start + (value - start) * (1 - (1 - k) ** 4));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value]);
  return <>{format(shown)}</>;
}

/** The food as a small round drawn sticker. Purely decorative: the name is always written next to it. */
export function Sticker({ name, category, size = 36, className = "gt-sticker" }) {
  return <img className={className} alt="" width={size} height={size} src={Glyph.url(name, category)} />;
}

/** The shares of one ring on a 100-unit path, so each is a plain percentage. The ring is drawn once, whole, and a single clockwise sweep
 *  uncovers it (a mask), so it always finishes as a closed circle however many shares it has; later changes slide the arcs into place. */
export function RingArcs({ parts, total }) {
  const id = useId().replace(/:/g, "");
  const used = parts.filter((p) => p.n > 0);
  const gap = used.length > 1 ? 1 : 0;
  let at = 0;
  return (
    <>
      <defs>
        <mask id={`gt-ring-${id}`} maskUnits="userSpaceOnUse" x="-8" y="-8" width="144" height="144">
          <circle className="gt-ring-sweep" cx="64" cy="64" r="52" pathLength="100" />
        </mask>
      </defs>
      <g mask={`url(#gt-ring-${id})`}>
        {used.map((p) => {
          const len = Math.max(0.5, (p.n / total) * 100 - gap), start = at + gap / 2;
          at += (p.n / total) * 100;
          return <circle key={p.key} className="gt-ring-arc" cx="64" cy="64" r="52" pathLength="100" style={{ "--len": len.toFixed(2), "--at": (-start).toFixed(2), stroke: p.color }} />;
        })}
      </g>
    </>
  );
}

/** How much of a recipe's ingredients are in stock. */
export function CoverRing({ pct, ready }) {
  return (
    <span className={`gt-cov ${ready ? "ready" : ""}`} role="img" aria-label={`${pct} percent of the ingredients in stock`}>
      <svg viewBox="0 0 44 44" aria-hidden="true"><circle className="t" cx="22" cy="22" r="18" pathLength="100" /><circle className="a" cx="22" cy="22" r="18" pathLength="100" style={{ "--len": Math.max(pct, 2) }} /></svg>
      <b>{pct}</b>
    </span>
  );
}
