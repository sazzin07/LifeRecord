import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/* A pill of options with one highlight that glides to the selected option. The highlight is measured (not React state) so a re-render
   never makes it jump; it only animates once the pill has been on screen for a moment. */
/** A row of chips that scrolls sideways fades at the edge where there is more, so nobody thinks the row ends there. */
function fades(el) {
  el.toggleAttribute("data-fade-l", el.scrollLeft > 4);
  el.toggleAttribute("data-fade-r", el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
}

export function useScrollFade(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const on = () => fades(el);
    on();
    el.addEventListener("scroll", on, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(on) : null;
    ro?.observe(el);
    return () => { el.removeEventListener("scroll", on); ro?.disconnect(); };
  });
}

function place(el) {
  if (!el) return;
  fades(el);
  const on = el.querySelector('[aria-selected="true"], [aria-pressed="true"]');
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
    const scrolled = () => fades(el);
    el.addEventListener("scroll", scrolled, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener("scroll", scrolled); };
  }, []);
  return <div ref={ref} className={cn("gt-pill", className)} {...rest}>{children}</div>;
}
