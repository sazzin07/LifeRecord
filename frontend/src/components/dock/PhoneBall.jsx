import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus } from "lucide-react";
import { DockTile } from "./DockTile";
import { useSettings } from "@/context/SettingsContext";
import { useScrollHide } from "@/lib/useScrollHide";
import { cn } from "@/lib/utils";

// The phone's one button, in the middle at the bottom. Tap it and the options fan out above it; or press it and drag a finger to an option: the option
// under the finger grows and changes colour, and lifting the finger chooses it (lifting anywhere else closes the menu). The options are the assistant and the
// quick actions; the pages are in the side menu (the panel button in the top bar).
const SPRING = { type: "spring", stiffness: 420, damping: 30, mass: 0.8 };
export const BALL_OPTIONS = [
  { key: "assistant", label: "Assistant", tile: "assistant" },      // the same drawn tiles as the dock and the side menu
  { key: "expense", label: "Expense", tile: "money" },
  { key: "meal", label: "Meal", tile: "nutrition" },
  { key: "task", label: "Task", tile: "tasks" },
  { key: "weight", label: "Weight", tile: "body" },
  { key: "more", label: "More", tile: "more" },
];
const RADIUS = 104;
const HIT = 38;                                  // how close the finger must be to an option's centre to choose it
const HOLD_MS = 220;                             // a press longer than this, or one that moves, is a drag rather than a tap

/** Where each option sits, relative to the ball's centre: along the upper half of a circle, left to right. */
function placeOptions(n) {
  return Array.from({ length: n }, (_, i) => {
    const theta = Math.PI * (0.92 - (0.84 * i) / (n - 1));
    return { x: Math.round(RADIUS * Math.cos(theta)), y: -Math.round(RADIUS * Math.sin(theta)) };
  });
}

export function PhoneBall({ onChoose }) {
  const { animations } = useSettings();
  const reduce = useReducedMotion() || animations === false;
  const [hidden] = useScrollHide();
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(null);
  const press = useRef(null);                    // { x, y, t, wasOpen, moved } while a finger is down on the ball
  const ballRef = useRef(null);
  const spots = useMemo(() => placeOptions(BALL_OPTIONS.length), []);
  const show = !hidden || open;

  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => { if (e.key === "Escape") { setOpen(false); setHover(null); ballRef.current?.focus(); } };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  useEffect(() => {
    const gone = () => { if (press.current) { press.current = null; setHover(null); } };
    window.addEventListener("blur", gone);
    window.addEventListener("pointerup", gone);
    return () => { window.removeEventListener("blur", gone); window.removeEventListener("pointerup", gone); };
  }, []);
  const close = () => { setOpen(false); setHover(null); };
  const choose = (key) => { close(); onChoose(key); };
  const buzz = () => { try { navigator.vibrate?.(8); } catch { /* not every device can */ } };

  const nearest = (clientX, clientY) => {
    const r = ballRef.current.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let best = null, bestD = HIT;
    spots.forEach((s, i) => { const d = Math.hypot(clientX - (cx + s.x), clientY - (cy + s.y)); if (d < bestD) { bestD = d; best = i; } });
    return best;
  };

  const onDown = (e) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    press.current = { x: e.clientX, y: e.clientY, t: performance.now(), wasOpen: open, moved: false };
    setOpen(true);
  };
  const onMove = (e) => {
    const p = press.current;
    if (!p) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) p.moved = true;
    const idx = nearest(e.clientX, e.clientY);
    setHover((h) => { if (h !== idx && idx != null) buzz(); return idx; });
  };
  const onUp = (e) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    const dragged = p.moved || performance.now() - p.t >= HOLD_MS;
    const idx = nearest(e.clientX, e.clientY);
    if (dragged) { if (idx != null) choose(BALL_OPTIONS[idx].key); else close(); }
    else if (p.wasOpen) close();                  // a tap on the open ball folds it
    else setHover(null);                          // a tap on the closed ball leaves the menu open to choose from
  };

  return (
    <>
      <AnimatePresence>
        {open && <motion.div key="scrim" aria-hidden="true" data-testid="ball-scrim" onClick={close} className="fixed inset-0 z-30 bg-scrim backdrop-blur-sm"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.2 }} />}
      </AnimatePresence>
      <motion.div className="pointer-events-none fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-[31] flex justify-center"
        animate={{ y: show ? 0 : 110, opacity: show ? 1 : 0 }} transition={reduce ? { duration: 0 } : SPRING} data-hidden={!show} data-testid="ball-wrap">
        <div className="relative h-[60px] w-[60px]">
          <AnimatePresence>
            {open && (
              <div role="menu" aria-label="Assistant and quick actions" className="pointer-events-none absolute left-[30px] top-[30px] h-0 w-0">
                {BALL_OPTIONS.map((o, i) => {
                  const on = hover === i;
                  return (
                    <motion.button key={o.key} type="button" role="menuitem" data-testid={`ball-${o.key}`} aria-label={o.label} onClick={() => choose(o.key)}
                      onPointerEnter={(e) => { if (e.pointerType === "mouse" && !press.current) setHover(i); }} onPointerLeave={() => { if (!press.current) setHover(null); }}
                      className="pointer-events-auto absolute -ml-6 -mt-6 block h-12 w-12 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      initial={reduce ? false : { x: 0, y: 0, scale: 0.3, opacity: 0 }}
                      animate={{ x: spots[i].x, y: spots[i].y, scale: on ? 1.32 : 1, opacity: 1, transition: reduce ? { duration: 0 } : { ...SPRING, delay: on ? 0 : i * 0.03 } }}
                      exit={{ x: 0, y: 0, scale: 0.3, opacity: 0, transition: reduce ? { duration: 0 } : { duration: 0.16, delay: (BALL_OPTIONS.length - 1 - i) * 0.02 } }}>
                      <DockTile tile={o.tile} active={on} className="h-12 w-12" />
                    </motion.button>
                  );
                })}
              </div>
            )}
          </AnimatePresence>
          <motion.button ref={ballRef} type="button" data-testid="ball" aria-label="Assistant and quick actions" aria-haspopup="menu" aria-expanded={open}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { press.current = null; close(); }} onLostPointerCapture={() => { if (press.current) { press.current = null; setHover(null); } }}
            onClick={(e) => { if (e.detail === 0) (open ? close() : setOpen(true)); }}
            onContextMenu={(e) => e.preventDefault()}
            whileTap={reduce ? undefined : { scale: 0.92 }} transition={SPRING}
            className="pointer-events-auto relative grid h-[60px] w-[60px] touch-none select-none place-items-center rounded-full cta-fill shadow-[var(--fab-shadow)] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            <Plus className={cn("h-7 w-7 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none", open && "rotate-45")} aria-hidden="true" />
          </motion.button>
        </div>
      </motion.div>
    </>
  );
}
