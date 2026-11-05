import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useSettings } from "@/context/SettingsContext";
import { STATUS_LABEL } from "./shared";
import { cn } from "@/lib/utils";

// Every nutrient as one cell, filled to its share of the reference, so the whole day's picture reads at a glance. The colour says the status (and the caption
// names it in words); a cell with no data is dashed and empty. Choosing a cell hands the nutrient to the list below.
const ABBR = { "Saturated fat": "Sat fat", Sodium: "Na", Potassium: "K", "Vitamin C": "C", "Vitamin D": "D", "Vitamin B12": "B12", "Vitamin B6": "B6", "Vitamin A": "A", "Vitamin E": "E", "Vitamin K": "K", Thiamin: "B1", Riboflavin: "B2", Niacin: "B3", Iron: "Fe", Calcium: "Ca", Magnesium: "Mg", Zinc: "Zn", Iodine: "I", Selenium: "Se", Copper: "Cu", Manganese: "Mn", Phosphorus: "P", Protein: "Prot", Fibre: "Fibre", Fiber: "Fibre", Sugars: "Sugar", Energy: "kcal" };
const abbr = (name) => ABBR[name] || (name.length <= 6 ? name : name.slice(0, 5));
const tone = (n) => {
  if (!n.p || n.p.status === "no_data" || n.p.percent == null) return "none";
  if (n.p.status === "over" || n.p.status === "above") return "bad";
  if (n.p.status === "below") return "warn";
  return "good";
};
const COLOR = { good: "#22c55e", warn: "#f59e0b", bad: "#ef4444", none: "transparent" };   // meaning colours (gain, below, over): the fill is a tint, the caption and aria-label say it in words

export function Constellation({ items, onPick }) {
  const { animations } = useSettings();
  const reduce = useReducedMotion() || animations === false;
  const [ready, setReady] = useState(reduce);
  const [focus, setFocus] = useState(null);
  useEffect(() => { if (reduce) { setReady(true); return undefined; } const t = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(t); }, [reduce]);
  const sorted = [...items].sort((a, b) => (a.p?.percent ?? 999) - (b.p?.percent ?? 999));
  const lowest = sorted.filter((n) => tone(n) === "warn" || tone(n) === "bad").slice(0, 3).map((n) => n.name);
  const shown = focus || null;
  return (
    <section aria-label="All nutrients at a glance" data-testid="constellation" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[1.0625rem] font-semibold">All nutrients at a glance</h3>
        <p className="min-h-[1.25rem] text-xs text-muted-foreground" aria-live="polite" data-testid="constellation-caption">
          {shown ? `${shown.name}: ${shown.p?.percent != null ? `${Math.round(shown.p.percent)}% of the reference` : "no data"}${shown.p?.status ? ` · ${STATUS_LABEL[shown.p.status] || shown.p.status}` : ""}`
            : lowest.length ? `Furthest from the reference: ${lowest.join(", ")}` : "Filled to each nutrient's share of its reference"}
        </p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-2">
        {items.map((n, i) => {
          const t = tone(n);
          const pct = Math.max(0, Math.min(100, n.p?.percent ?? 0));
          return (
            <button key={n.key} type="button" onClick={() => onPick(n)} onMouseEnter={() => setFocus(n)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(n)} onBlur={() => setFocus(null)}
              className={cn("relative aspect-square overflow-hidden rounded-2xl border bg-field text-left outline-none transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring active:scale-95",
                t === "none" ? "border-dashed border-line-strong" : "border-line")}>
              <span aria-hidden="true" className="absolute inset-x-0 bottom-0 opacity-40"
                style={{ height: ready ? `${pct}%` : "0%", background: COLOR[t], transition: reduce ? "none" : `height 1.1s cubic-bezier(0.16,1,0.3,1) ${Math.min(i, 24) * 22}ms` }} />
              <span className="relative flex h-full flex-col items-center justify-center gap-0.5 px-1">
                <span className="text-[0.8125rem] font-bold leading-tight">{abbr(n.name)}</span>
                <span className="stat-num text-[0.6875rem] text-muted-foreground">{n.p?.percent != null ? Math.round(n.p.percent) : "–"}</span>
                <span className="sr-only">{`${n.name}: ${n.p?.percent != null ? `${Math.round(n.p.percent)} percent, ${STATUS_LABEL[n.p.status] || n.p.status}` : "no data"}. Show details`}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
