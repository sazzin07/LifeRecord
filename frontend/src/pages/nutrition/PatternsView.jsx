import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { Card } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useFetch } from "@/lib/useFetch";
import { cn } from "@/lib/utils";
import { MEALS, MEAL_BY_KEY, fmt } from "./shared";

const KIND = {
  positive: [CheckCircle2, "text-emerald-600 dark:text-emerald-400"],
  attention: [AlertTriangle, "text-amber-600 dark:text-amber-400"],
  info: [Info, "text-slate-500"],
};
const GROUPS = ["Vegetables", "Fruits", "Legumes", "Grains and cereals", "Dairy and eggs", "Fish and seafood", "Meat and poultry", "Nuts and seeds"];
const pct = (x) => `${Math.round(x * 100)}%`;

function Section({ title, sub, children, testid }) {
  return (
    <Card className="overflow-hidden" data-testid={testid}>
      <div className="border-b border-border px-4 py-3 sm:px-5"><h3 className="font-semibold">{title}</h3>{sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}</div>
      <div className="p-4 sm:p-5">{children}</div>
    </Card>
  );
}

function Insights({ list }) {
  if (!list.length) return null;
  return (
    <Card className="divide-y divide-border" data-testid="pattern-insights">
      {list.map((i) => {
        const [Icon, tone] = KIND[i.kind] || KIND.info;
        return (
          <div key={i.id} className="flex gap-3 px-4 py-3 sm:px-5" data-testid={`insight-${i.id}`}>
            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone)} aria-hidden="true" />
            <div className="min-w-0"><p className="text-sm font-medium">{i.title}</p><p className="mt-0.5 text-xs leading-relaxed text-slate-500">{i.why}</p></div>
          </div>
        );
      })}
    </Card>
  );
}

function Rhythm({ p }) {
  const meals = Object.entries(p.meal_share);
  const order = (k) => MEALS.findIndex((m) => m.key === k);
  return (
    <Section title="When you eat" sub={`${p.days_logged} of ${p.days_in_range} days logged${p.longest_streak > 1 ? ` · longest run ${p.longest_streak} days` : ""}${p.current_streak > 1 ? ` · ${p.current_streak} days in a row now` : ""}`} testid="pattern-rhythm">
      {meals.length === 0 ? <p className="text-sm text-slate-500">No energy values were logged in this period.</p> : (
        <>
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="img"
            aria-label={`Share of energy by meal: ${meals.map(([m, s]) => `${MEAL_BY_KEY[m]?.label} ${pct(s)}`).join(", ")}`}>
            {meals.sort((a, b) => order(a[0]) - order(b[0])).map(([m, s]) => <div key={m} className="h-full border-r-2 border-white last:border-r-0 dark:border-slate-900" style={{ width: `${s * 100}%`, background: MEAL_BY_KEY[m]?.color }} />)}
          </div>
          <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {meals.map(([m, s]) => (
              <li key={m} className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: MEAL_BY_KEY[m]?.color }} aria-hidden="true" />{MEAL_BY_KEY[m]?.label}</span>
                <span className="stat-num text-slate-600 dark:text-slate-300">{pct(s)}{p.typical_time[m] ? <span className="ml-2 text-xs text-slate-400">around {p.typical_time[m]}</span> : null}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-slate-500">Entries per logged day</dt><dd className="stat-num font-medium">{fmt(p.entries_per_logged_day)}</dd></div>
        <div><dt className="text-xs text-slate-500">Average weekday</dt><dd className="stat-num font-medium">{p.weekday_avg_kcal == null ? "no data" : `${fmt(p.weekday_avg_kcal)} kcal`}</dd></div>
        <div><dt className="text-xs text-slate-500">Average weekend day</dt><dd className="stat-num font-medium">{p.weekend_avg_kcal == null ? "no data" : `${fmt(p.weekend_avg_kcal)} kcal`}</dd></div>
      </dl>
    </Section>
  );
}

function Variety({ v }) {
  const judged = v.classified_share == null || v.classified_share >= 0.5; // with most entries unsorted, a group "not seen" would be a guess
  return (
    <Section title="Variety" sub={`${v.distinct_items} different ${v.distinct_items === 1 ? "food" : "foods"}${v.per_logged_day != null ? ` · ${fmt(v.per_logged_day)} per logged day` : ""}`} testid="pattern-variety">
      <ul className="flex flex-wrap gap-1.5" aria-label="Food groups">
        {GROUPS.map((g) => {
          const seen = v.groups_seen.includes(g);
          const missing = judged && v.groups_missing.includes(g);
          return (
            <li key={g} className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs", seen ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200"
              : missing ? "border-dashed border-amber-400 text-amber-700 dark:text-amber-300" : "border-border text-slate-400")} data-testid={`group-${g}`}>
              {seen ? <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> : null}{g}<span className="sr-only">{seen ? " (seen)" : missing ? " (not seen)" : !judged ? " (cannot be judged)" : " (not expected with your diet)"}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-slate-500">Groups come from each food's database category.{v.classified_share != null && v.classified_share < 1 ? ` ${pct(1 - v.classified_share)} of entries could not be sorted (typed-in meals, recipes without linked ingredients).` : ""}</p>
      {v.top.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium text-slate-500">Most repeated</p>
          <ul className="mt-1 space-y-0.5 text-sm">{v.top.slice(0, 4).map((t) => <li key={t.name} className="flex justify-between gap-3"><span className="truncate">{t.name}</span><span className="stat-num shrink-0 text-slate-500">{t.count} × · {pct(t.share)}</span></li>)}</ul>
        </div>
      )}
    </Section>
  );
}

function Density({ rows, foods }) {
  return (
    <Section title="Nutrient density" sub="What each 1,000 kcal you ate brought, compared with what your reference asks per 1,000 kcal" testid="pattern-density">
      {rows.length === 0 ? <p className="text-sm text-slate-500">Not enough logged energy to compare yet.</p> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.nutrient} className={cn(!r.reliable && "opacity-60")} data-testid={`density-${r.nutrient}`}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{r.name}</span>
                <span className="stat-num text-xs text-slate-500">{fmt(r.per_1000_kcal)} {r.unit} per 1,000 kcal · reference {fmt(r.reference_per_1000_kcal)}</span>
              </div>
              <div className="relative mt-1.5 h-2 rounded-full bg-slate-100 dark:bg-slate-800" role="img" aria-label={`${r.name}: ${Math.round(r.ratio * 100)}% of the reference per 1,000 kcal${r.reliable ? "" : ", not enough data to judge"}`}>
                <div className={cn("h-full rounded-full", r.ratio >= 1 ? "bg-emerald-500" : r.ratio >= 0.7 ? "bg-slate-400" : "bg-amber-500")} style={{ width: `${Math.min(r.ratio / 2, 1) * 100}%` }} />
                <div className="absolute inset-y-[-3px] left-1/2 w-px bg-slate-500/60" aria-hidden="true" />
              </div>
              <p className="mt-1 flex justify-between text-[11px] text-slate-500"><span>{Math.round(r.ratio * 100)}% of the reference</span><span>{r.reliable ? `from entries covering ${pct(r.coverage)} of your energy` : `only ${pct(r.coverage)} of your energy reports it: not judged`}</span></p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">The line marks 100%. A low value here describes what was recorded, not a deficiency, and entries that do not report a nutrient are left out of its average, not counted as zero.</p>
      {foods.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="text-sm font-medium">Most nutrient-dense foods you ate</p>
          <ol className="mt-2 space-y-1 text-sm">{foods.map((f) => <li key={f.name} className="flex justify-between gap-3"><span className="truncate">{f.name}</span><span className="stat-num shrink-0 text-xs text-slate-500">index {f.index} · {f.times} × · {f.nutrients_used} nutrients</span></li>)}</ol>
          <p className="mt-2 text-[11px] text-slate-400">Index: the average, over the nutrients a food reports, of how much it gave per calorie compared with your reference (each capped at 2). Foods reporting fewer than 5 of them are not ranked.</p>
        </div>
      )}
    </Section>
  );
}

/** Meal patterns, variety and nutrient density for the period chosen on the Trends tab. */
export function PatternsView({ view, days, date }) {
  const { data, loading, reload } = useFetch(`/nutrition/patterns?days=${days}&end=${date}`);
  if (loading) return <div className="space-y-4" aria-busy="true"><div className="skeleton h-24 rounded-2xl" /><div className="skeleton h-48 rounded-2xl" /></div>;
  if (!data) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-2 p-5 text-sm text-slate-600" role="alert">
        <span>Patterns could not be loaded just now.</span>
        <Button size="sm" variant="outline" onClick={() => reload()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Try again</Button>
      </Card>
    );
  }
  const empty = data.patterns.days_logged === 0;
  return (
    <div className="space-y-6" data-testid="patterns-view">
      <Insights list={data.insights} />
      {empty ? null : view === "patterns" ? (<><Rhythm p={data.patterns} /><Variety v={data.variety} /></>) : <Density rows={data.density} foods={data.dense_foods} />}
      <p className="text-xs text-slate-500">{data.basis}</p>
    </div>
  );
}
