import { useEffect, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { InfoTip } from "@/components/InfoTip";
import { Card } from "@/components/common";
import { useFetch } from "@/lib/useFetch";
import { cn } from "@/lib/utils";
import { fmt } from "./shared";

// Nutrient density is its own question: not "what do I eat" (Patterns) but "what does each 1,000 kcal bring, against what the reference asks per 1,000 kcal". The nutrients
// are laid out on one ladder around 100% (gaps on the left of the line, strengths on the right) and any rung opens into where it came from in this period and which
// whole foods are rich in it. Nutrients that most of the period's energy never reported are kept apart instead of being judged.
const pct = (x) => `${Math.round(x * 100)}%`;
const tone = (r) => (r >= 1 ? "bg-green-500" : r >= 0.7 ? "bg-slate-400" : "bg-amber-500");

function Sources({ r, start, end, onLog }) {
  const { data: contrib, loading: loadingC } = useFetch(`/nutrition/contributors?nutrient=${r.nutrient}&start=${start}&end=${end}&limit=5`);
  const { data: rich, loading: loadingR } = useFetch(`/nutrition/rich-in?nutrient=${r.nutrient}&limit=5`);
  return (
    <div className="grid gap-5 border-t border-line bg-field/50 px-4 py-4 text-sm sm:grid-cols-2 sm:px-5" data-testid={`density-detail-${r.nutrient}`}>
      <div>
        <p className="text-xs font-medium text-muted-foreground">Where it came from in this period</p>
        {loadingC && !contrib ? <p className="mt-2 text-xs text-muted-foreground">Loading</p> : contrib?.top?.length ? (
          <ul className="mt-2 space-y-2">
            {contrib.top.map((c) => (
              <li key={c.description}>
                <div className="flex justify-between gap-3 text-xs"><span className="truncate">{c.description}</span><span className="stat-num shrink-0 text-muted-foreground">{fmt(c.amount)} {r.unit}{c.share_pct != null ? ` · ${Math.round(c.share_pct)}%` : ""}</span></div>
                <span aria-hidden="true" className="mt-1 block h-1 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, c.share_pct || 0)}%` }} /></span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-xs text-muted-foreground">No entry in this period reports {r.name.toLowerCase()}.</p>}
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">Whole foods rich in it (per 100 g)</p>
        {loadingR && !rich ? <p className="mt-2 text-xs text-muted-foreground">Loading</p> : rich?.foods?.length ? (
          <ul className="mt-2 space-y-1">
            {rich.foods.map((f) => (
              <li key={f.food_id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">{f.name.split(",").slice(0, 2).join(",")} <span className="stat-num text-muted-foreground">{fmt(f.amount_per_100g)} {r.unit}</span></span>
                {onLog && <button type="button" onClick={() => onLog(f.food_id)} aria-label={`Log ${f.name.split(",")[0]}`} data-testid={`density-log-${f.food_id}`}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-line-strong bg-field px-2.5 font-medium outline-none transition-colors duration-200 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"><Plus className="h-3 w-3" aria-hidden="true" />Log</button>}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-xs text-muted-foreground">No whole food in the data matches your diet choices for this nutrient.</p>}
      </div>
    </div>
  );
}

export function DensityView({ rows, foods, start, end, onLog }) {
  const judged = [...rows.filter((r) => r.reliable)].sort((a, b) => a.ratio - b.ratio);
  const unsure = rows.filter((r) => !r.reliable);
  const [open, setOpen] = useState(null);
  const first = judged[0]?.nutrient || null;
  useEffect(() => { setOpen((cur) => (cur && judged.some((r) => r.nutrient === cur) ? cur : first)); }, [first, judged.length]);  // eslint-disable-line react-hooks/exhaustive-deps

  if (rows.length === 0) return <Card className="p-8 text-center text-sm text-muted-foreground" data-testid="pattern-density">Not enough logged energy to compare yet.</Card>;
  return (
    <div className="space-y-6" data-testid="pattern-density">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 pb-1 pt-4 sm:px-5">
          <h3 className="font-semibold">Per 1,000 kcal against the reference</h3>
          <InfoTip label="How to read nutrient density" align="end">
            Each bar is what 1,000 kcal of what you ate brought, compared with what your reference asks per 1,000 kcal. The centre line is 100%. A low value describes what was recorded, not a deficiency, and entries that do not report a nutrient are left out of its average, not counted as zero.
          </InfoTip>
        </div>
        <div className="grid grid-cols-[minmax(5.5rem,9rem)_1fr_3.75rem] items-center gap-x-3 px-4 pb-1 text-[11px] text-muted-foreground sm:px-5" aria-hidden="true">
          <span />
          <span className="flex justify-between"><span>below</span><span>above</span></span>
          <span />
        </div>
        <ul className="divide-y divide-line">
          {judged.map((r) => {
            const isOpen = open === r.nutrient;
            const span = Math.min(Math.abs(r.ratio - 1), 1) * 50;
            return (
              <li key={r.nutrient} data-testid={`density-${r.nutrient}`}>
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.nutrient)}
                  aria-label={`${r.name}: ${fmt(r.per_1000_kcal)} ${r.unit} per 1,000 kcal, ${Math.round(r.ratio * 100)}% of the reference of ${fmt(r.reference_per_1000_kcal)}`}
                  className="grid w-full grid-cols-[minmax(5.5rem,9rem)_1fr_3.75rem] items-center gap-x-3 px-4 py-2.5 text-left outline-none transition-colors duration-200 hover:bg-hover focus-visible:bg-hover sm:px-5">
                  <span className="truncate text-sm font-medium" aria-hidden="true">{r.name}</span>
                  <span className="relative h-2.5 rounded-full bg-line" aria-hidden="true">
                    <span className={cn("absolute inset-y-0 rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none", tone(r.ratio))} style={r.ratio >= 1 ? { left: "50%", width: `${span}%` } : { right: "50%", width: `${span}%` }} />
                    <span className="absolute inset-y-[-3px] left-1/2 w-px bg-foreground/40" />
                  </span>
                  <span className="stat-num flex items-center justify-end gap-1 text-sm" aria-hidden="true">{Math.round(r.ratio * 100)}%<ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground motion-safe:transition-transform", isOpen && "rotate-180")} /></span>
                </button>
                {isOpen && (
                  <>
                    <p className="stat-num px-4 pb-2 text-xs text-muted-foreground sm:px-5">{fmt(r.per_1000_kcal)} {r.unit} per 1,000 kcal · reference {fmt(r.reference_per_1000_kcal)} · from entries covering {pct(r.coverage)} of your energy</p>
                    <Sources r={r} start={start} end={end} onLog={onLog} />
                  </>
                )}
              </li>
            );
          })}
        </ul>
        {unsure.length > 0 && (
          <div className="border-t border-line px-4 py-3 sm:px-5" data-testid="density-unsure">
            <p className="text-xs font-medium text-muted-foreground">Not enough data to judge</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {unsure.map((r) => <li key={r.nutrient} data-testid={`density-${r.nutrient}`} className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-muted-foreground">{r.name} <span className="stat-num">· {pct(r.coverage)} of energy</span></li>)}
            </ul>
          </div>
        )}
      </Card>

      {foods.length > 0 && (
        <Card className="p-4 sm:p-5" data-testid="dense-foods">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold">Most nutrient-dense foods you ate</h3>
            <InfoTip label="How the index works" align="end">The average, over the nutrients a food reports, of how much it gave per calorie compared with your reference (each capped at 2). Foods reporting fewer than 5 of them are not ranked.</InfoTip>
          </div>
          <ol className="mt-3 space-y-2.5">
            {foods.map((f, i) => (
              <li key={f.name}>
                <div className="flex items-baseline justify-between gap-3 text-sm"><span className="truncate"><span className="stat-num mr-2 text-muted-foreground">{i + 1}</span>{f.name}</span><span className="stat-num shrink-0 text-xs text-muted-foreground">{f.index} · {f.times} ×</span></div>
                <span aria-hidden="true" className="mt-1 block h-1 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.min(100, (f.index / 2) * 100)}%` }} /></span>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}
