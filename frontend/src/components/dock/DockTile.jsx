import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

// One tile of the dock: a round glass element in the theme's own surface (the card fill, a hairline, the light top edge) with a drawn two-tone glyph
// in the accent ink. The current page fills with the selected-pill gradient and a white glyph. Everything comes from tokens, so it follows light and dark.
// Glyphs on a 24 x 24 grid: an outline, and a softer fill under it for the second tone.
const G = {
  home: (<><g fillOpacity=".3" stroke="none" fill="currentColor"><rect x="3.5" y="3.5" width="7.5" height="9.5" rx="2.2" /><rect x="13" y="3.5" width="7.5" height="5.5" rx="2.2" /><rect x="13" y="11" width="7.5" height="9.5" rx="2.2" /><rect x="3.5" y="15" width="7.5" height="5.5" rx="2.2" /></g>
    <rect x="3.5" y="3.5" width="7.5" height="9.5" rx="2.2" /><rect x="13" y="3.5" width="7.5" height="5.5" rx="2.2" /><rect x="13" y="11" width="7.5" height="9.5" rx="2.2" /><rect x="3.5" y="15" width="7.5" height="5.5" rx="2.2" /></>),
  money: (<><rect x="2.5" y="6" width="19" height="12" rx="2.6" fill="currentColor" fillOpacity=".3" stroke="none" /><rect x="2.5" y="6" width="19" height="12" rx="2.6" /><circle cx="12" cy="12" r="2.9" /><path d="M6 9.4v.01M18 14.6v.01" /></>),
  people: (<><circle cx="9" cy="8.5" r="3.1" fill="currentColor" fillOpacity=".3" stroke="none" /><circle cx="9" cy="8.5" r="3.1" /><path d="M3.2 19.5c.5-3.3 2.8-5 5.8-5s5.3 1.7 5.8 5M16 5.6a3 3 0 0 1 0 5.8M18.2 14.8c1.6.8 2.6 2.4 2.9 4.7" /></>),
  food: (<><path d="M12 8.2c2.9-2.7 7.6-.8 6.7 4.7-.9 5-4.2 8.3-6.7 8.3s-5.8-3.3-6.7-8.3C4.4 7.4 9.1 5.5 12 8.2z" fill="currentColor" fillOpacity=".3" stroke="none" /><path d="M12 8.2c2.9-2.7 7.6-.8 6.7 4.7-.9 5-4.2 8.3-6.7 8.3s-5.8-3.3-6.7-8.3C4.4 7.4 9.1 5.5 12 8.2zM12 8.2c0-2 1-3.8 3-4.8" /></>),
  groceries: (<><path d="M3.2 9.2h17.6l-1.6 9.1a2 2 0 0 1-2 1.7H6.8a2 2 0 0 1-2-1.7z" fill="currentColor" fillOpacity=".3" stroke="none" /><path d="M3.2 9.2h17.6l-1.6 9.1a2 2 0 0 1-2 1.7H6.8a2 2 0 0 1-2-1.7zM8 9.2l3-5.2M16 9.2 13 4M9.5 13v3.4M14.5 13v3.4" /></>),
  nutrition: (<><path d="M3.5 11h17a8.5 8.5 0 0 1-17 0z" fill="currentColor" fillOpacity=".3" stroke="none" /><path d="M3.5 11h17a8.5 8.5 0 0 1-17 0zM8.5 11c0-2.6 1.4-4.3 3.5-4.3s3.5 1.7 3.5 4.3M12 6.7C12 5 12.8 3.8 14.5 3" /></>),
  bodygroup: (<><path d="M12 20.2S3.8 15.2 3.8 9.6A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8.2 2.6c0 5.6-8.2 10.6-8.2 10.6z" fill="currentColor" fillOpacity=".3" stroke="none" /><path d="M12 20.2S3.8 15.2 3.8 9.6A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8.2 2.6c0 5.6-8.2 10.6-8.2 10.6zM6.2 12.2h3l1.4-3 2.8 6 1.4-3h3" /></>),
  fitness: (<><rect x="2.8" y="9" width="3.4" height="6" rx="1.2" fill="currentColor" fillOpacity=".35" stroke="none" /><rect x="17.8" y="9" width="3.4" height="6" rx="1.2" fill="currentColor" fillOpacity=".35" stroke="none" /><path d="M6.2 6.6v10.8M17.8 6.6v10.8M2.8 10v4M21.2 10v4M6.2 12h11.6" /></>),
  body: (<><circle cx="12" cy="4.8" r="2.3" fill="currentColor" fillOpacity=".35" stroke="none" /><circle cx="12" cy="4.8" r="2.3" /><path d="M5 10.2c2.4 1 4.4 1.4 7 1.4s4.6-.4 7-1.4M12 11.6v4.2M12 15.8l-3.4 5M12 15.8l3.4 5" /></>),
  tasks: (<><rect x="4" y="3.5" width="16" height="17" rx="3.6" fill="currentColor" fillOpacity=".3" stroke="none" /><rect x="4" y="3.5" width="16" height="17" rx="3.6" /><path d="m8 9 1.5 1.5L12 7.8M8 15.2l1.5 1.5L12 14M14.6 9.2h2.6M14.6 15.4h2.6" /></>),
  calendar: (<><rect x="3.5" y="5" width="17" height="15.5" rx="3.6" fill="currentColor" fillOpacity=".3" stroke="none" /><rect x="3.5" y="5" width="17" height="15.5" rx="3.6" /><path d="M8 3v4M16 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" /></>),
  plan: (<><rect x="3.5" y="5" width="17" height="15.5" rx="3.6" fill="currentColor" fillOpacity=".3" stroke="none" /><rect x="3.5" y="5" width="17" height="15.5" rx="3.6" /><path d="M8 3v4M16 3v4M3.5 10h17M9 15.2l2 2 4-4" /></>),
  assistant: (<><path d="M11 3.5 13 9l5.5 2-5.5 2L11 18.5 9 13 3.5 11 9 9z" fill="currentColor" fillOpacity=".3" stroke="none" /><path d="M11 3.5 13 9l5.5 2-5.5 2L11 18.5 9 13 3.5 11 9 9zM19 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></>),
  more: (<><circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" /></>),
  settings: (<><circle cx="9" cy="8" r="2.6" fill="currentColor" fillOpacity=".35" stroke="none" /><circle cx="15" cy="16" r="2.6" fill="currentColor" fillOpacity=".35" stroke="none" /><path d="M3.5 8h2.9M11.6 8h8.9M3.5 16h8.9M17.6 16h2.9" /><circle cx="9" cy="8" r="2.6" /><circle cx="15" cy="16" r="2.6" /></>),
};

// The selected state is one thing that changes together: the gradient fades in or out, the glyph and the border change colour over the same 200ms, so
// moving from one tile to another never shows a half-way mix or a stretched shape (nothing slides between tiles).
const FADE = { duration: 0.2, ease: "easeInOut" };

export function DockTile({ tile, active, className }) {
  return (
    <span aria-hidden="true"
      className={cn("relative grid place-items-center overflow-hidden rounded-full border [background:var(--card-fill)] shadow-[var(--card-edge)] transition-colors duration-200 ease-in-out motion-reduce:transition-none",
        active ? "border-transparent text-white" : "border-line-strong text-accent-ink", className)}>
      <AnimatePresence initial={false}>
        {active && <motion.span key="fill" className="absolute inset-0 rounded-full pill-fill" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE} />}
      </AnimatePresence>
      <svg viewBox="0 0 24 24" className="relative h-[52%] w-[52%] fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]">{G[tile] || G.settings}</svg>
    </span>
  );
}
