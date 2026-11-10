import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/* The Today widgets as a board you rearrange by dragging. Only the grip starts a drag (so scrolling a phone still works anywhere else).
   While you drag, NOTHING else moves: the card follows the pointer exactly (it keeps the place you grabbed it by), and a marker on the card
   under the pointer shows whether it will land before or after it. Letting go puts it there; the others then slide into their new places and
   the card settles into its own. (An earlier version reordered live, and cards of different widths reflowed under the pointer.)
   The page scrolls by itself when you hold the card near the top or bottom edge. The grip is also a keyboard control: arrow keys move the card
   one place (there are no arrow buttons). Positions come from `offsetLeft/offsetTop`, which ignore transforms. */
const EDGE = 90, SCROLL_STEP = 14;
const move = (list, from, to) => { const next = [...list]; next.splice(to, 0, next.splice(from, 1)[0]); return next; };

export function WidgetBoard({ widgets, editing, onReorder, renderTile, announce }) {
  const [heldId, setHeldId] = useState(null);
  const [drop, setDrop] = useState(null);           // {id, after}: where the held card would land
  const [settled, setSettled] = useState(false);   // after the cards have risen once, moving one must not replay that
  const grid = useRef(null);
  const tiles = useRef({});                          // the outer tile: its offsets are its place in the grid
  const inners = useRef({});                         // what follows the pointer
  const held = useRef(null);                         // {id, dx, dy, x, y}
  const landing = useRef(null);                      // {id, left, top}: where the card was let go, so it can settle from there
  const raf = useRef(0);
  const ids = widgets.map((w) => w.id);
  const byId = Object.fromEntries(widgets.map((w) => [w.id, w]));

  const follow = useCallback(() => {
    const h = held.current, tile = h && tiles.current[h.id], el = h && inners.current[h.id];
    if (!el || !tile) return;
    const g = grid.current.getBoundingClientRect();
    const tx = h.x - h.dx - (g.left + tile.offsetLeft), ty = h.y - h.dy - (g.top + tile.offsetTop);
    el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(1.015)`;
  }, []);

  const where = useCallback((h) => {
    const g = grid.current.getBoundingClientRect(), px = h.x - g.left, py = h.y - g.top;
    for (const id of ids) {
      const el = tiles.current[id];
      if (id === h.id || !el) continue;
      if (px >= el.offsetLeft && px <= el.offsetLeft + el.offsetWidth && py >= el.offsetTop && py <= el.offsetTop + el.offsetHeight) {
        const wide = el.offsetWidth > g.width * 0.8;   // a full-width card sits alone on its row: above or below it, not beside it
        return { id, after: wide ? py > el.offsetTop + el.offsetHeight / 2 : px > el.offsetLeft + el.offsetWidth / 2 };
      }
    }
    return null;
  }, [ids]);

  const loop = useCallback(() => {
    const h = held.current;
    if (!h) return;
    if (h.y < EDGE) window.scrollBy(0, -SCROLL_STEP * Math.min(2, (EDGE - h.y) / 40));
    else if (h.y > window.innerHeight - EDGE) window.scrollBy(0, SCROLL_STEP * Math.min(2, (h.y - (window.innerHeight - EDGE)) / 40));
    follow();
    raf.current = requestAnimationFrame(loop);
  }, [follow]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  useEffect(() => { const t = setTimeout(() => setSettled(true), 1600); return () => clearTimeout(t); }, []);

  const start = (e, id) => {
    if (!editing || (e.button !== undefined && e.button !== 0)) return;
    const el = inners.current[id], r = el.getBoundingClientRect();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    held.current = { id, dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY };
    el.style.transition = "none";
    setHeldId(id);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(loop);
  };
  const drag = (e) => {
    const h = held.current;
    if (!h) return;
    h.x = e.clientX; h.y = e.clientY;
    const w = where(h);
    setDrop((d) => (w && d && d.id === w.id && d.after === w.after ? d : w || d));   // between cards the marker stays where it was
    follow();
  };
  const release = () => {
    const h = held.current;
    if (!h) return;
    held.current = null;
    cancelAnimationFrame(raf.current);
    const el = inners.current[h.id], r = el.getBoundingClientRect(), target = drop;
    setDrop(null);
    if (target) {
      const from = ids.indexOf(h.id);
      let to = ids.indexOf(target.id) + (target.after ? 1 : 0);
      if (from < to) to -= 1;
      if (to !== from) {
        landing.current = { id: h.id, left: r.left, top: r.top };
        onReorder(move(ids, from, to).map((x) => byId[x]));
        announce?.(`Moved to place ${to + 1} of ${ids.length}`);
        return;
      }
    }
    // not moved: settle back where it was
    el.style.transition = "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)"; el.style.transform = "translate3d(0, 0, 0) scale(1)";
    setTimeout(() => { el.style.transition = ""; el.style.transform = ""; setHeldId(null); }, 300);
  };

  // After a move the card is in its new place: start it from where it was let go and settle it there (nothing jumps).
  useLayoutEffect(() => {
    const l = landing.current;
    if (!l) return undefined;
    landing.current = null;
    const el = inners.current[l.id];
    if (!el) { setHeldId(null); return undefined; }
    el.style.transition = "none"; el.style.transform = "none";
    const base = el.getBoundingClientRect();
    el.style.transform = `translate3d(${l.left - base.left}px, ${l.top - base.top}px, 0) scale(1.015)`;
    void el.offsetWidth;   // commit that start before the move to rest
    el.style.transition = "transform 0.34s cubic-bezier(0.16, 1, 0.3, 1)"; el.style.transform = "translate3d(0, 0, 0) scale(1)";
    const t = setTimeout(() => { el.style.transition = ""; el.style.transform = ""; setHeldId(null); }, 360);
    return () => clearTimeout(t);
  }, [widgets]);

  const key = (e, id) => {
    const i = ids.indexOf(id), j = { ArrowLeft: i - 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowDown: i + 1 }[e.key];
    if (j === undefined) return;
    e.preventDefault();
    if (j < 0 || j >= ids.length) return;
    onReorder(move(ids, i, j).map((x) => byId[x]));
    announce?.(`Moved to place ${j + 1} of ${ids.length}`);
    requestAnimationFrame(() => document.getElementById(`gt-grip-${id}`)?.focus());
  };

  return (
    <div ref={grid} className="gt-widgets" id="gt-widgets" data-editing={editing || undefined} data-settled={settled || editing || undefined} data-dragging={heldId || undefined}>
      {ids.map((id, i) => {
        const w = byId[id];
        const isHeld = heldId === id;
        const grip = (title) => (
          <button type="button" id={`gt-grip-${id}`} className="gt-grip" aria-label={`Move ${title}. Drag it, or use the arrow keys`}
            onPointerDown={(e) => start(e, id)} onPointerMove={drag} onPointerUp={release} onPointerCancel={release} onKeyDown={(e) => key(e, id)}>
            <GripVertical aria-hidden="true" /><span>Drag</span>
          </button>
        );
        return (
          <motion.div key={id} ref={(el) => { tiles.current[id] = el; }} layout={isHeld ? false : "position"} transition={{ type: "spring", stiffness: 420, damping: 42, mass: 0.9 }}
            className={cn("gt-w", editing && "editing", isHeld && "held")} data-size={w.size} data-drop={drop && drop.id === id ? (drop.after ? "after" : "before") : undefined}>
            <div ref={(el) => { inners.current[id] = el; }} className="gt-w-in">{renderTile(w, i, grip)}</div>
          </motion.div>
        );
      })}
    </div>
  );
}
