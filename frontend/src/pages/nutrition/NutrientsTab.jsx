import { useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { ChevronDown, Search } from "lucide-react";
import { Card } from "@/components/common";
import { InfoTip } from "@/components/InfoTip";
import { Input } from "@/components/ui/input";
import { useFetch } from "@/lib/useFetch";
import { cn } from "@/lib/utils";
import { NutrientTable } from "./NutrientTable";
import { Coverage, SRC_LABEL, STATUS_LABEL, UpperLevelBanner, fmt, upperLevelText, useNutrientMeta } from "./shared";

const GROUP_ORDER = ["macro", "fat", "vitamin", "mineral", "other"];
const GROUP_TITLE = { macro: "Macronutrients", fat: "Fats", vitamin: "Vitamins", mineral: "Minerals", other: "Other" };
const TONE = {
  met: "text-green-700 dark:text-green-400", within: "text-green-700 dark:text-green-400", under: "text-green-700 dark:text-green-400",
  below: "text-slate-500 dark:text-slate-400", above: "text-amber-700 dark:text-amber-400", over: "text-amber-700 dark:text-amber-400", no_data: "text-slate-500 dark:text-slate-400",
};
const BAR = { met: "bg-green-500", within: "bg-green-500", under: "bg-green-500", below: "bg-slate-400", above: "bg-amber-500", over: "bg-amber-500", no_data: "bg-slate-300" };

// What each filter keeps. "Below reference" means there is data and it is under the target, never "no data".
const FILTERS = [
  ["all", "All", () => true],
  ["attention", "Below reference", (n) => !!n.p && n.p.status === "below" && n.p.percent != null && n.p.percent < 100],
  ["limits", "Limits", (n) => !!n.p && n.p.kind === "limit"],
  ["nodata", "No data", (n) => n.intake == null || n.p?.status === "no_data"],
];

const KIND_WORDS = { limit: "guideline limit", RI: "reference intake range", PRI: "population reference intake", AI: "adequate intake" };

function Details({ k, day, info, p }) {
  const { data: contrib } = useFetch(`/nutrition/contributors?nutrient=${k}&start=${day.date}&end=${day.date}&limit=4`);
  const { data: rich } = useFetch(`/nutrition/rich-in?nutrient=${k}&limit=5`);
  const partial = p && p.entries > 0 && p.status !== "no_data" && p.percent != null && p.percent < 60 && !p.complete;
  const upper = upperLevelText(p?.upper, info?.unit);
  return (
    <div className="space-y-3 border-t border-line bg-field/50 px-4 py-4 text-sm sm:px-5">
      {(info?.about || p?.kind) && (
        <p className="text-muted-foreground">{info?.about}
          {(p?.kind || p?.note) && (
            <InfoTip label={`About the ${info?.name || "nutrient"} reference`} className="ml-1 -my-1">
              {p.kind && <span className="block">Reference: {KIND_WORDS[p.kind] || p.kind} ({SRC_LABEL[p.source] || p.source}){p.overridden ? ". You set your own target." : ""}.</span>}
              {p.note && <span className="mt-1 block">{p.note}</span>}
              <span className="mt-1 block">A low recorded intake is not a diagnosis of deficiency.</span>
            </InfoTip>
          )}
        </p>
      )}
      {partial && <p className="text-xs text-amber-700 dark:text-amber-400">Only {p.entries_reporting} of {p.entries} entries report this, so the total may be higher.</p>}
      {upper && <p className="text-xs text-muted-foreground" data-testid={`upper-${k}`}>{upper}. {p.upper.comparable ? (p.upper.over ? "Today's total is above it." : "") : "Not compared with what you log."}</p>}
      {contrib?.top?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Biggest sources today</p>
          <ul className="mt-1 space-y-0.5">{contrib.top.map((c) => <li key={c.description} className="flex justify-between gap-3 text-xs"><span className="truncate">{c.description}</span><span className="stat-num shrink-0 text-muted-foreground">{fmt(c.amount)} {info?.unit} · {Math.round(c.share_pct)}%</span></li>)}</ul>
        </div>
      )}
      {rich?.foods?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Rich in {info?.name?.toLowerCase()} (per 100 g)</p>
          <p className="mt-1 text-xs">{rich.foods.map((f) => `${f.name.split(",").slice(0, 2).join(",")} (${fmt(f.amount_per_100g)})`).join(" · ")}</p>
        </div>
      )}
    </div>
  );
}

export function NutrientsTab({ day }) {
  const { meta, byKey } = useNutrientMeta();
  const reduce = useReducedMotion();
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
  const keep = (n) => test(n) && (!term || n.name.toLowerCase().includes(term));
  const rows = {};
  all.filter(keep).forEach((n) => { (rows[n.group] = rows[n.group] || []).push(n); });
  const shown = Object.values(rows).flat().length;
  const lowest = [...all].filter((n) => n.p && n.p.status === "below" && n.p.percent != null).sort((a, b) => a.p.percent - b.p.percent).slice(0, 3).map((n) => n.name);
  // choosing a tile opens that nutrient's row and brings it into view
  const pick = (n) => {
    setFilter("all"); setQ(""); setOpen(n.key);
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector(`[data-testid="nutrient-${n.key}"]`)?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" })));
  };

  return (
    <div className="space-y-6" data-testid="nutrients-tab">
      <UpperLevelBanner items={day.upper_exceeded} byKey={byKey} />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a nutrient" aria-label="Find a nutrient" className="h-10 pl-9" data-testid="nutrient-search" />
        </div>
        <div role="group" aria-label="Show" className="inline-flex flex-wrap gap-1 rounded-full border border-line bg-field p-1">
          {FILTERS.map(([k, label]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} data-testid={`nutrient-filter-${k}`}
              className={cn("rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", filter === k ? "pill-fill" : "text-muted-foreground hover:text-foreground")}>
              {label} <span className="stat-num text-xs opacity-80">{counts[k]}</span>
            </button>
          ))}
        </div>
        <InfoTip label="How to read the nutrients" className="ml-auto" align="end">
          Each tile fills to the share of its reference for this day. "No data" means none of today's {day.entries} {day.entries === 1 ? "entry" : "entries"} reported that nutrient, which is not the same as zero. A small amber count on a row shows how many entries reported a value.
        </InfoTip>
      </div>

      <NutrientTable items={all} onPick={pick} match={keep} idle={lowest.length ? `Furthest from the reference: ${lowest.join(", ")}` : undefined} />

      {shown === 0 && <Card className="p-6 text-center text-sm text-slate-500 dark:text-slate-400" data-testid="nutrients-none">{term ? `No nutrient matches "${q}".` : filter === "attention" ? "Nothing is below its reference with the data logged so far." : "Nothing to show for this filter."}</Card>}
      {GROUP_ORDER.filter((g) => rows[g]).map((g) => (
        <Card key={g} className="overflow-hidden">
          <h3 className="border-b border-line px-4 py-3 font-semibold sm:px-5">{GROUP_TITLE[g]}</h3>
          <div className="divide-y divide-line">
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
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 px-4 py-3 text-left transition-colors duration-200 hover:bg-hover focus-visible:bg-hover focus-visible:outline-none sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.5fr)_auto] sm:px-5">
                    <span className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium">{n.name}</span><Coverage reporting={n.reporting} entries={day.entries} /></span>
                    <span className="stat-num text-right text-sm sm:order-3">
                      {n.intake == null ? <span className="text-muted-foreground">no data</span> : <>{fmt(n.intake)} <span className="text-xs text-muted-foreground">{n.unit}</span></>}
                      <ChevronDown className={cn("ml-2 inline h-4 w-4 text-muted-foreground motion-safe:transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                    </span>
                    <span className="col-span-2 sm:col-span-1 sm:order-2">
                      {p ? (
                        <>
                          <span className="block h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label={`${n.name} against reference`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
                            <span className={cn("block h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500", BAR[status])} style={{ width: `${pct}%` }} />
                          </span>
                          <span className="mt-1 flex justify-between text-xs"><span className={TONE[status]}>{statusLabel}{p.percent != null && status !== "no_data" ? ` · ${Math.round(p.percent)}%` : ""}</span>
                            <span className="text-muted-foreground">{p.min != null && p.max != null ? `${fmt(p.min)}–${fmt(p.max)} ${n.unit}` : p.target != null ? `target ${fmt(p.target)} ${n.unit}` : p.max != null ? `limit ${fmt(p.max)} ${n.unit}` : ""}</span></span>
                        </>
                      ) : <span className="text-xs text-muted-foreground">No reference value</span>}
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
