import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { Busy, Sk, SkRows } from "@/components/skeletons";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, CalendarPlus, Check, ChevronLeft, ChevronRight, Copy, Loader2, MoreHorizontal, Pencil, Plus, ShoppingCart, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { Card } from "@/components/common";
import { InfoTip } from "@/components/InfoTip";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PlanGenerator } from "./PlanGenerator";
import { MEALS, MEAL_BY_KEY, STATUS_LABEL, fmt, prettyDate, shiftDate, shortDate, weekStart, refreshNutrition } from "./shared";

const MEAL_ORDER = Object.fromEntries(MEALS.map((m, i) => [m.key, i]));
const GOOD = new Set(["met", "within", "under"]);
const CHIPS = [["protein_g", "Protein"], ["fiber_g", "Fibre"], ["sodium_mg", "Sodium"], ["sat_fat_g", "Sat. fat"]];

function ShoppingDialog({ open, onOpenChange, start, end }) {
  const { data: lists } = useFetch(open ? "/shopping/lists" : null);
  const [listId, setListId] = useState("default");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const run = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/nutrition/plan/shopping-list", { start, end, list_id: listId === "default" ? undefined : listId });
      setResult(data); refreshNutrition(["/groceries", "/shopping"]);
    } catch (err) { toast.error(errorMessage(err, "Could not build the shopping list")); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setResult(null); }}>
      <DialogContent className="max-w-md" data-testid="plan-shopping-dialog">
        <DialogHeader>
          <DialogTitle>Shopping list for this week</DialogTitle>
          <DialogDescription>Adds what the plan needs ({prettyDate(start)} to {prettyDate(end)}), minus what is already in your kitchen. Nothing is marked as bought.</DialogDescription>
        </DialogHeader>
        {!result ? (
          <div className="space-y-4">
            <div>
              <label htmlFor="ps-list" className="text-xs font-medium text-slate-500 dark:text-slate-400">Add to</label>
              <Select value={listId} onValueChange={setListId}>
                <SelectTrigger id="ps-list" className="mt-1 h-10"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="default">My main list</SelectItem>{(lists || []).filter((l) => !l.archived).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex justify-end"><Button onClick={run} disabled={busy} className="bg-emerald-700 text-white hover:bg-emerald-800" data-testid="plan-shopping-go">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ShoppingCart className="mr-1.5 h-4 w-4" />Add what is missing</>}</Button></div>
          </div>
        ) : (
          <div className="space-y-3 text-sm" data-testid="plan-shopping-result" aria-live="polite">
            {result.planned_items === 0 ? <p className="text-slate-500 dark:text-slate-400">Nothing is planned in this week yet, so there is nothing to buy.</p> : (
              <>
                <p><strong>{result.added.length}</strong> {result.added.length === 1 ? "item" : "items"} added{result.added.length ? ":" : "."}</p>
                {result.added.length > 0 && <ul className="list-inside list-disc text-slate-600 dark:text-slate-300">{result.added.map((a) => <li key={a.id}>{a.name}: {fmt(a.quantity)} {a.unit}</li>)}</ul>}
                {result.already_on_list.length > 0 && <p className="text-slate-500 dark:text-slate-400">Already on the list: {result.already_on_list.join(", ")}.</p>}
                {result.in_stock.length > 0 && <p className="text-slate-500 dark:text-slate-400">Already in stock: {result.in_stock.join(", ")}.</p>}
                {result.units_not_comparable.length > 0 && <p className="text-amber-700 dark:text-amber-400">Check the amounts yourself (stock is counted in a different unit): {result.units_not_comparable.join(", ")}.</p>}
                {result.skipped.length > 0 && <p className="text-slate-500 dark:text-slate-400">Not listed (typed-in items have no ingredients): {result.skipped.join(", ")}.</p>}
                <p className="text-xs text-slate-500 dark:text-slate-400">{result.note}</p>
              </>
            )}
            <div className="flex justify-between gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button><Button asChild className="bg-emerald-700 text-white hover:bg-emerald-800"><Link to="/groceries">Open Groceries</Link></Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PlanRow({ item, today, onEdit, onDelete }) {
  const [busy, setBusy] = useState(false);
  const logged = item.status === "logged";
  const n = item.nutrients || {};
  const log = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/nutrition/plan/${item.id}/log`, { date: item.date > today ? today : item.date });
      toast.success(data.duplicate ? "Already in your diary" : `Logged ${item.description} to your diary`); refreshNutrition();
    } catch (err) { toast.error(errorMessage(err, "Could not log this")); } finally { setBusy(false); }
  };
  const move = async (days) => {
    try { await api.put(`/nutrition/plan/${item.id}`, { date: shiftDate(item.date, days) }); toast.success(days > 0 ? "Moved to the next day" : "Moved to the previous day"); refreshNutrition(); }
    catch (err) { toast.error(errorMessage(err, "Could not move this")); }
  };
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 sm:px-5" data-testid={`plan-item-${item.id}`}>
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: MEAL_BY_KEY[item.meal_type]?.color }} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-sm font-medium", logged && "text-slate-500 dark:text-slate-400")}>{item.description}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {MEAL_BY_KEY[item.meal_type]?.label}{item.eaten_at ? ` · ${item.eaten_at}` : ""}
          {item.quantity != null ? ` · ${fmt(item.quantity)} ${item.unit === "serving" ? "serving" + (item.quantity === 1 ? "" : "s") : item.unit}` : ""}
          {item.note ? ` · ${item.note}` : ""}
        </p>
      </div>
      <p className="stat-num shrink-0 text-sm">{n.energy_kcal != null ? fmt(n.energy_kcal) : "–"}<span className="text-xs text-slate-500 dark:text-slate-400"> kcal</span></p>
      {logged ? (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><Check className="h-3 w-3" aria-hidden="true" />Logged</span>
      ) : (
        <Button size="sm" variant="outline" className="h-8 shrink-0" disabled={busy} onClick={log} aria-label={`I ate this: ${item.description}`} data-testid={`plan-log-${item.id}`}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "I ate this"}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Actions for ${item.description}`} data-testid={`plan-menu-${item.id}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {!logged && <DropdownMenuItem onSelect={() => onEdit(item)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>}
          {!logged && <DropdownMenuItem onSelect={() => move(1)}><ArrowRight className="mr-2 h-4 w-4" />Move to next day</DropdownMenuItem>}
          {!logged && <DropdownMenuItem onSelect={() => move(-1)}><ArrowLeft className="mr-2 h-4 w-4" />Move to previous day</DropdownMenuItem>}
          {!logged && <DropdownMenuSeparator />}
          <DropdownMenuItem className="text-red-600 dark:text-red-400 focus:text-red-600" onSelect={() => onDelete(item)} data-testid="plan-delete"><Trash2 className="mr-2 h-4 w-4" />Remove from plan</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** The week at a glance: one tile per day with how much is planned against the reference. A tile brings its day card into view. */
function WeekRail({ days, today, onPick }) {
  const max = Math.max(1, ...days.map((d) => d.totals.energy_kcal || 0));
  return (
    <ol className="grid grid-cols-7 gap-1.5 sm:gap-2.5" aria-label="The week at a glance" data-testid="week-rail">
      {days.map((d) => {
        const kcal = d.totals.energy_kcal || 0;
        const n = d.entries.length;
        const share = d.energy_target ? kcal / d.energy_target : kcal / max;
        const short = shortDate(d.date);
        return (
          <li key={d.date}>
            <button type="button" onClick={() => onPick(d.date)} data-testid={`rail-${d.date}`}
              className={cn("flex w-full flex-col items-center gap-1 rounded-2xl border bg-field px-1 pb-2 pt-2.5 outline-none transition-[transform,border-color,background-color] duration-200 hover:-translate-y-0.5 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring active:scale-95 motion-reduce:transition-none", d.date === today ? "border-primary/60" : "border-line")}>
              <span className="text-[11px] text-muted-foreground">{short.split(",")[0]}</span>
              <span className="stat-num text-base font-semibold leading-none">{Number(d.date.slice(8))}</span>
              <span aria-hidden="true" className="relative mt-0.5 h-10 w-2 overflow-hidden rounded-full bg-line">
                <span className="absolute inset-x-0 bottom-0 rounded-full pill-fill transition-[height] duration-500 ease-out motion-reduce:transition-none" style={{ height: `${Math.min(100, Math.max(n ? 8 : 0, share * 100))}%` }} />
              </span>
              <span className="stat-num h-2.5 text-[10px] leading-none text-muted-foreground">{n ? fmt(kcal) : ""}</span>
              <span className="sr-only">{`${d.date === today ? ", today" : ""}: ${n ? `${n} planned, ${fmt(kcal)} kcal` : "nothing planned"}`}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function DayCard({ day, today, flash, onAdd, onEdit, onDelete }) {
  const items = useMemo(() => [...day.entries].sort((a, b) => (MEAL_ORDER[a.meal_type] - MEAL_ORDER[b.meal_type]) || (a.eaten_at || "").localeCompare(b.eaten_at || "")), [day.entries]);
  const kcal = day.totals.energy_kcal;
  const pct = day.energy_target && kcal ? Math.min((kcal / day.energy_target) * 100, 100) : 0;
  const isToday = day.date === today;
  const label = prettyDate(day.date, today);
  return (
    <Card className={cn("scroll-mt-28 overflow-hidden transition-shadow duration-500", isToday && "ring-1 ring-primary/40", flash && "ring-2 ring-primary")} data-testid={`plan-day-${day.date}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="font-semibold">{label}{["Today", "Yesterday", "Tomorrow"].includes(label) && <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">{shortDate(day.date)}</span>}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {items.length === 0 ? "Nothing planned" : <><span className="stat-num">{fmt(kcal || 0)}</span> kcal planned{day.energy_target ? ` of about ${fmt(day.energy_target)}` : ""}{day.logged ? ` · ${day.logged} logged` : ""}</>}
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8" onClick={() => onAdd(day.date)} data-testid={`plan-add-${day.date}`}><Plus className="mr-1 h-4 w-4" />Plan</Button>
      </div>
      {items.length > 0 && (
        <>
          <div className="h-1 bg-slate-100 dark:bg-slate-800" aria-hidden="true"><div className="h-full bg-emerald-500 motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${pct}%` }} /></div>
          <div className="divide-y divide-line">{items.map((i) => <PlanRow key={i.id} item={i} today={today} onEdit={onEdit} onDelete={onDelete} />)}</div>
          <div className="flex flex-wrap gap-1.5 border-t border-line px-4 py-2.5 sm:px-5" aria-label="How this day compares with your references">
            {CHIPS.map(([k, label]) => {
              const p = day.progress[k];
              if (!p || p.status === "no_data") return null;
              return (
                <span key={k} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px]", GOOD.has(p.status) ? "bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300" : "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300")}
                  title={p.entries_reporting < p.entries ? `${p.entries - p.entries_reporting} of ${p.entries} planned items have no value for this` : undefined}>
                  {label} {fmt(p.intake)} {p.unit} · {STATUS_LABEL[p.status]}
                </span>
              );
            })}
          </div>
        </>
      )}
    </Card>
  );
}

/** A week of intentions. Planned food stays out of the diary and the day's totals until "I ate this" copies it in. */
export function PlanTab({ anchor, today, onAdd, onEdit }) {
  const [start, setStart] = useState(() => weekStart(anchor || today));
  const end = shiftDate(start, 6);
  const { data: plan } = useFetch(`/nutrition/plan?start=${start}&end=${end}`);
  const [toDelete, setToDelete] = useState(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const thisWeek = weekStart(today);
  const reduce = useReducedMotion();
  const [flash, setFlash] = useState(null);
  const flashTimer = useRef(0);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const showDay = (d) => {
    document.querySelector(`[data-testid="plan-day-${d}"]`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    setFlash(d); clearTimeout(flashTimer.current); flashTimer.current = setTimeout(() => setFlash(null), 1400);
  };
  const total = plan ? plan.days.reduce((s, d) => s + d.entries.length, 0) : 0;

  const remove = async () => {
    try { await api.delete(`/nutrition/plan/${toDelete.id}`); toast.success("Removed from the plan"); setToDelete(null); refreshNutrition(); }
    catch (err) { toast.error(errorMessage(err, "Could not remove this")); }
  };
  const copyWeek = async () => {
    try { const { data } = await api.post("/nutrition/plan/copy", { from_start: start, days: 7, to_start: shiftDate(start, 7) }); toast.success(`Copied ${data.copied} planned ${data.copied === 1 ? "item" : "items"} to next week`); setCopyOpen(false); setStart(shiftDate(start, 7)); refreshNutrition(); }
    catch (err) { toast.error(errorMessage(err, "Could not copy the week")); setCopyOpen(false); }
  };

  return (
    <div className="space-y-5" data-testid="plan-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-full border border-line-strong bg-field" role="group" aria-label="Choose week">
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label="Previous week" onClick={() => setStart(shiftDate(start, -7))} data-testid="week-prev"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-[10rem] px-1 text-center text-sm font-medium" data-testid="week-label">{prettyDate(start, today)} – {prettyDate(end, today)}</span>
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" aria-label="Next week" onClick={() => setStart(shiftDate(start, 7))} data-testid="week-next"><ChevronRight className="h-4 w-4" /></Button>
          </div>
          {start !== thisWeek && <Button variant="outline" size="sm" className="rounded-full" onClick={() => setStart(thisWeek)} data-testid="week-this">This week</Button>}
          <InfoTip label="About the plan">Planned food is separate from your diary: it only counts once you tap "I ate this". Totals use the nutrients saved when you planned it.</InfoTip>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setGenOpen(true)} className="rounded-full bg-emerald-700 text-white hover:bg-emerald-800" data-testid="plan-generate"><Sparkles className="mr-1.5 h-4 w-4" />Suggest a week</Button>
          <span title={total ? undefined : "Plan something this week first"}><Button variant="outline" size="sm" className="rounded-full" disabled={!total} onClick={() => setCopyOpen(true)} data-testid="plan-copy-week"><Copy className="mr-1.5 h-4 w-4" />Copy to next week</Button></span>
          <span title={total ? undefined : "Plan something this week first"}><Button variant="outline" size="sm" className="rounded-full" disabled={!total} onClick={() => setShopOpen(true)} data-testid="plan-shopping"><ShoppingCart className="mr-1.5 h-4 w-4" />Shopping list</Button></span>
        </div>
      </div>

      {!plan ? (
        <Busy label="Loading your plan" className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => <Card key={i} className="p-4" aria-hidden="true"><div className="flex items-center justify-between"><Sk className="h-4 w-28" /><Sk className="h-3 w-14" /></div><SkRows n={2} lead="square" figure={false} className="mt-2" /></Card>)}
        </Busy>
      ) : (
        <>
          <WeekRail days={plan.days} today={today} onPick={showDay} />
          {total === 0 && (
            <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="plan-empty"><CalendarPlus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>Nothing planned for this week. Tap <strong className="font-semibold text-foreground">Plan</strong> on a day, or <strong className="font-semibold text-foreground">Suggest a week</strong>; copying the week and a shopping list unlock once something is planned.</span></p>
          )}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {plan.days.map((d) => <DayCard key={d.date} day={d} today={today} flash={flash === d.date} onAdd={onAdd} onEdit={onEdit} onDelete={setToDelete} />)}
          </div>
        </>
      )}

      <ConfirmDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)} title="Remove from the plan?" description={toDelete ? `"${toDelete.description}" will be removed from ${prettyDate(toDelete.date, today)}. Your diary is not touched.` : ""} onConfirm={remove} confirmText="Remove" variant="danger" />
      <ConfirmDialog open={copyOpen} onOpenChange={setCopyOpen} title="Copy this week's plan to next week?" description="Everything planned this week is added to the same days next week, as new planned items. What is already planned next week stays." onConfirm={copyWeek} confirmText="Copy" />
      <PlanGenerator open={genOpen} onOpenChange={setGenOpen} start={start} today={today} />
      <ShoppingDialog open={shopOpen} onOpenChange={setShopOpen} start={start} end={end} />
    </div>
  );
}
