import { useId, useState } from "react";
import { Busy, SkRows } from "@/components/skeletons";
import { ChefHat, ChevronDown, Loader2, Plus, RefreshCw, Sparkles, Star, Utensils } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { Card } from "@/components/common";
import { InfoTip } from "@/components/InfoTip";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { MEALS, MEAL_BY_KEY, fmt, refreshNutrition, shortName } from "./shared";

const AIM = [["protein_g", "Protein"], ["fiber_g", "Fibre"], ["calcium_mg", "Calcium"], ["iron_mg", "Iron"], ["potassium_mg", "Potassium"], ["magnesium_mg", "Magnesium"], ["vit_c_mg", "Vitamin C"], ["vit_d_ug", "Vitamin D"]];
const SHOWN = 3;
const KIND = { recipe: ["Your recipe", ChefHat], food: ["Your food", Star] };

function Idea({ item, date, meal, onLogged }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const [label, Icon] = item.discover ? ["New to you", Sparkles] : KIND[item.kind] || KIND.food;
  const log = async () => {
    if (!item.log) return;
    setBusy(true);
    try {
      const { data } = await api.post("/nutrition/diary", { date, ...item.log, meal_type: meal, client_ref: crypto.randomUUID ? crypto.randomUUID() : undefined });
      toast.success(`Added ${shortName(item.name)}`, {
        description: `${MEAL_BY_KEY[meal]?.label || "Diary"}. Change the amount from the entry's menu.`,
        action: { label: "Undo", onClick: () => api.delete(`/nutrition/diary/${data.id}`).then(() => refreshNutrition()).catch((err) => toast.error(errorMessage(err, "Could not undo"))) },
      });
      refreshNutrition(); onLogged?.();
    } catch (err) { toast.error(errorMessage(err, "Could not add this")); } finally { setBusy(false); }
  };
  const p = item.portion || {};
  return (
    <li className="px-4 py-3 sm:px-5" data-testid={`idea-${item.kind}-${item.id}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={item.name}>{item.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1"><Icon className="h-3 w-3" aria-hidden="true" />{label}</span>
            <span className="stat-num">{fmt(item.nutrients.energy_kcal)} kcal</span>
            {p.quantity != null && <span>{fmt(p.quantity)} {p.unit === "serving" ? (p.quantity === 1 ? "serving" : "servings") : p.unit}{p.grams && p.unit !== "g" ? ` · ${fmt(p.grams)} g` : ""}</span>}
          </p>
        </div>
        <Button size="sm" className="h-8 shrink-0 bg-emerald-700 text-white hover:bg-emerald-800" disabled={busy || !item.log} onClick={log} aria-label={`Add ${shortName(item.name)} to ${MEAL_BY_KEY[meal]?.label.toLowerCase() || "the diary"}`} data-testid={`idea-log-${item.id}`}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="mr-1 h-4 w-4" />Add</>}
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.covers.slice(0, 3).map((c) => (
          <span key={c.nutrient} className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{c.name} {Math.round(c.percent_of_remaining)}% of what is left</span>
        ))}
        {item.pantry?.can_cook_now && <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"><Utensils className="h-3 w-3" aria-hidden="true" />In your kitchen</span>}
        {item.pantry?.uses_expiring?.length > 0 && <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Uses {item.pantry.uses_expiring[0].name}, expiring</span>}
        {item.pantry && !item.pantry.can_cook_now && item.pantry.missing.length > 0 && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-700/60 dark:text-slate-300">Needs {item.pantry.missing.length} more</span>}
        {item.watch.map((w) => <span key={w.nutrient} className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">{w.name} {fmt(w.amount)} {w.unit}</span>)}
      </div>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)} data-testid={`idea-why-${item.id}`}
        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 focus-visible:outline-none focus-visible:underline dark:hover:text-slate-200">
        Why this? <ChevronDown className={cn("h-3.5 w-3.5 motion-safe:transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && <p id={id} className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{item.why}</p>}
    </li>
  );
}

/**
 * Ideas for what to eat next, from your own recipes and foods and a few new ones, ranked by what is still needed today. Every idea says why it is
 * here; nothing is added until you tap Add.
 */
export function Suggestions({ date }) {
  const [meal, setMeal] = useState(null); // null = the meal that fits the time of day
  const [aim, setAim] = useState("auto");
  const [all, setAll] = useState(false);
  const path = `/nutrition/suggestions?date=${date}${meal ? `&meal_type=${meal}` : ""}${aim !== "auto" ? `&focus=${aim}` : ""}&limit=8`;
  const { data, loading, reload } = useFetch(date ? path : null);
  const slot = meal || data?.meal_type || "dinner";
  const ideas = data ? [...data.suggestions, ...data.discover.filter((d) => !data.suggestions.some((s) => s.kind === d.kind && s.id === d.id))] : [];
  const shown = all ? ideas : ideas.slice(0, SHOWN);

  return (
    <Card className="overflow-hidden" data-testid="suggestions" aria-labelledby="sug-title">
      <div className="space-y-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 id="sug-title" className="flex items-center gap-2 font-semibold"><Sparkles className="h-4 w-4 text-emerald-700" aria-hidden="true" />What could I eat?</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="suggestions-context">
              {data?.context ? (data.context.remaining_kcal > 0 ? `${data.context.budget_kcal} kcal fits this meal; ${data.context.remaining_kcal} kcal left today` : "You have reached today's energy reference") : "Ideas based on what is left of today"}
            </p>
          </div>
          <Select value={aim} onValueChange={(v) => { setAim(v); setAll(false); }}>
            <SelectTrigger className="h-9 w-52" aria-label="Aim at" data-testid="suggestions-aim"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="auto">Aim: what is missing</SelectItem>{AIM.map(([k, l]) => <SelectItem key={k} value={k}>Aim: {l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div role="group" aria-label="Meal" className="flex flex-wrap gap-1.5">
          {MEALS.filter((m) => m.key !== "other").map((m) => (
            <button key={m.key} type="button" aria-pressed={slot === m.key} onClick={() => { setMeal(m.key); setAll(false); }} data-testid={`suggest-meal-${m.key}`}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                slot === m.key ? "border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" : "border-border text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50")}>{m.label}</button>
          ))}
        </div>
        {loading && <p className="text-xs text-muted-foreground"><span className="sk-ph">Still needed: Protein 00 g · Fibre 00 g</span></p>}
        {data?.context?.focus?.length > 0 && (
          <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="suggestions-focus">Still needed: {data.context.focus.map((f) => `${f.name} ${fmt(f.remaining)} ${f.unit}`).join(" · ")}</p>
        )}
      </div>

      {loading ? (
        <>
          <Busy label="Loading suggestions" className="p-5"><SkRows n={SHOWN} lead="square" figure={false} rowClass="py-[34px]" /></Busy>
          {/* the strip for "Show more" and the footnote the loaded card ends with, so the cards below do not jump when it arrives */}
          <div className="h-9 border-t border-line" aria-hidden="true" />
          <p className="border-t border-line px-5 py-2 text-[11px] text-muted-foreground" aria-hidden="true"><span className="sk-ph">About these ideas</span></p>
        </>
      ) : !data ? (
        <div className="flex flex-wrap items-center justify-between gap-2 p-5 text-sm text-slate-600" role="alert">
          <span>Suggestions could not be loaded just now.</span>
          <Button size="sm" variant="outline" onClick={() => reload()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Try again</Button>
        </div>
      ) : ideas.length === 0 ? (
        <p className="p-5 text-sm text-slate-500 dark:text-slate-400" data-testid="suggestions-empty">{data.note || "Nothing fits right now. Try another meal, or change what to aim at."}</p>
      ) : (
        <>
          {data.note && data.suggestions.length === 0 && <p className="border-b border-border px-5 py-3 text-xs text-slate-500 dark:text-slate-400">{data.note}</p>}
          <ul className="divide-y divide-line" aria-label="Ideas">{shown.map((i) => <Idea key={`${i.kind}-${i.id}`} item={i} date={date} meal={slot} />)}</ul>
          {ideas.length > SHOWN && <Button type="button" variant="ghost" size="sm" className="w-full rounded-none border-t border-line" aria-expanded={all} onClick={() => setAll((v) => !v)} data-testid="suggestions-more">{all ? "Show fewer" : `Show ${ideas.length - SHOWN} more`}</Button>}
          <p className="flex flex-wrap items-center gap-x-1 border-t border-line px-5 py-2 text-[11px] text-muted-foreground">
            {data.excluded_for_diet > 0 && <span>{data.excluded_for_diet} of your saved {data.excluded_for_diet === 1 ? "item was" : "items were"} left out because of your diet or allergy words.</span>}
            <span className="inline-flex items-center">About these ideas<InfoTip label="About these ideas" align="start">Only nutrients a food reports count. Reference values describe healthy people of your age and are not medical advice.</InfoTip></span>
          </p>
        </>
      )}
    </Card>
  );
}
