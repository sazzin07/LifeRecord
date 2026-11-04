import { useEffect, useRef, useState } from "react";
import { animate, useMotionValue, useReducedMotion } from "framer-motion";
import { eur } from "@/lib/api";
import { mainCurrency } from "@/lib/money";

/** A euro amount that glides to its new value instead of jumping, so a balance that has just changed is seen to change. It starts at
 *  its value (no count-up on first paint), always ends exactly on the saved figure, and does not animate for reduced motion. */
const compactOf = (currency) => new Intl.NumberFormat("en-IE", { style: "currency", currency: currency || mainCurrency(), notation: "compact", maximumFractionDigits: 2 });
const show = (v, compact, currency) => (compact && Math.abs(v) >= 1_000_000 ? compactOf(currency).format(v) : eur(v, currency));

/** `compact`: from a million up the figure is abbreviated (€29.63M) so a total never breaks across lines; the exact amount is the tooltip. */
export function Amount({ value, className, testid, compact = false, currency }) {
  const reduce = useReducedMotion();
  const motion = useMotionValue(value);
  const [text, setText] = useState(show(value, compact, currency));
  const first = useRef(true);

  useEffect(() => {
    if (first.current || reduce) {
      first.current = false;
      motion.set(value);
      setText(show(value, compact, currency));
      return undefined;
    }
    const run = animate(motion, value, {
      duration: 0.5, ease: [0.2, 0, 0, 1],
      onUpdate: (v) => setText(show(v, compact, currency)),
      onComplete: () => setText(show(value, compact, currency)),
    });
    return () => run.stop();
  }, [value, reduce, motion, compact, currency]);

  return <span className={className} data-testid={testid} title={compact && Math.abs(value) >= 1_000_000 ? eur(value, currency) : undefined}>{text}</span>;
}
