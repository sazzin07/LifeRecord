import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useSettings } from "@/context/SettingsContext";
import { STATUS_LABEL, fmt } from "./shared";
import { cn } from "@/lib/utils";

// Every nutrient as a tile of a small periodic table: vitamins by letter, minerals by their element symbol, the rest by a short code. The tile fills from the
// bottom to its share of the reference, like a vial, and its edge is the colour of its status; a nutrient with no data is dashed and empty. The tiles are grouped
// the way nutrition is (macros, fats, vitamins, minerals, other). The full name, value and progress of the tile under the pointer (or the finger, or the keyboard
// focus) are read out in one line above the table, so nothing floats over the tiles and nothing is cut off.
export const GROUPS = [["macro", "Macros"], ["fat", "Fats"], ["vitamin", "Vitamins"], ["mineral", "Minerals"], ["other", "Other"]];
const SYMBOL = {
  energy: "kcal", protein: "Pro", carbohydrate: "Carb", "available carbohydrate": "Net", fibre: "Fib", fiber: "Fib", "total sugars": "Sug", sugars: "Sug", "total fat": "Fat",
  "saturated fat": "Sat", "monounsaturated fat": "Mono", "polyunsaturated fat": "Poly", "trans fat": "Trans", "linoleic acid (omega-6)": "ω6", "alpha-linolenic acid (omega-3)": "ω3",
  "epa (omega-3)": "EPA", "dha (omega-3)": "DHA", "epa + dha": "E+D", cholesterol: "Chl", choline: "Cho", alcohol: "Alc", "water in food": "H₂O", water: "H₂O",
  "vitamin a": "A", "vitamin c": "C", "vitamin d": "D", "vitamin e": "E", "vitamin k": "K", "thiamin (b1)": "B1", "riboflavin (b2)": "B2", "niacin (b3)": "B3", "pantothenic acid (b5)": "B5",
  "vitamin b6": "B6", "biotin (b7)": "B7", folate: "B9", "vitamin b12": "B12",
  calcium: "Ca", iron: "Fe", magnesium: "Mg", phosphorus: "P", potassium: "K", sodium: "Na", zinc: "Zn", copper: "Cu", manganese: "Mn", selenium: "Se", iodine: "I",
};
export const symbolOf = (name) => SYMBOL[name.toLowerCase()] || name.replace(/\(.*\)/, "").trim().slice(0, 3);
export const toneOf = (p) => {
  if (!p || p.status === "no_data" || p.percent == null) return "none";
  if (p.status === "over" || p.status === "above") return "bad";
  if (p.status === "below") return "warn";
  return "good";
};
const COLOR = { good: "#22c55e", warn: "#f59e0b", bad: "#ef4444", none: "transparent" };   // meaning colours (gain, below, over); the readout says the status in words
const TEXT = { good: "text-green-700 dark:text-green-400", warn: "text-amber-700 dark:text-amber-400", bad: "text-red-700 dark:text-red-400", none: "text-muted-foreground" };
const pctText = (p) => (p >= 1000 ? "999+" : String(Math.round(p)));

/** What the readout says about one nutrient. */
export function describe(n) {
  const p = n.p;
  const t = toneOf(p);
  const reference = !p ? "no reference value" : p.min != null && p.max != null ? `range ${fmt(p.min)}–${fmt(p.max)} ${n.unit}` : p.target != null ? `of ${fmt(p.target)} ${n.unit}` : p.max != null ? `limit ${fmt(p.max)} ${n.unit}` : "no reference value";
  const status = n.key === "energy_kcal" && (p?.status === "met" || p?.status === "below") ? (p.status === "met" ? "At or above reference" : "Below reference") : STATUS_LABEL[p?.status] || "";
  return { tone: t, value: n.intake == null ? "no data" : `${fmt(n.intake)} ${n.unit}`, reference, pct: p?.percent != null ? Math.round(p.percent) : null, status: n.intake == null ? STATUS_LABEL.no_data : status };
}

export function NutrientTable({ items, onPick, match, idle, testid = "nutrient-table", className }) {
  const { animations } = useSettings();
  const reduce = useReducedMotion() || animations === false;
  const [ready, setReady] = useState(reduce);
  const [hover, setHover] = useState(null);
  const [sel, setSel] = useState(null);                  // a tapped tile (touch): shown until another is tapped or the finger goes elsewhere
  const kind = useRef("mouse");
  useEffect(() => { if (reduce) { setReady(true); return undefined; } const t = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(t); }, [reduce]);
  const root = useRef(null);
  useEffect(() => {
    if (!sel) return undefined;
    const away = (e) => { if (!root.current?.contains(e.target)) setSel(null); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [sel]);

  const grouped = useMemo(() => GROUPS.map(([g, title]) => [g, title, items.filter((n) => n.group === g)]).filter(([, , list]) => list.length), [items]);
  const shown = hover || sel;
  const d = shown ? describe(shown) : null;
  let order = 0;
  return (
    <section ref={root} aria-label="Nutrients at a glance" data-testid={testid} className={cn("space-y-4", className)}>
      <div className="rounded-2xl border border-line bg-field px-4 py-2.5" aria-live="polite" data-testid="table-readout">
        {d ? (
          <>
            <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 text-sm">
              <span className="font-semibold">{shown.name}</span>
              <span className="stat-num">{d.value}</span>
              <span className="text-muted-foreground">{d.reference}{d.pct != null ? ` · ${d.pct}%` : ""}</span>
              {d.status && <span className={cn("text-xs font-medium", TEXT[d.tone])}>{d.status}</span>}
              {sel && !hover && onPick && <button type="button" onClick={() => onPick(sel)} className="ml-auto rounded-full px-2 py-0.5 text-xs font-medium text-accent-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring">Details</button>}
            </p>
            <span aria-hidden="true" className="mt-1.5 block h-1 overflow-hidden rounded-full bg-line">
              <span className="block h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none" style={{ width: `${Math.min(100, d.pct ?? 0)}%`, background: COLOR[d.tone] === "transparent" ? "var(--line-strong)" : COLOR[d.tone] }} />
            </span>
          </>
        ) : <p className="text-sm text-muted-foreground">{idle || "Hover or tap a nutrient"}</p>}
      </div>
      <div className="flex flex-wrap gap-x-8 gap-y-5">
        {grouped.map(([g, title, list]) => (
          <div key={g} className="min-w-0 flex-1 basis-[19rem]" data-testid={`table-group-${g}`}>
            <h3 className="mb-2 flex items-baseline gap-2 text-xs font-medium text-muted-foreground">{title}<span className="stat-num font-normal opacity-70">{list.length}</span><span aria-hidden="true" className="h-px flex-1 bg-line" /></h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))] gap-1.5">
              {list.map((n) => {
                const t = toneOf(n.p);
                const pct = Math.max(0, Math.min(100, n.p?.percent ?? 0));
                const dim = match && !match(n);
                const i = order++;
                return (
                  <button key={n.key} type="button" data-testid={`tile-${n.key}`}
                    onPointerDown={(e) => { kind.current = e.pointerType || "mouse"; }}
                    onPointerEnter={(e) => { if (e.pointerType === "mouse") setHover(n); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }}
                    onFocus={() => setHover(n)} onBlur={() => setHover(null)}
                    onClick={() => { if (kind.current === "touch") { if (sel?.key === n.key) onPick?.(n); else setSel(n); } else onPick?.(n); kind.current = "mouse"; }}
                    className={cn("group relative aspect-square overflow-hidden rounded-2xl border bg-field text-center outline-none transition-[transform,border-color,opacity] duration-200 hover:-translate-y-0.5 hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring active:scale-95 motion-reduce:transition-none",
                      t === "none" ? "border-dashed border-line-strong" : "border-line", dim && "opacity-35", sel?.key === n.key && "border-line-strong ring-2 ring-ring/60")}>
                    <span aria-hidden="true" className="absolute inset-x-0 bottom-0 border-t opacity-40"
                      style={{ height: ready ? `${pct}%` : "0%", background: COLOR[t], borderColor: COLOR[t], transition: reduce ? "none" : `height 1.1s cubic-bezier(0.16,1,0.3,1) ${Math.min(i, 30) * 18}ms` }} />
                    <span className="relative flex h-full flex-col items-center justify-center gap-0.5">
                      <span className="text-[0.9375rem] font-bold leading-none">{symbolOf(n.name)}</span>
                      <span className="stat-num text-[0.6875rem] leading-none text-muted-foreground">{n.p?.percent != null ? pctText(n.p.percent) : "–"}</span>
                      <span className="sr-only">{`${n.name}: ${n.p?.percent != null ? `${Math.round(n.p.percent)} percent, ${STATUS_LABEL[n.p.status] || n.p.status}` : "no data"}`}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
