import { useCallback, useEffect, useState } from "react";

/** True while the page is being scrolled down: the dock steps out of the way and comes back when the scrolling stops (or at once on a scroll up,
 *  near the end of the page, or when `reveal()` is called). Nothing moves for a short or slow scroll near the top. */
export function useScrollHide({ threshold = 120, delta = 8, idleMs = 180 } = {}) {
  const [hidden, setHidden] = useState(false);
  const reveal = useCallback(() => setHidden(false), []);
  useEffect(() => {
    let last = window.scrollY;
    let timer;
    const onScroll = () => {
      const y = window.scrollY;
      const d = y - last;
      last = y;
      const nearEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 80;
      if (d > delta && y > threshold && !nearEnd) setHidden(true);
      else if (d < -delta || y <= threshold || nearEnd) setHidden(false);
      clearTimeout(timer);
      timer = setTimeout(() => setHidden(false), idleMs);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); clearTimeout(timer); };
  }, [threshold, delta, idleMs]);
  return [hidden, reveal];
}
