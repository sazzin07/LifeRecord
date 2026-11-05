import { useMemo, useState } from "react";
import { Busy, Sk, SkChart } from "@/components/skeletons";
import { ChevronDown, Download, FileText } from "lucide-react";
import { Card } from "@/components/common";
import { InfoTip } from "@/components/InfoTip";
import { Button } from "@/components/ui/button";
import { useFetch } from "@/lib/useFetch";
import { cn } from "@/lib/utils";
import { NutrientTable } from "./NutrientTable";
import { PatternsView } from "./PatternsView";
import { WeekBars } from "./WeekBars";
import { WeeklySummary } from "./WeeklySummary";
import { STATUS_LABEL, fmt, prettyDate, useNutrientMeta } from "./shared";

const RANGES = [[7, "7 days"], [30, "30 days"], [90, "90 days"], [180, "6 months"], [365, "1 year"]];
const VIEWS = [["overview", "Averages"], ["patterns", "Patterns and variety"], ["density", "Nutrient density"]];
// long ranges are shown as weekly or monthly averages (of the logged days), so the chart stays readable and fast
const bucketFor = (days) => (days > 180 ? "month" : days > 90 ? "week" : "day");
const KEYS = ["energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugars_g", "sat_fat_g", "sodium_mg"];

function Stat({ label, value, unit, note }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="stat-num mt-1 text-2xl font-semibold leading-tight">{value}<span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span></p>
      {note && <p className="mt-0.5 truncate text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

const Pills = ({ label, value, set, items, test }) => (
  <div role="group" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-full border border-line bg-field p-1 scrollbar-hide">
    {items.map(([k, text]) => (
      <button key={k} type="button" aria-pressed={value === k} onClick={() => set(k)} data-testid={`${test}-${k}`}
        className={cn("shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", value === k ? "pill-fill" : "text-muted-foreground hover:text-foreground")}>{text}</button>
    ))}
  </div>
);

export function TrendsTab({ date, today, energyTarget, onLog }) {
  const [days, setDays] = useState(7);
  const [view, setView] = useState("overview");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [allValues, setAllValues] = useState(false);
  const bucket = bucketFor(days);
  const { data: t } = useFetch(`/nutrition/trends?days=${days}&end=${date}${bucket !== "day" ? `&bucket=${bucket}` : ""}`);
  const { meta, byKey } = useNutrientMeta();
  const series = useMemo(() => (t?.series || []).map((d) => ({ ...d, label: bucket === "month" ? d.date.slice(0, 7) : d.date.slice(5), kcal: d.logged ? Math.round(d.energy_kcal || 0) : null })), [t, bucket]);
  const items = useMemo(() => (meta?.nutrients || []).map((n) => {
    const p = t?.progress?.[n.key];
    return { ...n, group: n.group === "energy" ? "macro" : n.group, p, intake: p ? p.intake : null };
  }), [meta, t]);

  const download = () => {
    const head = ["date", ...(bucket !== "day" ? ["end", "days_logged"] : []), "logged", "entries", ...KEYS, "drinks_ml"];
    const rows = t.series.map((d) => head.map((k) => (d[k] == null ? "" : typeof d[k] === "number" ? Math.round(d[k] * 100) / 100 : d[k])).join(","));
    const blob = new Blob([[head.join(","), ...rows].join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `nutrition-${t.start}-to-${t.end}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  if (!t) return <Card className="p-5"><Busy label="Loading your trends"><Sk className="mb-4 h-5 w-44" /><SkChart height={240} /></Busy></Card>;
  const avg = t.daily_average;
  const empty = t.days_logged === 0;
  const listed = Object.values(t.progress).filter((p) => p.status !== "no_data");
  return (
    <div className="space-y-6" data-testid="trends-tab">
      <Pills label="What to show" value={view} set={setView} items={VIEWS} test="view" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Pills label="Time range" value={days} set={setDays} items={RANGES} test="range" />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="rounded-full" disabled={empty} onClick={() => setSummaryOpen(true)} data-testid="trends-summary"><FileText className="mr-1.5 h-4 w-4" />Summary</Button>
          <Button variant="outline" size="sm" className="rounded-full" disabled={empty} onClick={download} data-testid="trends-download"><Download className="mr-1.5 h-4 w-4" />Download CSV</Button>
        </div>
      </div>
      <WeeklySummary open={summaryOpen} onOpenChange={setSummaryOpen} t={t} today={today} energyTarget={energyTarget} />
      <p className="-mt-3 flex items-center gap-1 text-sm text-muted-foreground" data-testid="trends-period">{prettyDate(t.start, today)} to {prettyDate(t.end, today)}<InfoTip label="About the averages">{t.note}</InfoTip></p>

      {view !== "overview" ? (
        <PatternsView view={view} days={days} date={date} onLog={onLog} />
      ) : empty ? (
        <Card className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">Nothing is logged in this period yet. Once you log a few days, averages and patterns appear here.</Card>
      ) : (
        <>
          <Card className="grid grid-cols-2 gap-x-6 gap-y-5 px-5 py-4 lg:grid-cols-4">
            <Stat label="Days logged" value={t.days_logged} unit={`of ${t.days}`} />
            <Stat label="Average energy" value={fmt(avg.energy_kcal)} unit="kcal" note={energyTarget ? `reference ${fmt(energyTarget)}` : null} />
            <Stat label="Average protein" value={fmt(avg.protein_g)} unit="g" note={avg.protein_g == null ? null : `${t.days_reporting.protein_g} of ${t.days_logged} days had data`} />
            <Stat label="Average fibre" value={fmt(avg.fiber_g)} unit="g" note={avg.fiber_g == null ? "no fibre data logged" : `${t.days_reporting.fiber_g} of ${t.days_logged} days had data`} />
          </Card>
          <Card className="p-4 sm:p-5">
            <WeekBars series={series} target={energyTarget} bucket={bucket} average={avg.energy_kcal} loggedDays={t.days_logged} />
            <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">Days with nothing logged are left empty<InfoTip label="About the chart">{bucket === "day" ? "Days" : `${bucket[0].toUpperCase()}${bucket.slice(1)}s`} with nothing logged are shown as a dot, not drawn as zero.{bucket !== "day" ? ` Each bar is the average of the days you logged in that ${bucket}.` : ""}</InfoTip></p>
          </Card>
          <Card className="p-4 sm:p-5" data-testid="average-day">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-semibold">The average day against your references</h3>
              <InfoTip label="About the average day" align="end">A nutrient is averaged over the logged days that reported it. Low averages can reflect missing data, and are not a diagnosis.</InfoTip>
            </div>
            <NutrientTable items={items} testid="average-table" idle="Hover or tap a nutrient to read its average" />
            <button type="button" aria-expanded={allValues} onClick={() => setAllValues((v) => !v)} data-testid="trends-all-values"
              className="mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none transition-colors duration-200 hover:bg-field hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              All values<ChevronDown className={cn("h-4 w-4 motion-safe:transition-transform", allValues && "rotate-180")} aria-hidden="true" />
            </button>
            {allValues && (
              <div className="mt-2 divide-y divide-line rounded-2xl border border-line">
                {listed.map((p) => (
                  <div key={p.key} className="flex items-center gap-3 px-4 py-2.5 text-sm" data-testid={`trend-${p.key}`}>
                    <span className="min-w-0 flex-1 truncate">{byKey[p.key]?.name || p.key}</span>
                    <span className="stat-num shrink-0">{fmt(p.intake)} <span className="text-xs text-muted-foreground">{p.unit}</span></span>
                    <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">{p.percent != null ? `${Math.round(p.percent)}% ` : ""}{STATUS_LABEL[p.status]}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
