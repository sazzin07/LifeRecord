import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addMonths, addWeeks, eachDayOfInterval, format, isSameMonth, parseISO, startOfMonth } from "date-fns";
import { ChevronLeft, ChevronRight, CheckSquare, Apple, ShoppingCart, Dumbbell, Scale, Utensils, Repeat } from "lucide-react";
import { api } from "@/lib/api";
import { useFetch, refreshAll } from "@/lib/useFetch";
import { calendarPath, iso, monthGridRange, weekRange } from "@/lib/calendarRange";
import { Card, SectionHeading } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const KINDS = {
  task: { label: "Tasks", icon: CheckSquare, to: "/tasks", chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200", dot: "bg-emerald-500" },
  expiry: { label: "Food expiring", icon: Apple, to: "/groceries", chip: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200", dot: "bg-amber-500" },
  shopping: { label: "Shopping", icon: ShoppingCart, to: "/groceries", chip: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200", dot: "bg-sky-500" },
  workout: { label: "Workouts", icon: Dumbbell, to: "/fitness", chip: "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200", dot: "bg-violet-500" },
  weight: { label: "Weigh-ins", icon: Scale, to: "/body", chip: "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-200", dot: "bg-teal-500" },
  meals: { label: "Meals", icon: Utensils, to: "/nutrition", chip: "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200", dot: "bg-orange-500" },
};
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FILTER_KEY = "lm_calendar_hidden";

const readHidden = () => { try { return JSON.parse(localStorage.getItem(FILTER_KEY) || "[]"); } catch { return []; } };
const eventLabel = (e) => e.kind === "shopping" ? `${e.title} due` : e.kind === "expiry" ? `${e.title} ${e.meta.expired ? "expired" : "expires"}` : e.title;

function EventChip({ e }) {
  const k = KINDS[e.kind];
  return (
    <span className={cn("block truncate rounded-md px-1.5 py-0.5 text-[11px] leading-tight", k.chip,
      e.kind === "task" && e.meta.done && "line-through opacity-60", e.kind === "expiry" && e.meta.expired && "!bg-red-100 !text-red-800 dark:!bg-red-500/20 dark:!text-red-200")}>
      {eventLabel(e)}
    </span>
  );
}

function DayPanel({ day, events, onToggleTask }) {
  return (
    <Card className="p-5" data-testid="calendar-day-panel">
      <h3 className="font-semibold mb-3">{format(parseISO(day), "EEEE d MMMM")}</h3>
      {events.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing on this day.</p>
      ) : (
        <ul className="space-y-2">
          {events.map((e) => {
            const k = KINDS[e.kind];
            return (
              <li key={`${e.kind}-${e.id}`} className="flex items-center gap-3 text-sm" data-testid={`calendar-event-${e.kind}-${e.id}`}>
                {e.kind === "task" ? (
                  <Checkbox checked={e.meta.done} onCheckedChange={() => onToggleTask(e)} aria-label={e.meta.done ? `Mark "${e.title}" not done` : `Mark "${e.title}" done`} />
                ) : (
                  <k.icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                )}
                <span className={cn("h-2 w-2 shrink-0 rounded-full", e.kind === "task" && e.meta.priority === "high" ? "bg-red-500" : k.dot)} aria-hidden="true" />
                <Link to={k.to} className={cn("flex-1 hover:underline", e.kind === "task" && e.meta.done && "line-through text-slate-400")}>{eventLabel(e)}</Link>
                {e.kind === "task" && e.meta.recurring && <Repeat className="h-3.5 w-3.5 text-slate-400" aria-label={`Repeats ${e.meta.recurring}`} />}
                <span className="text-xs text-slate-400">{k.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default function CalendarPage() {
  const [view, setView] = useState("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => iso(new Date()));
  const [hidden, setHidden] = useState(readHidden);

  const range = useMemo(() => (view === "month" ? monthGridRange(anchor) : weekRange(anchor)), [view, anchor]);
  const { data, loading } = useFetch(calendarPath(range));
  const today = iso(new Date());
  const days = useMemo(() => eachDayOfInterval(range), [range]);

  const byDay = useMemo(() => {
    const m = {};
    for (const e of data?.events || []) if (!hidden.includes(e.kind)) (m[e.date] = m[e.date] || []).push(e);
    return m;
  }, [data, hidden]);

  const toggleKind = (kind) => setHidden((h) => {
    const next = h.includes(kind) ? h.filter((x) => x !== kind) : [...h, kind];
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
    return next;
  });
  // Keep the selected day inside the range on screen, so its panel always matches loaded data.
  const move = (dir) => {
    const a = view === "month" ? addMonths(anchor, dir) : addWeeks(anchor, dir);
    setAnchor(a);
    setSelected(iso(view === "month" ? startOfMonth(a) : weekRange(a).start));
  };
  const changeView = (v) => { setView(v); setAnchor(parseISO(selected)); };
  const goToday = () => { setAnchor(new Date()); setSelected(today); };
  const pick = (d) => { setSelected(d); if (view === "month" && !isSameMonth(parseISO(d), anchor)) setAnchor(parseISO(d)); };

  const toggleTask = async (e) => {
    try {
      await api.put(`/tasks/${e.id}`, { title: e.title, priority: e.meta.priority, due: e.date, recurring: e.meta.recurring, done: !e.meta.done });
      if (!e.meta.done && e.meta.recurring) toast.success("Done — the next one is on your calendar");
      refreshAll();
    } catch {
      toast.error("Could not update task");
    }
  };

  const title = view === "month" ? format(anchor, "MMMM yyyy") : `${format(range.start, "d MMM")} – ${format(range.end, "d MMM yyyy")}`;

  return (
    <div className="space-y-6">
      <SectionHeading title="Calendar" sub="Due tasks, food to use up, shopping days and what you logged" />

      <Card className="p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => move(-1)} aria-label={view === "month" ? "Previous month" : "Previous week"} data-testid="calendar-prev"><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => move(1)} aria-label={view === "month" ? "Next month" : "Next week"} data-testid="calendar-next"><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <h2 className="font-semibold text-base sm:text-lg flex-1 min-w-[10rem]" aria-live="polite" data-testid="calendar-title">{title}</h2>
          <Button variant="outline" size="sm" className="h-9" onClick={goToday}>Today</Button>
          <div className="inline-flex rounded-xl border border-border p-0.5" role="group" aria-label="View">
            {["month", "week"].map((v) => (
              <button key={v} type="button" onClick={() => changeView(v)} aria-pressed={view === v} data-testid={`calendar-view-${v}`}
                className={cn("rounded-lg px-3 py-1.5 text-sm capitalize", view === v ? "bg-emerald-600 text-white" : "text-slate-600 dark:text-slate-300")}>{v}</button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Show on calendar">
          {Object.entries(KINDS).map(([kind, k]) => (
            <button key={kind} type="button" onClick={() => toggleKind(kind)} aria-pressed={!hidden.includes(kind)} data-testid={`calendar-filter-${kind}`}
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
                hidden.includes(kind) ? "border-border text-slate-400" : "border-transparent " + k.chip)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", hidden.includes(kind) ? "bg-slate-300" : k.dot)} aria-hidden="true" />{k.label}
            </button>
          ))}
        </div>
      </Card>

      {loading ? (
        <div className="skeleton h-96 rounded-2xl" aria-busy="true" />
      ) : (
        <Card className="overflow-hidden" data-testid={`calendar-${view}`}>
          <div className="grid grid-cols-7 border-b border-border bg-slate-50/60 dark:bg-slate-800/40">
            {WEEKDAYS.map((d) => <div key={d} className="px-1 py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-slate-500">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const key = iso(d);
              const evs = byDay[key] || [];
              const outside = view === "month" && !isSameMonth(d, anchor);
              const max = view === "month" ? 3 : 8;
              return (
                <button key={key} type="button" onClick={() => pick(key)} data-testid={`calendar-day-${key}`}
                  aria-label={`${format(d, "EEEE d MMMM")}${evs.length ? `, ${evs.length} item${evs.length > 1 ? "s" : ""}` : ""}`}
                  aria-pressed={selected === key} aria-current={key === today ? "date" : undefined}
                  className={cn("flex flex-col items-stretch gap-1 border-b border-r border-border p-1 sm:p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500",
                    view === "month" ? "min-h-[3.5rem] sm:min-h-[6.5rem]" : "min-h-[8rem] sm:min-h-[14rem]",
                    outside && "bg-slate-50/50 dark:bg-slate-900/40 text-slate-400",
                    selected === key ? "bg-emerald-50 dark:bg-emerald-500/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/50")}>
                  <span className={cn("grid h-6 w-6 place-items-center rounded-full text-xs font-medium",
                    key === today && "bg-emerald-600 text-white")}>{format(d, "d")}</span>
                  {/* Phones: coloured dots; wider screens: labelled chips */}
                  <span className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                    {evs.slice(0, 6).map((e) => <span key={`${e.kind}-${e.id}`} className={cn("h-1.5 w-1.5 rounded-full", KINDS[e.kind].dot)} />)}
                  </span>
                  <span className="hidden sm:flex flex-col gap-0.5" aria-hidden="true">
                    {evs.slice(0, max).map((e) => <EventChip key={`${e.kind}-${e.id}`} e={e} />)}
                    {evs.length > max && <span className="px-1 text-[11px] text-slate-500">+{evs.length - max} more</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {!loading && <DayPanel day={selected} events={byDay[selected] || []} onToggleTask={toggleTask} />}
    </div>
  );
}
