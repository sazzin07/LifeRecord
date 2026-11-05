import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { refreshAll, useFetch } from "@/lib/useFetch";

// the pure helpers live in format.js (unit-tested); they are re-exported so the tabs keep importing everything from "./shared"
import { MEAL_BY_KEY, defaultAmount, defaultMeal, fmt, shortName } from "./format";
export * from "./format";

/** What a Nutrition change can affect: its own data, recipes, and the calendar (which shows meal counts per day). */
const NUTRITION_SCOPE = ["/nutrition", "/recipes", "/calendar"];
/** Refresh only the data a Nutrition action touches; pass more prefixes when it also changes the kitchen (e.g. ["/groceries", "/shopping"]). */
export const refreshNutrition = (extra = []) => refreshAll([...NUTRITION_SCOPE, ...extra]);

/** Log a food with one tap. The confirmation offers Undo, and the entry can be edited from the diary afterwards. */
export async function logFoodNow(food, { date, mealType } = {}) {
  const amount = defaultAmount(food);
  const meal = mealType || defaultMeal();
  try {
    const { data } = await api.post("/nutrition/diary", { date, food_id: food.id, meal_type: meal, ...amount, client_ref: crypto.randomUUID ? crypto.randomUUID() : undefined });
    toast.success(`Added ${shortName(food.name)} · ${fmt(amount.quantity)} ${amount.unit}`, {
      description: `${MEAL_BY_KEY[meal].label}. Change the amount from the entry's menu.`,
      action: { label: "Undo", onClick: () => api.delete(`/nutrition/diary/${data.id}`).then(() => refreshNutrition()).catch((err) => toast.error(errorMessage(err, "Could not undo"))) },
    });
    refreshNutrition();
    return data;
  } catch (err) {
    toast.error(errorMessage(err, "Could not add this food"));
    return null;
  }
}

export function useNutrientMeta() {
  const { data } = useFetch("/nutrition/meta");
  return useMemo(() => {
    const byKey = {};
    (data?.nutrients || []).forEach((n) => { byKey[n.key] = n; });
    return { meta: data, byKey };
  }, [data]);
}

const QUALITY = {
  verified: ["Verified", "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300", "Laboratory or reference-database value"],
  estimated: ["Estimated", "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300", "Crowd-sourced or approximate value"],
  user: ["Yours", "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300", "Entered by you"],
  mixed: ["Mixed", "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300", "Built from sources of different quality"],
};
export function QualityBadge({ quality, className }) {
  const [label, tone, title] = QUALITY[quality] || QUALITY.user;
  return <span title={title} className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", tone, className)}>{label}</span>;
}

/** How many of the day's entries reported a value. Dots, not a percentage, so "3 of 5" stays literal. */
export function Coverage({ reporting, entries }) {
  if (!entries) return null;
  const full = reporting === entries;
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px]", full ? "text-slate-500 dark:text-slate-400" : "text-amber-700 dark:text-amber-400")}
      title={full ? "Every entry reported this value" : `${entries - reporting} of ${entries} entries have no value for this`}>
      <span className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: Math.min(entries, 8) }).map((_, i) => (
          <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i < Math.min(reporting, 8) ? "bg-current" : "border border-current")} />
        ))}
      </span>
      {full ? null : <span>{reporting}/{entries}</span>}
    </span>
  );
}

/**
 * A reference RANGE drawn as a band with the intake as a marker (EFSA gives macronutrients as ranges, e.g. 20-35% of energy
 * from fat). Without a range it falls back to a bar towards the target.
 */
export function RangeGauge({ label, color, intake, min, max, target, unit, missing, testid, loading }) {
  const hi = max ?? target ?? 0;
  const scale = Math.max(hi * 1.3, (intake || 0) * 1.08, 1);
  const pos = (v) => `${Math.min(Math.max(v / scale, 0), 1) * 100}%`;
  const hasRange = min != null && max != null;
  const state = missing ? "No data yet" : hasRange ? (intake < min ? "Below range" : intake > max ? "Above range" : "In range")
    : target ? (intake >= target ? "Target reached" : `${Math.round((intake / target) * 100)}% of target`) : "";
  const tone = missing ? "text-slate-500 dark:text-slate-400" : state === "In range" || state === "Target reached" ? "text-green-700 dark:text-green-400" : "text-slate-500 dark:text-slate-400";
  return (
    <div data-testid={testid}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <p className="stat-num text-sm font-semibold">{missing ? "–" : fmt(intake)}<span className="text-xs font-normal text-slate-500 dark:text-slate-400"> {unit}</span></p>
      </div>
      <div className="relative mt-2 h-2.5 rounded-full bg-slate-100 dark:bg-slate-800" role="img"
        aria-label={`${label}: ${missing ? "no data" : `${fmt(intake)} ${unit}`}${hasRange ? `, range ${fmt(min)} to ${fmt(max)}` : ""}. ${state}`}>
        {hasRange ? (
          <div className="absolute inset-y-0 rounded-full opacity-25" style={{ left: pos(min), width: `calc(${pos(max)} - ${pos(min)})`, background: color }} />
        ) : (
          !missing && <div className="absolute inset-y-0 left-0 rounded-full motion-safe:transition-[width] motion-safe:duration-500" style={{ width: pos(intake || 0), background: color }} />
        )}
        {hasRange && !missing && (
          <div className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-slate-900 motion-safe:transition-[left] motion-safe:duration-500"
            style={{ left: pos(intake), background: color }} />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs">
        <span className={tone}>{loading ? <span className="sk-ph">In range</span> : state}</span>
        <span className="text-slate-500 dark:text-slate-400">{loading ? <span className="sk-ph">target 000 g</span> : hasRange ? `${fmt(min)}–${fmt(max)} ${unit}` : target ? `target ${fmt(target)} ${unit}` : ""}</span>
      </div>
    </div>
  );
}

/** The day as one bar: each meal is a segment, sized by its energy, against the energy target. */
export function EnergyBar({ meals, total, target }) {
  const base = Math.max(target || 0, total || 0, 1);
  return (
    <div>
      <div className="flex h-5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="img"
        aria-label={`Energy by meal: ${meals.map((m) => `${MEAL_BY_KEY[m.meal_type]?.label} ${Math.round(m.totals.energy_kcal || 0)} kilocalories`).join(", ") || "nothing logged"}`}>
        {meals.map((m) => (
          <div key={m.meal_type} className="h-full border-r-2 border-white last:border-r-0 dark:border-slate-900 motion-safe:transition-[width] motion-safe:duration-500"
            style={{ width: `${((m.totals.energy_kcal || 0) / base) * 100}%`, background: MEAL_BY_KEY[m.meal_type]?.color }} />
        ))}
      </div>
      {target > 0 && total > target && (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{fmt(total - target)} kcal above the reference energy for today.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {meals.map((m) => (
          <span key={m.meal_type} className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <span className="h-2 w-2 rounded-full" style={{ background: MEAL_BY_KEY[m.meal_type]?.color }} aria-hidden="true" />
            {MEAL_BY_KEY[m.meal_type]?.label} <span className="stat-num text-slate-500 dark:text-slate-400">{fmt(m.totals.energy_kcal || 0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export const STATUS_LABEL = { met: "Reached", below: "Below", within: "In range", above: "Above range", over: "Over limit", under: "Under limit", no_data: "No data" };

export const SRC_LABEL = { efsa2017: "EFSA 2017", efsa_ul: "EFSA upper levels", who2026: "WHO", eu1169: "EU labelling" };
const UPPER_SCOPE = { total: "all sources", added: "added or supplemental only", preformed: "preformed only", forms: "one form only" };

/** One short line about EFSA's upper (or safe) level for a nutrient, or null when EFSA gives none for this person. */
export function upperLevelText(upper, unit) {
  if (!upper || upper.kind === "none" || upper.value == null) return null;
  const what = upper.kind === "safe" ? "Safe level" : "Upper level";
  return `${what} ${fmt(upper.value)} ${unit} a day (${UPPER_SCOPE[upper.scope] || "see source"})${upper.kind === "safe" ? ", not a limit" : ""}`;
}

/**
 * Shown when a day's logged total is above a comparable EFSA upper (or safe) level. It is a prompt to look, never a diagnosis:
 * the levels concern usual intake over weeks and cover supplements, which are not logged.
 */
export function UpperLevelBanner({ items, byKey }) {
  if (!items?.length) return null;
  return (
    <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="upper-banner" role="note">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-medium">Above an EFSA {items.some((i) => i.kind === "UL") ? "upper level" : "safe level"} today</p>
        <ul className="mt-1 list-disc pl-4">
          {items.map((i) => <li key={i.key}>{byKey[i.key]?.name || i.key}: {fmt(i.intake)} {i.unit} against {i.kind === "UL" ? "an upper level" : "a safe level (not a limit)"} of {fmt(i.limit)} {i.unit}</li>)}
        </ul>
        <p className="mt-1 text-xs">These levels describe usual intake over weeks and include supplements, which are not logged here, so one day above one is a reason to look, not a finding. Ask a doctor or dietitian if you are unsure.</p>
      </div>
    </div>
  );
}
