import { useEffect, useRef, useState } from "react";
import { Loader2, MoreHorizontal, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { Card } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QualityBadge, defaultAmount, fmt, logFoodNow, shortName } from "./shared";

/**
 * The fastest way to log food: type a few letters and tap Add, or tap something you eat often to log it again with the
 * amount you used last time. "…" opens the full dialog for a different amount, a recipe or a barcode.
 */
export function QuickAdd({ date, mealType, onMore }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(null);
  const seq = useRef(0);
  const { data: recent } = useFetch("/nutrition/foods/recent?limit=8");

  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults(null); setBusy(false); return undefined; }
    setBusy(true);
    const id = ++seq.current;
    const t = setTimeout(() => {
      api.get("/nutrition/foods/search", { params: { q: term, limit: 8 } })
        .then(({ data }) => { if (id === seq.current) setResults(data); })
        .catch(() => { if (id === seq.current) setResults([]); })
        .finally(() => { if (id === seq.current) setBusy(false); });
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const add = async (food) => {
    setAdding(food.id);
    await logFoodNow(food, { date, mealType });
    setAdding(null);
  };

  return (
    <Card className="p-4 sm:p-5" data-testid="quick-add">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Quick add: type a food, e.g. banana, oats, chicken"
          onKeyDown={(e) => { if (e.key === "Enter" && results?.[0]) { e.preventDefault(); onMore(results[0].id); } if (e.key === "Escape") setQ(""); }}
          aria-label="Quick add food" className="h-11 pl-9" data-testid="quick-add-input" />
        {busy && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" aria-label="Searching" />}
      </div>

      {results ? (
        results.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No food matches "{q}". Try a simpler word, or <button type="button" className="font-medium text-emerald-700 underline dark:text-emerald-400" onClick={() => onMore(undefined, q)}>type it in</button> yourself.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-xl border border-border" aria-label="Quick add results" data-testid="quick-add-results">
            {results.map((f) => {
              const a = defaultAmount(f);
              return (
                <li key={f.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.name}{f.brand ? <span className="font-normal text-slate-500"> · {f.brand}</span> : null}</p>
                    <p className="text-xs text-slate-500"><span className="stat-num">{fmt(f.per100.energy_kcal)} kcal</span> per 100 g · adds {fmt(a.quantity)} {a.unit}{f.flags?.length ? <span className="ml-2 text-amber-600 dark:text-amber-400">{f.flags[0]}</span> : null}</p>
                  </div>
                  <QualityBadge quality={f.quality} className="hidden sm:inline-flex" />
                  <Button type="button" size="sm" className="h-8 bg-emerald-600 text-white hover:bg-emerald-700" disabled={adding === f.id} onClick={() => add(f)} aria-label={`Add ${shortName(f.name)}`} data-testid={`quick-add-${f.id}`}>
                    {adding === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="mr-1 h-4 w-4" />Add</>}
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => onMore(f.id)} aria-label={`Choose the amount of ${shortName(f.name)}`}><MoreHorizontal className="h-4 w-4" /></Button>
                </li>
              );
            })}
          </ul>
        )
      ) : recent?.length > 0 ? (
        <div className="mt-3" data-testid="quick-add-recent">
          <p className="text-xs font-medium text-slate-500">Again, with the amount you used last time</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {recent.slice(0, 8).map((f) => (
              <button key={f.id} type="button" disabled={adding === f.id} onClick={() => add(f)} title={`${f.name}: ${fmt(f.last_quantity)} ${f.last_unit}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:border-emerald-400 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-60 dark:hover:bg-emerald-500/10">
                <Plus className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />
                <span className="truncate">{shortName(f.name)}</span>
                <span className="shrink-0 text-slate-500">{fmt(f.last_quantity)} {f.last_unit}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-500">Foods you log often appear here as one-tap shortcuts.</p>
      )}
    </Card>
  );
}
