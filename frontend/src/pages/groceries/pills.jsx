import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/* A pill of options with one highlight that glides to the selected option. The highlight is measured (not React state) so a re-render
   never makes it jump; it only animates once the pill has been on screen for a moment. */
function place(el) {
  const on = el && el.querySelector('[aria-selected="true"], [aria-pressed="true"]');
  if (!on) return;
  el.style.setProperty("--x", `${on.offsetLeft}px`);
  el.style.setProperty("--w", `${on.offsetWidth}px`);
  // A pill wider than its box scrolls: keep the chosen option in view.
  const left = on.offsetLeft, right = left + on.offsetWidth;
  if (left < el.scrollLeft) el.scrollLeft = Math.max(0, left - 8);
  else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth + 8;
  if (!el.dataset.ready) requestAnimationFrame(() => requestAnimationFrame(() => { el.dataset.ready = "1"; }));
}

export function Pill({ className, children, ...rest }) {
  const ref = useRef(null);
  useLayoutEffect(() => { place(ref.current); });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => place(el));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} className={cn("gt-pill", className)} {...rest}>{children}</div>;
}
