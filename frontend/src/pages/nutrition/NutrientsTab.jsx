import { useMemo, useState } from "react";
import { ChevronDown, Info, Search } from "lucide-react";
import { Card } from "@/components/common";
import { Input } from "@/components/ui/input";
import { useFetch } from "@/lib/useFetch";
import { cn } from "@/lib/utils";
import { Coverage, SRC_LABEL, STATUS_LABEL, UpperLevelBanner, fmt, upperLevelText, useNutrientMeta } from "./shared";

const GROUP_ORDER = ["macro", "fat", "vitamin", "mineral", "other"];
const GROUP_TITLE = { macro: "Macronutrients", fat: "Fats", vitamin: "Vitamins", mineral: "Minerals", other: "Other" };
const TONE = {
  met: "text-emerald-700 dark:text-emerald-400", within: "text-emerald-700 dark:text-emerald-400", under: "text-emerald-700 dark:text-emerald-400",
  below: "text-slate-500 dark:text-slate-400", above: "text-amber-700 dark:text-amber-400", over: "text-amber-700 dark:text-amber-400", no_data: "text-slate-500 dark:text-slate-400",
};
const BAR = { met: "bg-emerald-500", within: "bg-emerald-500", under: "bg-emerald-500", below: "bg-slate-400", above: "bg-amber-500", over: "bg-amber-500", no_data: "bg-slate-300" };

// What each filter keeps. "Below reference" means there is data and it is under the target, never "no data".
const FILTERS = [
  ["all", "All", () => true],
  ["attention", "Below reference", (n) => !!n.p && n.p.status === "below" && n.p.percent != null && n.p.percent < 100],
  ["limits", "Limits", (n) => !!n.p && n.p.kind === "limit"],
  ["nodata", "No data", (n) => n.intake == null || n.p?.status === "no_data"],
];

function Details({ k, day, info, p }) {
  const { data: contrib } = useFetch(`/nutrition/contributors?nutrient=${k}&start=${day.date}&end=${day.date}&limit=4`);
  const { data: rich } = useFetch(`/nutrition/rich-in?nutrient=${k}&limit=5`);
  return (
    <div className="space-y-3 border-t border-border bg-slate-50/60 px-4 py-4 text-sm dark:bg-slate-800/30 sm:px-5">
      <p className="text-slate-600 dark:text-slate-300">{info?.about}</p>
      {p?.note && <p className="flex gap-2 text-xs text-slate-500 dark:text-slate-400"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{p.note}</p>}
      {p?.kind && <p className="text-xs text-slate-500 dark:text-slate-400">Reference: {p.kind === "limit" ? "guideline limit" : p.kind === "RI" ? "reference intake range" : p.kind === "PRI" ? "population reference intake" : p.kind === "AI" ? "adequate intake" : p.kind} ({SRC_LABEL[p.source] || p.source}){p.overridden ? ". You set your own target." : ""}</p>}
      {upperLevelText(p?.upper, info?.unit) && (
        <p className="text-xs text-slate-500 dark:text-slate-400" data-testid={`upper-${k}`}>{upperLevelText(p.upper, info?.unit)}. {p.upper.comparable ? (p.upper.over ? "Today's total is above it. " : "") : "Not compared with what you log: "}{p.upper.basis}</p>
      )}
      {p && p.entries > 0 && p.status !== "no_data" && p.percent != null && p.percent < 60 && !p.complete && (
        <p className="text-xs text-amber-700 dark:text-amber-400">{p.entries - p.entries_reporting} of {p.entries} entries have no value for this nutrient, so today's total may be higher than shown. A low recorded intake is not a diagnosis of deficiency.</p>
      )}
      {contrib?.top?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Biggest sources today</p>
          <ul className="mt-1 space-y-0.5">{contrib.top.map((c) => <li key={c.description} className="flex justify-between gap-3 text-xs"><span className="truncate">{c.description}</span><span className="stat-num shrink-0 text-slate-500 dark:text-slate-400">{fmt(c.amount)} {info?.unit} · {Math.round(c.share_pct)}%</span></li>)}</ul>
        </div>
      )}
      {rich?.foods?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Foods rich in {info?.name?.toLowerCase()} (per 100 g)</p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{rich.foods.map((f) => `${f.name.split(",").slice(0, 2).join(",")} (${fmt(f.amount_per_100g)})`).join(" · ")}</p>
        </div>
      )}
    </div>
  );
}

export function NutrientsTab({ day }) {
  const { meta, byKey } = useNutrientMeta();
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  const all = useMemo(() => {
    const prog = day.progress || {};
    return (meta?.nutrients || []).map((n) => {
      const group = n.group === "energy" ? "macro" : n.group;
      const p = prog[n.key];
      return { ...n, group, p, intake: p ? p.intake : day.totals[n.key], reporting: p ? p.entries_reporting : day.reported[n.key] || 0 };
    });
  }, [meta, day]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k, , test]) => [k, all.filter(test).length])), [all]);

  if (day.entries === 0) {
    return <Card className="p-8 text-center text-sm text-slate-500 dark:text-slate-400" data-testid="nutrients-empty">Log some food for this day to see its vitamins, minerals and other nutrients here.</Card>;
  }
  const test = FILTERS.find(([k]) => k === filter)[2];
  const term = q.trim().toLowerCase();
  const rows = {};
  all.filter((n) => test(n) && (!term || n.name.toLowerCase().includes(term))).forEach((n) => { (rows[n.group] = rows[n.group] || []).push(n); });
  const shown = Object.values(rows).flat().length;

  return (
    <div className="space-y-6" data-testid="nutrients-tab">
      <UpperLevelBanner items={day.upper_exceeded} byKey={byKey} />
      <Card className="p-4 text-sm text-slate-600 dark:text-slate-300 sm:p-5">
        <p><strong className="font-semibold">Reading this page.</strong> Bars show your recorded intake against the reference for your profile. "No data" means none of today's foods reported that nutrient, which is not the same as zero. The dots show how many of today's {day.entries} entries had a value.</p>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a nutrient" aria-label="Find a nutrient" className="h-10 pl-9" data-testid="nutrient-search" />
        </div>
        <div role="group" aria-label="Show" className="inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} data-testid={`nutrient-filter-${k}`}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500", filter === k ? "bg-white shadow-sm dark:bg-slate-700" : "text-slate-600 dark:text-slate-400")}>
              {label} <span className="stat-num text-xs text-slate-600 dark:text-slate-300">{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>

      {shown === 0 && <Card className="p-6 text-center text-sm text-slate-500 dark:text-slate-400" data-testid="nutrients-none">{term ? `No nutrient matches "${q}".` : filter === "attention" ? "Nothing is below its reference with the data logged so far." : "Nothing to show for this filter."}</Card>}
      {GROUP_ORDER.filter((g) => rows[g]).map((g) => (
        <Card key={g} className="overflow-hidden">
          <h3 className="border-b border-border px-4 py-3 font-semibold sm:px-5">{GROUP_TITLE[g]}</h3>
          <div className="divide-y divide-border">
            {rows[g].map((n) => {
              const p = n.p;
              const status = p ? p.status : n.intake == null ? "no_data" : null;
              // energy is a reference, not a goal: say "above/below the reference", never "reached"
              const statusLabel = n.key === "energy_kcal" && (status === "met" || status === "below") ? (status === "met" ? "At or above reference" : "Below reference") : STATUS_LABEL[status];
              const pct = p && p.percent != null ? Math.min(p.percent, 100) : 0;
              const isOpen = open === n.key;
              return (
                <div key={n.key} data-testid={`nutrient-${n.key}`}>
                  <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : n.key)}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none dark:hover:bg-slate-800/40 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_auto] sm:px-5">
                    <span className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium">{n.name}</span><Coverage reporting={n.reporting} entries={day.entries} /></span>
                    <span className="stat-num text-right text-sm sm:order-3">
                      {n.intake == null ? <span className="text-slate-500 dark:text-slate-400">no data</span> : <>{fmt(n.intake)} <span className="text-xs text-slate-500 dark:text-slate-400">{n.unit}</span></>}
                      <ChevronDown className={cn("ml-2 inline h-4 w-4 text-slate-500 dark:text-slate-400 motion-safe:transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                    </span>
                    <span className="col-span-2 sm:col-span-1 sm:order-2">
                      {p ? (
                        <>
                          <span className="block h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-label={`${n.name} against reference`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                            <span className={cn("block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500", BAR[status])} style={{ width: `${pct}%` }} />
                          </span>
                          <span className="mt-1 flex justify-between text-xs"><span className={TONE[status]}>{statusLabel}{p.percent != null && status !== "no_data" ? ` · ${Math.round(p.percent)}%` : ""}</span>
                            <span className="text-slate-500 dark:text-slate-400">{p.min != null && p.max != null ? `${fmt(p.min)}–${fmt(p.max)} ${n.unit}` : p.target != null ? `target ${fmt(p.target)} ${n.unit}` : p.max != null ? `limit ${fmt(p.max)} ${n.unit}` : ""}</span></span>
                        </>
                      ) : <span className="text-xs text-slate-500 dark:text-slate-400">No reference value</span>}
                    </span>
                  </button>
                  {isOpen && <Details k={n.key} day={day} info={byKey[n.key]} p={p} />}
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
