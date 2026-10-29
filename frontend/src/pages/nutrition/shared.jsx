import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useFetch } from "@/lib/useFetch";

export const MEALS = [
  { key: "breakfast", label: "Breakfast", color: "#F59E0B" },
  { key: "lunch", label: "Lunch", color: "#10B981" },
  { key: "dinner", label: "Dinner", color: "#6366F1" },
  { key: "snack", label: "Snacks", color: "#EC4899" },
  { key: "other", label: "Other", color: "#94A3B8" },
];
export const MEAL_BY_KEY = Object.fromEntries(MEALS.map((m) => [m.key, m]));
export const MACRO_COLORS = { protein_g: "#6366F1", carbs_available_g: "#F59E0B", fat_g: "#EF4444" };

/** YYYY-MM-DD in the browser's own time zone (toISOString() would give the UTC day). */
export const localISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const shiftDate = (iso, days) => {
  const [y, m, d] = iso.split("-").map(Number);
  return localISO(new Date(y, m - 1, d + days));
};
export const prettyDate = (iso, today) => {
  if (!today) return iso;
  if (iso === today) return "Today";
  if (iso === shiftDate(today, -1)) return "Yesterday";
  if (iso === shiftDate(today, 1)) return "Tomorrow";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};
export const defaultMeal = () => {
  const h = new Date().getHours();
  return h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 18 ? "snack" : "dinner";
};

export function fmt(n, digits) {
  if (n == null || Number.isNaN(n)) return "–";
  const d = digits ?? (Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2);
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
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
    <span className={cn("inline-flex items-center gap-1 text-[11px]", full ? "text-slate-400" : "text-amber-600 dark:text-amber-400")}
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
export function RangeGauge({ label, color, intake, min, max, target, unit, missing, testid }) {
  const hi = max ?? target ?? 0;
  const scale = Math.max(hi * 1.3, (intake || 0) * 1.08, 1);
  const pos = (v) => `${Math.min(Math.max(v / scale, 0), 1) * 100}%`;
  const hasRange = min != null && max != null;
  const state = missing ? "No data yet" : hasRange ? (intake < min ? "Below range" : intake > max ? "Above range" : "In range")
    : target ? (intake >= target ? "Target reached" : `${Math.round((intake / target) * 100)}% of target`) : "";
  const tone = missing ? "text-slate-400" : state === "In range" || state === "Target reached" ? "text-emerald-600 dark:text-emerald-400" : "text-slate-500";
  return (
    <div data-testid={testid}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{label}</p>
        <p className="stat-num text-sm font-semibold">{missing ? "–" : fmt(intake)}<span className="text-xs font-normal text-slate-500"> {unit}</span></p>
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
        <span className={tone}>{state}</span>
        <span className="text-slate-500">{hasRange ? `${fmt(min)}–${fmt(max)} ${unit}` : target ? `target ${fmt(target)} ${unit}` : ""}</span>
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
        <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{fmt(total - target)} kcal above the reference energy for today.</p>
      )}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {meals.map((m) => (
          <span key={m.meal_type} className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <span className="h-2 w-2 rounded-full" style={{ background: MEAL_BY_KEY[m.meal_type]?.color }} aria-hidden="true" />
            {MEAL_BY_KEY[m.meal_type]?.label} <span className="stat-num text-slate-500">{fmt(m.totals.energy_kcal || 0)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export const STATUS_LABEL = { met: "Reached", below: "Below", within: "In range", above: "Above range", over: "Over limit", under: "Under limit", no_data: "No data" };
