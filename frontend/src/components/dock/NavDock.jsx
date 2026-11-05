import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { DOCK, inPage } from "./dockData";
import { DockTile } from "./DockTile";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { prefetchRoute } from "@/lib/routes";
import { useScrollHide } from "@/lib/useScrollHide";
import { cn } from "@/lib/utils";

// The floating dock (docs/superpowers/specs/2026-11-05-floating-dock-design.md): six independent glass tiles near the bottom of the screen. It rests
// small and grows when the pointer reaches it (a screen that cannot hover always shows it full size). Each tile reacts only to the pointer that is on
// the tile itself, never to its neighbour. A tile is a page, or a group that unfolds its pages above it. The motion is spring-driven, in the manner of
// iOS: quick to start, a soft settle. The dock steps aside while the page scrolls down and comes back when the scrolling stops.
const SPRING = { type: "spring", stiffness: 420, damping: 30, mass: 0.8 };
const SOFT = { type: "spring", stiffness: 300, damping: 28, mass: 0.9 };
const GROW = { type: "spring", stiffness: 190, damping: 24, mass: 1 };      // the whole dock swelling or settling: unhurried, no overshoot
const REST = 0.7;                                   // the size of the resting dock, relative to the grown one
const SIZE = "h-11 w-11 sm:h-14 sm:w-14";

const useCanHover = () => {
  const [can, setCan] = useState(() => (typeof window.matchMedia !== "function" ? true : window.matchMedia("(hover: hover)").matches));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(hover: hover)");
    const on = () => setCan(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return can;
};

export function NavDock() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { animations } = useSettings();
  const reduce = useReducedMotion() || animations === false;
  const canHover = useCanHover();
  const [hidden, reveal] = useScrollHide();
  // Where the mouse is, as one value that is always read from the latest pointer event (never from a pair of enter/leave events or a timer that a
  // quick movement could leave half done): `near` = on the dock zone, `index` = the slot under it. Every other state below is derived from it.
  const [pt, setPt] = useState({ near: false, index: null });
  const [dwell, setDwell] = useState(null);           // the slot the pointer has rested on long enough to open its group
  const [folded, setFolded] = useState(null);     // the slot whose group was just used: it stays folded until the pointer moves to another tile (the dock itself stays grown)
  const [pinned, setPinned] = useState(null);         // { id, focus }: a group opened by a click, a tap or the keyboard
  const [focusIn, setFocusIn] = useState(false);
  const navRef = useRef(null);
  const warm = (to) => { if (user?.id) prefetchRoute(to, user.id, { maxAgeMs: 15_000 }); };
  const show = !hidden || focusIn;
  const near = pt.near;
  const grown = !canHover || near || focusIn || !!pinned;
  const hoverEntry = near && dwell != null && dwell === pt.index && folded !== pt.index ? DOCK[pt.index] : null;
  const openId = pinned?.id ?? (hoverEntry?.items ? hoverEntry.id : null);
  const point = useCallback((nearNow, index) => setPt((p) => (p.near === nearNow && p.index === index ? p : { near: nearNow, index })), []);
  const reset = useCallback(() => { setPt({ near: false, index: null }); setFolded(null); }, []);

  useEffect(() => { if (!show) { setPinned(null); reset(); } }, [show, reset]);
  useEffect(() => { setPinned(null); }, [pathname]);
  // A group unfolds when the dock is grown and the pointer has rested on its tile for a moment.
  useEffect(() => {
    if (!near || pt.index == null) { setDwell(null); return undefined; }
    const t = setTimeout(() => setDwell(pt.index), 120);
    return () => clearTimeout(t);
  }, [near, pt.index]);
  // A group opened by a click gives way when the pointer moves to another tile.
  useEffect(() => { if (pinned && near && pt.index != null && DOCK[pt.index].id !== pinned.id) setPinned(null); }, [near, pt.index, pinned]);
  // The guard: while anything is open or grown, a pointer that is anywhere outside the dock (or a window that lost focus) puts everything back.
  useEffect(() => {
    if (!pt.near && !pinned) return undefined;
    const move = (e) => { if (e.pointerType === "mouse" && !navRef.current?.contains(e.target)) { setPt({ near: false, index: null }); setFolded(null); } };
    const down = (e) => { if (!navRef.current?.contains(e.target)) setPinned(null); };
    const gone = () => { setPt({ near: false, index: null }); setFolded(null); };
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("blur", gone);
    document.addEventListener("mouseleave", gone);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerdown", down); window.removeEventListener("blur", gone); document.removeEventListener("mouseleave", gone); };
  }, [pt.near, pinned]);
  // Moving the mouse to the bottom edge brings a hidden dock back.
  useEffect(() => {
    if (!hidden) return undefined;
    const move = (e) => { if (e.pointerType === "mouse" && e.clientY > window.innerHeight - 90) reveal(); };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [hidden, reveal]);

  const choose = useCallback(() => { setPinned(null); setFolded(pt.index); }, [pt.index]);
  useEffect(() => { setFolded((f) => (f != null && f !== pt.index ? null : f)); }, [pt.index]);

  // Arrow keys move along the dock; Escape folds a group back and returns to its tile.
  const onKeyDown = (e) => {
    if (e.key === "Escape" && openId) {
      const tile = navRef.current?.querySelector(`[data-dock-tile="${openId}"]`);
      setPinned(null);
      setFolded(pt.index);
      tile?.focus();
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const inFan = e.target.closest("[data-dock-fan]");
    const row = inFan ? [...inFan.querySelectorAll("a")] : [...navRef.current.querySelectorAll("[data-dock-tile]")];
    const i = row.indexOf(e.target.closest("a,button"));
    if (i < 0) return;
    e.preventDefault();
    row[(i + (e.key === "ArrowRight" ? 1 : row.length - 1)) % row.length]?.focus();
  };

  return (
    <motion.nav ref={navRef} aria-label="Main" data-testid="dock" data-hidden={!show} data-grown={grown} onKeyDown={onKeyDown}
      onFocus={(e) => { if (e.target.matches(":focus-visible")) setFocusIn(true); }} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { setFocusIn(false); setPinned(null); } }}
      className="pointer-events-none fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 flex justify-center"
      animate={{ y: show ? 0 : 120, opacity: show ? 1 : 0 }} transition={reduce ? { duration: 0 } : { ...SOFT, opacity: { duration: 0.22 } }}>
      {/* The hover zone is the dock at full size (a little more above), whatever its current size, so the dock has grown before the pointer reaches a tile;
          the row inside is scaled as a whole about its centre, which keeps every distance between tiles in proportion and the dock centred. */}
      <div className={cn("px-4 pt-3", show ? "pointer-events-auto" : "pointer-events-none")}
        onPointerMove={(e) => { if (e.pointerType !== "mouse") return; const slot = e.target.closest?.("[data-dock-slot]"); point(true, slot ? Number(slot.dataset.dockSlot) : null); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") reset(); }}>
      <motion.div className="flex items-end gap-1.5 px-2 py-2 sm:gap-3 sm:px-3" style={{ transformOrigin: "50% 100%" }} initial={false}
        animate={{ scale: grown ? 1 : REST }} transition={reduce ? { duration: 0 } : GROW}>
        {DOCK.map((entry, i) => {
          const group = !!entry.items;
          const active = group ? entry.items.some((p) => inPage(pathname, p.to)) : inPage(pathname, entry.to);
          const isOpen = openId === entry.id;
          const enter = reduce ? {} : { initial: { opacity: 0, y: 30, scale: 0.6 }, animate: { opacity: 1, y: 0, scale: 1 }, transition: { ...SOFT, delay: 0.2 + i * 0.045 } };
          const lean = reduce || !canHover || !near || pt.index == null ? 0 : pt.index === i ? 2 : Math.abs(pt.index - i) === 1 ? 1 : 0;
          const face = (
            <motion.span className="block" whileTap={reduce ? undefined : { scale: 0.9 }} transition={SPRING} style={{ transformOrigin: "50% 100%" }}
              animate={lean === 2 ? { y: -5, scale: 1.14 } : lean === 1 ? { y: -2, scale: 1.06 } : { y: 0, scale: 1 }}>
              <DockTile tile={entry.tile} active={active} className={SIZE} />
            </motion.span>
          );
          const tileProps = { "data-dock-tile": entry.id };
          const ring = "relative block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
          return (
            /* The hover zone of a tile is exactly the tile (and, for a group, its open fan): a neighbour tile is never touched. */
            <motion.div key={entry.id} {...enter} data-dock-slot={i} className="relative">
              {group ? (
                <button type="button" data-testid={`dock-${entry.id}`} aria-label={entry.label} aria-expanded={isOpen} aria-controls={`dock-fan-${entry.id}`}
                  aria-current={active ? "page" : undefined} {...tileProps}
                  onClick={(e) => {
                    const mouse = e.nativeEvent.pointerType === "mouse";
                    if (isOpen && !mouse) setPinned(null);                                      // a tap or Enter on an open group folds it
                    else setPinned({ id: entry.id, focus: !mouse && e.detail === 0 });         // otherwise it stays open until the pointer or focus moves on
                  }} className={ring}>
                  {face}
                </button>
              ) : (
                <NavLink to={entry.to} end={entry.to === "/"} data-testid={`nav-${entry.label.toLowerCase()}`} aria-label={entry.label}
                  onMouseEnter={() => warm(entry.to)} onTouchStart={() => warm(entry.to)} {...tileProps} onClick={choose} className={ring}>
                  {face}
                </NavLink>
              )}
              <AnimatePresence>
                {group && isOpen && <Fan key="fan" entry={entry} pathname={pathname} reduce={reduce} focusFirst={!!pinned?.focus} warm={warm} onPick={choose} />}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </motion.div>
      </div>
    </motion.nav>
  );
}

/** The pages of a group spring out of its tile one after another and fold back in reverse. */
function Fan({ entry, pathname, reduce, focusFirst, warm, onPick }) {
  const ref = useRef(null);
  useEffect(() => { if (focusFirst) ref.current?.querySelector("a")?.focus(); }, [focusFirst]);
  const n = entry.items.length;
  return (
    <div ref={ref} id={`dock-fan-${entry.id}`} role="group" aria-label={`${entry.label} pages`} data-dock-fan
      className="absolute bottom-full left-1/2 z-10 flex -translate-x-1/2 items-end gap-3 pb-5">
      {entry.items.map((p, i) => {
        const active = inPage(pathname, p.to);
        return (
          <motion.div key={p.to} className="relative flex flex-col items-center"
            initial={reduce ? false : { opacity: 0, y: 34, scale: 0.35 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: reduce ? { duration: 0 } : { ...SPRING, delay: i * 0.04 } }}
            exit={{ opacity: 0, y: 22, scale: 0.5, transition: reduce ? { duration: 0 } : { duration: 0.16, ease: [0.4, 0, 1, 1], delay: (n - 1 - i) * 0.025 } }}>
            <NavLink to={p.to} data-testid={`nav-${p.label.toLowerCase()}`} aria-label={p.label} onClick={onPick}
              onMouseEnter={() => warm(p.to)} onTouchStart={() => warm(p.to)} onFocus={() => warm(p.to)}
              className="relative block rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
              <motion.span className="block" whileHover={reduce ? undefined : { y: -4, scale: 1.12 }} whileTap={reduce ? undefined : { scale: 0.9 }} transition={SPRING}>
                <DockTile tile={p.tile} active={active} className={SIZE} />
              </motion.span>
            </NavLink>
          </motion.div>
        );
      })}
    </div>
  );
}
