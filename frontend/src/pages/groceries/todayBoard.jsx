import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

/* The Today widgets as a board you rearrange by dragging. Only the grip starts a drag (so scrolling a phone still works anywhere else, and no
   card jiggles). While you drag, the card follows the pointer and the others slide aside to show where it will land; letting go settles it
   there. The page scrolls by itself when you hold the card near its top or bottom edge. The grip is also a keyboard control: arrow keys move
   the card one place (there are no arrow buttons).
   Positions are read from `offsetLeft/offsetTop`, which ignore transforms, so the sliding cards never confuse where the pointer is. */
const EDGE = 90, SCROLL_STEP = 14;
const move = (list, from, to) => { const next = [...list]; next.splice(to, 0, next.splice(from, 1)[0]); return next; };

export function WidgetBoard({ widgets, editing, onReorder, renderTile, announce }) {
  const [order, setOrder] = useState(null);     // ids in the preview order while a card is held; null otherwise
  const [heldId, setHeldId] = useState(null);
  const [settled, setSettled] = useState(false);   // after the cards have risen once, moving one must not replay that
  const grid = useRef(null);
  const tiles = useRef({});                     // the outer tile: its offsets are its place in the grid
  const inners = useRef({});                    // what moves with the pointer, so the grid's own sliding is never disturbed
  const held = useRef(null);                    // {id, dx, dy, x, y, from}: where the pointer grabbed the card and where it is now
  const raf = useRef(0);
  const ids = order || widgets.map((w) => w.id);
  const byId = Object.fromEntries(widgets.map((w) => [w.id, w]));

  // The card sits where the pointer says; the layout may have moved under it (it was swapped, or the page scrolled), so measure the base fresh.
  const follow = useCallback(() => {
    const h = held.current, tile = h && tiles.current[h.id], el = h && inners.current[h.id];
    if (!el || !tile) return;
    const g = grid.current.getBoundingClientRect();
    const tx = h.x - h.dx - (g.left + tile.offsetLeft), ty = h.y - h.dy - (g.top + tile.offsetTop);
    el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(1.015)`;
  }, []);
  useLayoutEffect(() => { follow(); }, [order, follow]);

  const hit = useCallback((h) => {
    const g = grid.current.getBoundingClientRect(), px = h.x - g.left, py = h.y - g.top;
    return ids.find((id) => {
      const el = tiles.current[id];
      return id !== h.id && el && px >= el.offsetLeft && px <= el.offsetLeft + el.offsetWidth && py >= el.offsetTop && py <= el.offsetTop + el.offsetHeight;
    });
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
    held.current = { id, dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY, from: ids.indexOf(id) };
    el.style.transition = "none";
    setHeldId(id);
    setOrder(ids);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(loop);
  };
  const drag = (e) => {
    const h = held.current;
    if (!h) return;
    h.x = e.clientX; h.y = e.clientY;
    const over = hit(h);
    if (over) { const next = move(ids, ids.indexOf(h.id), ids.indexOf(over)); setOrder(next); }
    follow();
  };
  const drop = () => {
    const h = held.current;
    if (!h) return;
    held.current = null;
    cancelAnimationFrame(raf.current);
    const el = inners.current[h.id], final = order || ids;
    if (el) { el.style.transition = "transform 0.28s cubic-bezier(0.16, 1, 0.3, 1)"; el.style.transform = "translate3d(0, 0, 0) scale(1)"; }
    const moved = final.indexOf(h.id) !== h.from;
    if (moved) { onReorder(final.map((id) => byId[id])); announce?.(`Moved to place ${final.indexOf(h.id) + 1} of ${final.length}`); }
    setTimeout(() => { if (el) { el.style.transition = ""; el.style.transform = ""; } setHeldId(null); setOrder(null); }, 300);
  };

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
        if (!w) return null;
        const isHeld = heldId === id;
        const grip = (title) => (
          <button type="button" id={`gt-grip-${id}`} className="gt-grip" aria-label={`Move ${title}. Drag it, or use the arrow keys`}
            onPointerDown={(e) => start(e, id)} onPointerMove={drag} onPointerUp={drop} onPointerCancel={drop} onKeyDown={(e) => key(e, id)}>
            <GripVertical aria-hidden="true" /><span>Drag</span>
          </button>
        );
        return (
          <motion.div key={id} ref={(el) => { tiles.current[id] = el; }} layout={isHeld ? false : "position"} transition={{ type: "spring", stiffness: 520, damping: 46, mass: 0.8 }}
            className={cn("gt-w", editing && "editing", isHeld && "held")} data-size={w.size}>
            <div ref={(el) => { inners.current[id] = el; }} className="gt-w-in">{renderTile(w, i, grip)}</div>
          </motion.div>
        );
      })}
    </div>
  );
}
