import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, CalendarCheck, CalendarPlus, Check, ChevronLeft, ChevronRight, Copy, Loader2, MoreHorizontal, Pencil, Plus, ShoppingCart, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { Card } from "@/components/common";
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
              <label htmlFor="ps-list" className="text-xs font-medium text-slate-500">Add to</label>
              <Select value={listId} onValueChange={setListId}>
                <SelectTrigger id="ps-list" className="mt-1 h-10"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="default">My main list</SelectItem>{(lists || []).filter((l) => !l.archived).map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex justify-end"><Button onClick={run} disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="plan-shopping-go">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><ShoppingCart className="mr-1.5 h-4 w-4" />Add what is missing</>}</Button></div>
          </div>
        ) : (
          <div className="space-y-3 text-sm" data-testid="plan-shopping-result" aria-live="polite">
            {result.planned_items === 0 ? <p className="text-slate-500">Nothing is planned in this week yet, so there is nothing to buy.</p> : (
              <>
                <p><strong>{result.added.length}</strong> {result.added.length === 1 ? "item" : "items"} added{result.added.length ? ":" : "."}</p>
                {result.added.length > 0 && <ul className="list-inside list-disc text-slate-600 dark:text-slate-300">{result.added.map((a) => <li key={a.id}>{a.name}: {fmt(a.quantity)} {a.unit}</li>)}</ul>}
                {result.already_on_list.length > 0 && <p className="text-slate-500">Already on the list: {result.already_on_list.join(", ")}.</p>}
                {result.in_stock.length > 0 && <p className="text-slate-500">Already in stock: {result.in_stock.join(", ")}.</p>}
                {result.units_not_comparable.length > 0 && <p className="text-amber-700 dark:text-amber-400">Check the amounts yourself (stock is counted in a different unit): {result.units_not_comparable.join(", ")}.</p>}
                {result.skipped.length > 0 && <p className="text-slate-500">Not listed (typed-in items have no ingredients): {result.skipped.join(", ")}.</p>}
                <p className="text-xs text-slate-500">{result.note}</p>
              </>
            )}
            <div className="flex justify-between gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button><Button asChild className="bg-emerald-600 text-white hover:bg-emerald-700"><Link to="/groceries">Open Groceries</Link></Button></div>
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
        <p className={cn("truncate text-sm font-medium", logged && "text-slate-500")}>{item.description}</p>
        <p className="text-xs text-slate-500">
          {MEAL_BY_KEY[item.meal_type]?.label}{item.eaten_at ? ` · ${item.eaten_at}` : ""}
          {item.quantity != null ? ` · ${fmt(item.quantity)} ${item.unit === "serving" ? "serving" + (item.quantity === 1 ? "" : "s") : item.unit}` : ""}
          {item.note ? ` · ${item.note}` : ""}
        </p>
      </div>
      <p className="stat-num shrink-0 text-sm">{n.energy_kcal != null ? fmt(n.energy_kcal) : "–"}<span className="text-xs text-slate-500"> kcal</span></p>
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
          <DropdownMenuItem className="text-red-600 focus:text-red-600" onSelect={() => onDelete(item)} data-testid="plan-delete"><Trash2 className="mr-2 h-4 w-4" />Remove from plan</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function DayCard({ day, today, onAdd, onEdit, onDelete }) {
  const items = useMemo(() => [...day.entries].sort((a, b) => (MEAL_ORDER[a.meal_type] - MEAL_ORDER[b.meal_type]) || (a.eaten_at || "").localeCompare(b.eaten_at || "")), [day.entries]);
  const kcal = day.totals.energy_kcal;
  const pct = day.energy_target && kcal ? Math.min((kcal / day.energy_target) * 100, 100) : 0;
  const isToday = day.date === today;
  const label = prettyDate(day.date, today);
  return (
    <Card className={cn("overflow-hidden", isToday && "ring-1 ring-emerald-400/60")} data-testid={`plan-day-${day.date}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="font-semibold">{label}{["Today", "Yesterday", "Tomorrow"].includes(label) && <span className="ml-2 text-sm font-normal text-slate-500">{shortDate(day.date)}</span>}</h3>
          <p className="text-xs text-slate-500">
            {items.length === 0 ? "Nothing planned" : <><span className="stat-num">{fmt(kcal || 0)}</span> kcal planned{day.energy_target ? ` of about ${fmt(day.energy_target)}` : ""}{day.logged ? ` · ${day.logged} logged` : ""}</>}
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8" onClick={() => onAdd(day.date)} data-testid={`plan-add-${day.date}`}><Plus className="mr-1 h-4 w-4" />Plan</Button>
      </div>
      {items.length > 0 && (
        <>
          <div className="h-1 bg-slate-100 dark:bg-slate-800" aria-hidden="true"><div className="h-full bg-emerald-500 motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${pct}%` }} /></div>
          <div className="divide-y divide-border">{items.map((i) => <PlanRow key={i.id} item={i} today={today} onEdit={onEdit} onDelete={onDelete} />)}</div>
          <div className="flex flex-wrap gap-1.5 border-t border-border px-4 py-2.5 sm:px-5" aria-label="How this day compares with your references">
            {CHIPS.map(([k, label]) => {
              const p = day.progress[k];
              if (!p || p.status === "no_data") return null;
              return (
                <span key={k} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px]", GOOD.has(p.status) ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300")}
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
          <div className="flex items-center rounded-xl border border-border bg-card" role="group" aria-label="Choose week">
            <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Previous week" onClick={() => setStart(shiftDate(start, -7))} data-testid="week-prev"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-[10rem] px-1 text-center text-sm font-medium" data-testid="week-label">{prettyDate(start, today)} – {prettyDate(end, today)}</span>
            <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Next week" onClick={() => setStart(shiftDate(start, 7))} data-testid="week-next"><ChevronRight className="h-4 w-4" /></Button>
          </div>
          {start !== thisWeek && <Button variant="outline" size="sm" onClick={() => setStart(thisWeek)}>This week</Button>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setGenOpen(true)} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="plan-generate"><Sparkles className="mr-1.5 h-4 w-4" />Suggest a week</Button>
          <Button variant="outline" size="sm" disabled={!total} onClick={() => setCopyOpen(true)} data-testid="plan-copy-week"><Copy className="mr-1.5 h-4 w-4" />Copy to next week</Button>
          <Button variant="outline" size="sm" disabled={!total} onClick={() => setShopOpen(true)} data-testid="plan-shopping"><ShoppingCart className="mr-1.5 h-4 w-4" />Shopping list</Button>
        </div>
      </div>
      <p className="flex items-start gap-2 text-sm text-slate-500"><CalendarCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />Planned food is separate from your diary: it only counts once you tap "I ate this". Totals use the nutrients saved when you planned it.</p>

      {!plan ? (
        <div className="grid gap-4 lg:grid-cols-2" aria-busy="true">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-36 rounded-2xl" />)}</div>
      ) : (
        <>
          {total === 0 && (
            <Card className="p-6 text-center text-sm text-slate-500" data-testid="plan-empty">
              <CalendarPlus className="mx-auto mb-2 h-6 w-6 text-slate-400" aria-hidden="true" />
              Nothing planned for this week. Tap <strong>Plan</strong> on any day to add a food or a recipe, or <strong>Suggest a week</strong> to get a proposal you can review first. A shopping list can be built from either.
            </Card>
          )}
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {plan.days.map((d) => <DayCard key={d.date} day={d} today={today} onAdd={onAdd} onEdit={onEdit} onDelete={setToDelete} />)}
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
