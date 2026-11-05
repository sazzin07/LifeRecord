import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { NutritionOrb, MacroChips } from "./Orb";
import { QuickWater } from "./QuickWater";
import { prettyDate, shiftDate } from "./shared";

/** Previous day, the day (opens the calendar), next day, and a way back to today. One pill, so the three belong together. */
export function DayNav({ date, today, go, goToday }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="day-nav">
      <div className="flex min-w-0 items-center rounded-full border border-line-strong bg-field" role="group" aria-label="Choose day">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full" aria-label="Previous day" disabled={!date} onClick={() => go(shiftDate(date, -1))} data-testid="day-prev"><ChevronLeft className="h-4 w-4" /></Button>
        <div className="w-44 min-w-0">
          <DatePicker value={date || ""} onChange={(v) => v && go(v)} clearable={false} aria-label="Day"
            className="h-9 justify-center rounded-full border-transparent bg-transparent px-2 hover:border-transparent hover:bg-hover data-[state=open]:border-transparent data-[state=open]:bg-hover" />
        </div>
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full" aria-label="Next day" disabled={!date} onClick={() => go(shiftDate(date, 1))} data-testid="day-next"><ChevronRight className="h-4 w-4" /></Button>
      </div>
      {date && date !== today && <Button variant="outline" size="sm" className="rounded-full" onClick={goToday} data-testid="day-today">Today</Button>}
      {date && date !== today && <p className="text-sm text-muted-foreground" data-testid="day-label">{prettyDate(date, today)}</p>}
    </div>
  );
}

/**
 * Everything the day panel holds: the day, the rings, the macro figures, the water. The ring being looked at (hover, keyboard focus or a tap that stays pinned) is
 * kept here so the figures under the orb and the rings light each other up; a tap anywhere else, or Escape, lets go.
 */
export function DayPanel({ day, loading, date, today, go, goToday, openAdd, nav = true }) {
  const [hover, setHover] = useState(null);
  const [pinned, setPinned] = useState(null);
  const scope = useRef(null);
  const active = hover ?? pinned;
  const pin = (k) => setPinned((p) => (k == null || p === k ? null : k));
  useEffect(() => {
    if (!pinned) return undefined;
    const away = (e) => { if (!scope.current?.contains(e.target)) setPinned(null); };
    const esc = (e) => { if (e.key === "Escape") setPinned(null); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [pinned]);
  return (
    <div className="space-y-5">
      {nav && <DayNav date={date} today={today} go={go} goToday={goToday} />}
      <div ref={scope} className="space-y-5">
        <NutritionOrb day={day} loading={loading} active={active} onHover={setHover} onPin={pin} />
        <MacroChips day={day} loading={loading} active={active} onHover={setHover} onPin={pin} />
      </div>
      <QuickWater day={day} date={date} loading={loading} />
      {!loading && day.entries === 0 && (
        <div className="rounded-3xl border border-dashed border-line-strong px-5 py-6 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-line bg-field text-accent-ink"><Utensils className="h-5 w-5" aria-hidden="true" /></span>
          <p className="mt-3 font-semibold">Nothing logged for this day yet</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">Search, scan or type a meal in. The rings fill as you go.</p>
          <Button onClick={() => openAdd()} className="mt-4" data-testid="add-first"><Plus className="mr-1 h-4 w-4" />Add food</Button>
        </div>
      )}
    </div>
  );
}
