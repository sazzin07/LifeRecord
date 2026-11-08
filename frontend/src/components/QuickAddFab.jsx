import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";

/** Hides while the page is being scrolled down on a phone or tablet (where it would sit over the content being read) and comes back on the
 *  first scroll up, at the end of the page, or when it takes keyboard focus. A wide screen never hides it. */
function useHideOnScrollDown() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const narrow = window.matchMedia("(max-width: 1023px)");
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const nearEnd = y + window.innerHeight >= document.documentElement.scrollHeight - 80;
      if (!narrow.matches || nearEnd || y < 120) setHidden(false);
      else if (y - last > 8) setHidden(true);
      else if (last - y > 8) setHidden(false);
      if (Math.abs(y - last) > 8) last = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return [hidden, setHidden];
}

/** Quick add, floating in the bottom-right corner. It opens the same dialog the top bar's "Add" used to. On a phone it sits above the
 *  bottom bar and the device's safe area; on a wide screen it is a round button that unfolds into a labelled pill while it is hovered
 *  or focused. The page keeps clear space under its last row (AppShell), so the button never covers the end of a page. */
export function QuickAddFab({ onClick }) {
  const reduce = useReducedMotion();
  const [hidden, setHidden] = useHideOnScrollDown();
  return (
    // The corner holds the "+" and, to its left, whatever the current page wants to keep within reach (Groceries puts its cart there through the
    // #shell-fab-slot element). The corner is one flex row, so the "+" unfolding into a pill pushes the neighbour aside instead of covering it.
    <div className="pointer-events-none fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-30 flex items-center gap-3 lg:bottom-6 lg:right-6">
      <div id="shell-fab-slot" className="pointer-events-auto flex items-center gap-3 empty:hidden" />
      <motion.button type="button" data-testid="quick-add-trigger" aria-label="Quick add" aria-haspopup="dialog" onClick={onClick}
        data-hidden={hidden || undefined} onFocus={() => setHidden(false)}
        initial={reduce ? false : { opacity: 0, scale: 0.7, y: 16 }} animate={{ opacity: hidden ? 0 : 1, scale: 1, y: hidden ? 24 : 0 }}
        transition={reduce ? { duration: 0 } : hidden ? { duration: 0.18, ease: [0.16, 1, 0.3, 1] } : { type: "spring", damping: 22, stiffness: 320, delay: 0.35 }}
        whileHover={reduce ? undefined : { y: -2 }} whileTap={reduce ? undefined : { scale: 0.92, y: 0 }}
        style={hidden ? { pointerEvents: "none" } : undefined}
        className="group pointer-events-auto flex h-14 items-center justify-center overflow-hidden rounded-full cta-fill px-[1.0625rem] outline-none transition-[background-color,box-shadow] duration-200 hover:brightness-105 focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 motion-reduce:transition-none shadow-[var(--fab-shadow)] hover:shadow-[var(--fab-shadow-hover)]">
        <Plus className="h-6 w-6 shrink-0 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:rotate-90 group-focus-visible:rotate-90 motion-reduce:transition-none motion-reduce:group-hover:rotate-0" aria-hidden="true" />
        <span className="hidden max-w-0 overflow-hidden whitespace-nowrap text-sm font-semibold opacity-0 transition-[max-width,margin,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:ml-2 group-hover:max-w-[5rem] group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-[5rem] group-focus-visible:opacity-100 motion-reduce:transition-none lg:inline" aria-hidden="true">Add</span>
      </motion.button>
    </div>
  );
}
