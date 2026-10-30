import { useMemo, useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { MEAL_BY_KEY, fmt, prettyDate, refreshNutrition } from "./shared";

const AIM = [["auto", "Protein and fibre"], ["fiber_g", "More fibre"], ["protein_g", "More protein"], ["calcium_mg", "Calcium"], ["iron_mg", "Iron"], ["potassium_mg", "Potassium"], ["magnesium_mg", "Magnesium"], ["vit_c_mg", "Vitamin C"]];
const DAYS = [3, 5, 7, 10, 14];
const SLOTS = ["breakfast", "lunch", "dinner", "snack"];
const keyOf = (i) => `${i.date}|${i.meal_type}`;

/**
 * Builds a week from your own recipes and foods and shows it before anything is saved. Each item says why it is there, and you keep or
 * drop items one by one; only the ones you keep are added, as planned (not eaten) entries.
 */
export function PlanGenerator({ open, onOpenChange, start, today }) {
  const [days, setDays] = useState(7);
  const [slots, setSlots] = useState(["breakfast", "lunch", "dinner"]);
  const [aim, setAim] = useState("auto");
  const [repeats, setRepeats] = useState(2);
  const [useDb, setUseDb] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [plan, setPlan] = useState(null);
  const [dropped, setDropped] = useState(new Set());

  const begin = start < today ? today : start;
  const kept = useMemo(() => (plan ? plan.days.flatMap((d) => d.items).filter((i) => !dropped.has(keyOf(i))) : []), [plan, dropped]);

  const toggleSlot = (s) => setSlots((x) => (x.includes(s) ? (x.length > 1 ? x.filter((y) => y !== s) : x) : [...x, s]));
  const preview = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/nutrition/plan/generate", { start: begin, days, slots, focus: aim === "auto" ? [] : [aim], max_repeats: repeats, use_database_foods: useDb });
      setPlan(data); setDropped(new Set());
    } catch (err) { toast.error(errorMessage(err, "Could not build a plan")); } finally { setBusy(false); }
  };
  const apply = async () => {
    setSaving(true);
    try {
      const { data } = await api.post("/nutrition/plan/bulk", { items: kept.map((i) => ({ date: i.date, meal_type: i.meal_type, ...i.log })) });
      toast.success(`Added ${data.created} planned ${data.created === 1 ? "item" : "items"}. They count once you log them.`);
      refreshNutrition(); onOpenChange(false); setPlan(null);
    } catch (err) { toast.error(errorMessage(err, "Nothing was added")); } finally { setSaving(false); }
  };
  const close = (v) => { onOpenChange(v); if (!v) setPlan(null); };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto overflow-x-hidden [&>*]:min-w-0" data-testid="plan-generator">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-emerald-700" aria-hidden="true" />Suggest a week</DialogTitle>
          <DialogDescription>Built only from your own recipes and foods, aimed at what you choose. You see it first and keep what you like.</DialogDescription>
        </DialogHeader>

        {!plan ? (
          <div className="space-y-4" data-testid="plan-options">
            <div className="grid gap-3 sm:grid-cols-3">
              <div><label htmlFor="pg-days" className="text-xs font-medium text-slate-500 dark:text-slate-400">From {prettyDate(begin, today)}, for</label>
                <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}><SelectTrigger id="pg-days" className="mt-1 h-10" data-testid="pg-days"><SelectValue /></SelectTrigger>
                  <SelectContent>{DAYS.map((d) => <SelectItem key={d} value={String(d)}>{d} days</SelectItem>)}</SelectContent></Select></div>
              <div><label htmlFor="pg-aim" className="text-xs font-medium text-slate-500 dark:text-slate-400">Aim for</label>
                <Select value={aim} onValueChange={setAim}><SelectTrigger id="pg-aim" className="mt-1 h-10" data-testid="pg-aim"><SelectValue /></SelectTrigger>
                  <SelectContent>{AIM.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
              <div><label htmlFor="pg-rep" className="text-xs font-medium text-slate-500 dark:text-slate-400">Use each item up to</label>
                <Select value={String(repeats)} onValueChange={(v) => setRepeats(Number(v))}><SelectTrigger id="pg-rep" className="mt-1 h-10" data-testid="pg-repeats"><SelectValue /></SelectTrigger>
                  <SelectContent>{[1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n} {n === 1 ? "time" : "times"}</SelectItem>)}</SelectContent></Select></div>
            </div>
            <fieldset>
              <legend className="text-xs font-medium text-slate-500 dark:text-slate-400">Plan these meals</legend>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {SLOTS.map((s) => (
                  <button key={s} type="button" aria-pressed={slots.includes(s)} onClick={() => toggleSlot(s)} data-testid={`pg-slot-${s}`}
                    className={cn("rounded-full border px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                      slots.includes(s) ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" : "border-border text-slate-600 dark:text-slate-300")}>{MEAL_BY_KEY[s].label}</button>
                ))}
              </div>
            </fieldset>
            <label htmlFor="pg-db" className="flex items-start gap-2 text-sm"><Checkbox id="pg-db" checked={useDb} onCheckedChange={(c) => setUseDb(!!c)} className="mt-0.5" data-testid="pg-db" />
              <span>Fill gaps with foods from the reference database<span className="block text-xs text-slate-500 dark:text-slate-400">Only if you have few recipes. They are marked as new to you.</span></span></label>
            <p className="text-xs text-slate-500 dark:text-slate-400">Slots that already have something planned are left alone.</p>
            <div className="flex justify-end"><Button onClick={preview} disabled={busy} className="bg-emerald-700 text-white hover:bg-emerald-800" data-testid="pg-preview">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Preview the week"}</Button></div>
          </div>
        ) : (
          <div className="space-y-4" data-testid="plan-preview" aria-live="polite">
            <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/50">
              <p><strong>{plan.placed}</strong> {plan.placed === 1 ? "item" : "items"} proposed for {prettyDate(plan.start, today)} to {prettyDate(plan.end, today)}.
                {plan.focus.filter((f) => f.average_percent != null).map((f) => ` ${f.name} averages ${f.average_percent}% of your daily reference.`).join("")}</p>
              {plan.excluded_for_diet > 0 && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{plan.excluded_for_diet} of your saved {plan.excluded_for_diet === 1 ? "item was" : "items were"} left out because of your diet or allergy words.</p>}
            </div>
            {plan.notes.map((n) => <p key={n} className="flex gap-2 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{n}</p>)}
            {plan.placed === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="plan-preview-empty">Nothing could be planned with these settings.</p> : (
              <ul className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
                {plan.days.filter((d) => d.items.length || d.skipped.length).map((d) => (
                  <li key={d.date} data-testid={`pg-day-${d.date}`}>
                    <p className="text-sm font-semibold">{prettyDate(d.date, today)} <span className="stat-num ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">{fmt(d.items.filter((i) => !dropped.has(keyOf(i))).reduce((s, i) => s + (i.nutrients.energy_kcal || 0), 0))} kcal</span></p>
                    <ul className="mt-1 divide-y divide-border rounded-xl border border-border">
                      {d.items.map((i) => {
                        const k = keyOf(i);
                        const on = !dropped.has(k);
                        const id = `pg-${i.date}-${i.meal_type}`;
                        return (
                          <li key={k} className="flex items-start gap-3 px-3 py-2">
                            <Checkbox id={id} checked={on} onCheckedChange={(c) => setDropped((x) => { const n = new Set(x); if (c) n.delete(k); else n.add(k); return n; })} className="mt-1" data-testid={`pg-keep-${i.date}-${i.meal_type}`} />
                            <label htmlFor={id} className={cn("min-w-0 flex-1 cursor-pointer text-sm", !on && "text-slate-500 dark:text-slate-400 line-through")}>
                              <span className="block truncate font-medium">{MEAL_BY_KEY[i.meal_type].label}: {i.name}</span>
                              <span className="block text-xs text-slate-500 dark:text-slate-400"><span className="stat-num">{fmt(i.nutrients.energy_kcal)} kcal</span>
                                {i.covers.slice(0, 2).map((c) => ` · ${c.name} ${Math.round(c.percent_of_remaining)}%`).join("")}{i.flags.length ? ` · ${i.flags[0]}` : ""}</span>
                            </label>
                          </li>
                        );
                      })}
                      {d.skipped.length > 0 && <li className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">Already planned, left alone: {d.skipped.map((s) => MEAL_BY_KEY[s].label.toLowerCase()).join(", ")}</li>}
                      {d.unfilled.length > 0 && <li className="px-3 py-2 text-xs text-amber-700 dark:text-amber-400">Nothing suitable for: {d.unfilled.map((s) => MEAL_BY_KEY[s].label.toLowerCase()).join(", ")}</li>}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{plan.basis}</p>
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="outline" onClick={() => setPlan(null)} data-testid="pg-back">Change options</Button>
              <Button onClick={apply} disabled={saving || kept.length === 0} className="bg-emerald-700 text-white hover:bg-emerald-800" data-testid="pg-apply">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : `Add ${kept.length} ${kept.length === 1 ? "item" : "items"} to my plan`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
