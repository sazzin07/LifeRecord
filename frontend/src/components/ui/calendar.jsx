import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, addMonths, addYears, endOfWeek, format, getDaysInMonth, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";

import { useSettings } from "@/context/SettingsContext";
import { cn } from "@/lib/utils";

const EXPO = [0.16, 1, 0.3, 1];
const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(2001, i, 1));

/**
 * A compact month calendar: the month's days only (no greyed days from the next month), the heading opens a month grid for a quick jump, the arrow keys, Home, End
 * and Page Up/Down move around, and the month slides in the direction you are going. `selected` and `onSelect(date)` are the whole contract (single date).
 */
function Calendar({ selected, onSelect, defaultMonth, autoFocus = false, className }) {
  const { animations, weekStart } = useSettings();
  const reduce = useReducedMotion() || animations === false;
  const wk = { weekStartsOn: weekStart === "sunday" ? 0 : 1 };
  const today = React.useMemo(() => new Date(), []);
  const start = selected || defaultMonth || today;
  const [view, setView] = React.useState(() => startOfMonth(start));     // the month on show
  const [focus, setFocus] = React.useState(() => start);                  // the day that holds the keyboard focus (roving tabindex)
  const [mode, setMode] = React.useState("days");                         // "days" or "months"
  const [dir, setDir] = React.useState(1);
  const cells = React.useRef({});
  const wantFocus = React.useRef(autoFocus);

  React.useEffect(() => {
    if (!wantFocus.current || mode !== "days") return;
    wantFocus.current = false;
    cells.current[format(focus, "yyyy-MM-dd")]?.focus();
  }, [focus, view, mode]);

  const showMonth = (m, d) => { setDir(d >= 0 ? 1 : -1); setView(startOfMonth(m)); };
  const clampTo = (m) => new Date(m.getFullYear(), m.getMonth(), Math.min(focus.getDate(), getDaysInMonth(m)));
  const step = (months) => { const m = addMonths(view, months); showMonth(m, months); setFocus(clampTo(m)); };
  const move = (d) => { wantFocus.current = true; if (!isSameMonth(d, view)) showMonth(d, d > view ? 1 : -1); setFocus(d); };
  const onKey = (e) => {
    const k = e.key;
    const to = k === "ArrowLeft" ? addDays(focus, -1) : k === "ArrowRight" ? addDays(focus, 1) : k === "ArrowUp" ? addDays(focus, -7) : k === "ArrowDown" ? addDays(focus, 7)
      : k === "Home" ? startOfWeek(focus, wk) : k === "End" ? endOfWeek(focus, wk)
      : k === "PageUp" ? (e.shiftKey ? addYears(focus, -1) : addMonths(focus, -1)) : k === "PageDown" ? (e.shiftKey ? addYears(focus, 1) : addMonths(focus, 1)) : null;
    if (to) { e.preventDefault(); move(to); }
  };

  const first = startOfWeek(startOfMonth(view), wk);
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, i) => addDays(first, w * 7 + i)));
  const heads = weeks[0].map((d) => ({ short: format(d, "EEEEEE"), full: format(d, "EEEE") }));
  const t = reduce ? { duration: 0 } : { duration: 0.28, ease: EXPO };
  const slide = { enter: (d) => ({ opacity: 0, x: reduce ? 0 : d * 18 }), center: { opacity: 1, x: 0 }, exit: (d) => ({ opacity: 0, x: reduce ? 0 : d * -18 }) };
  const nav = "grid h-8 w-8 place-items-center rounded-full text-muted-foreground outline-none transition-colors duration-200 hover:bg-field hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className={cn("w-[17.25rem] select-none p-3", className)} data-testid="calendar">
      <div className="flex items-center justify-between gap-1">
        <button type="button" className={nav} aria-label={mode === "days" ? "Previous month" : "Previous year"} onClick={() => (mode === "days" ? step(-1) : showMonth(addYears(view, -1), -1))}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" aria-live="polite" aria-expanded={mode === "months"} onClick={() => setMode((m) => (m === "days" ? "months" : "days"))} data-testid="calendar-heading"
          className="rounded-full px-3 py-1 text-sm font-semibold tracking-tight outline-none transition-colors duration-200 hover:bg-field focus-visible:ring-2 focus-visible:ring-ring">
          {mode === "days" ? format(view, "MMMM yyyy") : format(view, "yyyy")}
        </button>
        <button type="button" className={nav} aria-label={mode === "days" ? "Next month" : "Next year"} onClick={() => (mode === "days" ? step(1) : showMonth(addYears(view, 1), 1))}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
      </div>

      <div className="relative mt-2 h-[16.25rem] overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout" custom={dir}>
          <motion.div key={`${mode}-${format(view, mode === "days" ? "yyyy-MM" : "yyyy")}`} custom={dir} variants={slide} initial="enter" animate="center" exit="exit" transition={t} className="absolute inset-0">
            {mode === "days" ? (
              <div role="grid" aria-label={format(view, "MMMM yyyy")} onKeyDown={onKey}>
                <div role="row" className="grid grid-cols-7">
                  {heads.map((h) => <div key={h.full} role="columnheader" aria-label={h.full} className="grid h-8 place-items-center text-[0.6875rem] font-medium text-muted-foreground">{h.short}</div>)}
                </div>
                {weeks.map((week, wi) => (
                  <div role="row" key={wi} className="grid grid-cols-7">
                    {week.map((d) => {
                      const iso = format(d, "yyyy-MM-dd");
                      if (!isSameMonth(d, view)) return <div key={iso} role="gridcell" aria-hidden="true" className="h-9" />;
                      const sel = !!selected && isSameDay(d, selected);
                      const now = isSameDay(d, today);
                      return (
                        <div key={iso} role="gridcell" aria-selected={sel} className="grid h-9 place-items-center">
                          <button type="button" ref={(el) => { cells.current[iso] = el; }} tabIndex={isSameDay(d, focus) ? 0 : -1} data-testid={`day-${iso}`}
                            aria-label={format(d, "EEEE d MMMM yyyy")} aria-current={now ? "date" : undefined}
                            onFocus={() => setFocus(d)} onClick={() => onSelect?.(d)}
                            className={cn("group relative grid h-9 w-9 place-items-center rounded-full text-sm outline-none transition-colors duration-200 hover:bg-field focus-visible:ring-2 focus-visible:ring-ring", sel ? "font-semibold text-white hover:bg-transparent" : now ? "font-semibold text-accent-ink" : "text-foreground")}>
                            <span aria-hidden="true" className={cn("absolute inset-0.5 rounded-full pill-fill transition-[opacity,transform] duration-300 ease-out motion-reduce:transition-none", sel ? "scale-100 opacity-100" : "scale-75 opacity-0")} />
                            <span className="stat-num relative">{format(d, "d")}</span>
                            {now && <span aria-hidden="true" className={cn("absolute bottom-1 h-[3px] w-[3px] rounded-full transition-colors duration-200", sel ? "bg-white" : "bg-current")} />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div role="group" aria-label={`Months of ${format(view, "yyyy")}`} className="grid h-full grid-cols-3 content-center gap-1.5 pt-2">
                {MONTHS.map((m, i) => {
                  const cur = i === view.getMonth();
                  return (
                    <button key={i} type="button" aria-label={`${format(m, "MMMM")} ${format(view, "yyyy")}`} aria-pressed={cur}
                      onClick={() => { const nm = new Date(view.getFullYear(), i, 1); setDir(nm >= view ? 1 : -1); setView(nm); setFocus(clampTo(nm)); setMode("days"); }}
                      className={cn("h-12 rounded-2xl text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring", cur ? "pill-fill font-semibold" : "hover:bg-field", !cur && isSameMonth(new Date(view.getFullYear(), i, 1), today) && "font-semibold text-accent-ink")}>
                      {format(m, "MMM")}
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
