import { useMemo, useState } from "react";
import { Download, FileText } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useFetch } from "@/lib/useFetch";
import { cn } from "@/lib/utils";
import { PatternsView } from "./PatternsView";
import { WeeklySummary } from "./WeeklySummary";
import { STATUS_LABEL, fmt, prettyDate, useNutrientMeta } from "./shared";

const RANGES = [[7, "7 days"], [30, "30 days"], [90, "90 days"], [180, "6 months"], [365, "1 year"]];
const VIEWS = [["overview", "Averages"], ["patterns", "Patterns and variety"], ["density", "Nutrient density"]];
// long ranges are shown as weekly or monthly averages (of the logged days), so the chart stays readable and fast
const bucketFor = (days) => (days > 180 ? "month" : days > 90 ? "week" : "day");
const UNIT = { day: "day", week: "week", month: "month" };
const KEYS = ["energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugars_g", "sat_fat_g", "sodium_mg"];

function Stat({ label, value, unit, note }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="stat-num mt-1 text-2xl font-semibold">{value}<span className="ml-1 text-sm font-normal text-slate-500 dark:text-slate-400">{unit}</span></p>
      {note && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{note}</p>}
    </Card>
  );
}

export function TrendsTab({ date, today, energyTarget }) {
  const [days, setDays] = useState(7);
  const [view, setView] = useState("overview");
  const [summaryOpen, setSummaryOpen] = useState(false);
  const bucket = bucketFor(days);
  const { data: t } = useFetch(`/nutrition/trends?days=${days}&end=${date}${bucket !== "day" ? `&bucket=${bucket}` : ""}`);
  const { byKey } = useNutrientMeta();
  const series = useMemo(() => (t?.series || []).map((d) => ({ ...d, label: bucket === "month" ? d.date.slice(0, 7) : d.date.slice(5), kcal: d.logged ? Math.round(d.energy_kcal || 0) : null })), [t, bucket]);

  const download = () => {
    const head = ["date", ...(bucket !== "day" ? ["end", "days_logged"] : []), "logged", "entries", ...KEYS, "drinks_ml"];
    const rows = t.series.map((d) => head.map((k) => (d[k] == null ? "" : typeof d[k] === "number" ? Math.round(d[k] * 100) / 100 : d[k])).join(","));
    const blob = new Blob([[head.join(","), ...rows].join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `nutrition-${t.start}-to-${t.end}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  if (!t) return <div className="skeleton h-72 rounded-2xl" aria-busy="true" />;
  const avg = t.daily_average;
  const empty = t.days_logged === 0;
  return (
    <div className="space-y-6" data-testid="trends-tab">
      <div role="group" aria-label="What to show" className="inline-flex max-w-full overflow-x-auto rounded-xl bg-slate-100 p-1 scrollbar-hide dark:bg-slate-800">
        {VIEWS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)} data-testid={`view-${k}`}
            className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500", view === k ? "bg-white shadow-sm dark:bg-slate-700" : "text-slate-600 dark:text-slate-400")}>{label}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Time range" className="inline-flex max-w-full overflow-x-auto rounded-xl bg-slate-100 p-1 scrollbar-hide dark:bg-slate-800">
          {RANGES.map(([n, label]) => (
            <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)} data-testid={`range-${n}`}
              className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500", days === n ? "bg-white shadow-sm dark:bg-slate-700" : "text-slate-600 dark:text-slate-400")}>{label}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={empty} onClick={() => setSummaryOpen(true)} data-testid="trends-summary"><FileText className="mr-1.5 h-4 w-4" />Summary</Button>
          <Button variant="outline" size="sm" disabled={empty} onClick={download} data-testid="trends-download"><Download className="mr-1.5 h-4 w-4" />Download CSV</Button>
        </div>
      </div>
      <WeeklySummary open={summaryOpen} onOpenChange={setSummaryOpen} t={t} today={today} energyTarget={energyTarget} />
      <p className="text-sm text-slate-500 dark:text-slate-400">{prettyDate(t.start, today)} to {prettyDate(t.end, today)}. {t.note}</p>

      {view !== "overview" ? (
        <PatternsView view={view} days={days} date={date} />
      ) : empty ? (
        <Card className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">Nothing is logged in this period yet. Once you log a few days, averages and patterns appear here.</Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Days logged" value={t.days_logged} unit={`of ${t.days}`} />
            <Stat label="Average energy" value={fmt(avg.energy_kcal)} unit="kcal" note={energyTarget ? `reference ${fmt(energyTarget)} kcal` : null} />
            <Stat label="Average protein" value={fmt(avg.protein_g)} unit="g" note={avg.protein_g == null ? null : `${t.days_reporting.protein_g} of ${t.days_logged} days had data`} />
            <Stat label="Average fibre" value={fmt(avg.fiber_g)} unit="g" note={avg.fiber_g == null ? "no fibre data logged" : `${t.days_reporting.fiber_g} of ${t.days_logged} days had data`} />
          </div>
          <Card className="p-4 sm:p-5">
            <h3 className="font-semibold">{bucket === "day" ? "Energy per day" : `Average energy per ${UNIT[bucket]}`}</h3>
            <div className="mt-3 h-64" role="img" aria-label={`Bar chart of ${bucket === "day" ? "daily" : `${UNIT[bucket]}ly average`} energy for the last ${days} days. Average ${fmt(avg.energy_kcal)} kilocalories on ${t.days_logged} logged days.`}>
              <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 256 }}>
                <BarChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" className="text-slate-200 dark:text-slate-700" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={Math.max(0, Math.ceil(series.length / 8) - 1)} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: "rgba(148,163,184,0.12)" }} formatter={(v) => [`${v} kcal`, "Energy"]} labelFormatter={(l) => `${bucket === "day" ? "Day" : bucket === "week" ? "Week of" : "Month"} ${l}`} />
                  {energyTarget ? <ReferenceLine y={energyTarget} stroke="#10B981" strokeDasharray="4 4" label={{ value: "reference", fontSize: 11, fill: "#10B981", position: "insideTopRight" }} /> : null}
                  <Bar dataKey="kcal" fill="#10B981" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{bucket === "day" ? "Days" : `${UNIT[bucket][0].toUpperCase()}${UNIT[bucket].slice(1)}s`} with nothing logged are left empty, not drawn as zero.{bucket !== "day" ? ` Each bar is the average of the days you logged in that ${UNIT[bucket]}.` : ""}</p>
          </Card>
          <Card className="overflow-hidden">
            <h3 className="border-b border-border px-4 py-3 font-semibold sm:px-5">Average day against your references</h3>
            <div className="divide-y divide-border">
              {Object.values(t.progress).filter((p) => p.status !== "no_data").map((p) => (
                <div key={p.key} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5" data-testid={`trend-${p.key}`}>
                  <span className="min-w-0 flex-1 truncate">{byKey[p.key]?.name || p.key}</span>
                  <span className="stat-num shrink-0">{fmt(p.intake)} <span className="text-xs text-slate-500 dark:text-slate-400">{p.unit}</span></span>
                  <span className="w-24 shrink-0 text-right text-xs text-slate-500 dark:text-slate-400">{p.percent != null ? `${Math.round(p.percent)}%` : ""} {STATUS_LABEL[p.status]}</span>
                </div>
              ))}
            </div>
            <p className="px-5 pb-4 pt-2 text-xs text-slate-500 dark:text-slate-400">A nutrient is averaged over the logged days that reported it. Low averages can reflect missing data, and are not a diagnosis.</p>
          </Card>
        </>
      )}
    </div>
  );
}
