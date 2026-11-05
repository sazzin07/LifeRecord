import { useState } from "react";
import { ChevronUp } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DayPanel } from "./DayPanel";
import { MACRO_COLORS, fmt, prettyDate } from "./shared";

// Below 1024 px there is no room beside the content, so the day panel becomes a slim strip that stays under the top bar: the energy left, three small rings for
// the macros, and a press opens the whole panel (orb, figures, water) in a sheet.
const MINI = [{ key: "energy", r: 146 }, { key: "protein_g", r: 106 }, { key: "carbs_available_g", r: 66 }, { key: "fat_g", r: 26 }];
const frac = (v, t) => (t > 0 ? Math.max(0, Math.min(1, v / t)) : 0);

function MiniRings({ day }) {
  const prog = day.progress || {};
  const vals = { energy: frac(day.totals?.energy_kcal || 0, day.energy_target || 0), ...Object.fromEntries(["protein_g", "carbs_available_g", "fat_g"].map((k) => [k, frac(prog[k]?.intake || 0, prog[k]?.target ?? prog[k]?.max ?? 0)])) };
  return (
    <svg viewBox="0 0 320 320" className="h-11 w-11 shrink-0" aria-hidden="true">
      {MINI.map((g) => (
        <g key={g.key} transform="rotate(-90 160 160)">
          <circle cx="160" cy="160" r={g.r} fill="none" stroke="var(--line)" strokeWidth="24" />
          <circle cx="160" cy="160" r={g.r} fill="none" stroke={g.key === "energy" ? "hsl(var(--primary))" : MACRO_COLORS[g.key]} strokeWidth="24" strokeLinecap="round" pathLength="1" strokeDasharray={`${vals[g.key]} 1`} />
        </g>
      ))}
    </svg>
  );
}

export function DayStrip({ day, loading, date, today, go, goToday, openAdd }) {
  const [open, setOpen] = useState(false);
  const total = day.totals?.energy_kcal || 0;
  const target = day.energy_target || 0;
  const left = target ? target - total : null;
  const word = left == null ? "kcal today" : left >= 0 ? "kcal left" : "kcal over";
  const figure = loading ? "0000" : fmt(left == null ? total : Math.abs(left));
  const when = date && today && date !== today ? prettyDate(date, today) : "today";
  const prog = day.progress || {};
  return (
    <>
      <div className="sticky top-[4.5rem] z-10" data-testid="day-strip">
        <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" disabled={loading}
          className="card-ambient flex w-full items-center gap-3 rounded-full border px-3 py-2 text-left outline-none backdrop-blur-md transition-transform duration-200 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99]">
          <MiniRings day={day} />
          <span className="min-w-0 flex-1">
            <span className="stat-num block text-lg font-semibold leading-none tracking-tight">{loading ? <span className="sk-ph">{figure}</span> : figure}<span className="ml-1.5 text-sm font-normal text-muted-foreground">{word}</span></span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">{loading ? <span className="sk-ph">today · 000 g protein</span> : `${when === "today" ? "Today" : when}${prog.protein_g ? ` · ${fmt(prog.protein_g.intake || 0)} g protein` : ""}`}</span>
          </span>
          <ChevronUp className="mr-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[92svh] overflow-y-auto rounded-t-3xl px-5 pb-8 pt-6" data-testid="day-sheet">
          <SheetTitle className="sr-only">The day</SheetTitle>
          <SheetDescription className="sr-only">Energy and macronutrient rings, the macro figures and water for the chosen day.</SheetDescription>
          <DayPanel day={day} loading={loading} date={date} today={today} go={go} goToday={goToday} openAdd={(...a) => { setOpen(false); openAdd(...a); }} />
        </SheetContent>
      </Sheet>
    </>
  );
}
