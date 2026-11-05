import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useSettings } from "@/context/SettingsContext";
import { fmt } from "./shared";
import { cn } from "@/lib/utils";

// Energy per day (or the average per week or month for a long range) as bars against the reference line. The pointer, a finger or the arrow keys read one bar in the
// line above the chart; a day with nothing logged is a small dot on the baseline, never a bar of zero. Nothing is written on the bars, so nothing can sit on them.
const H = 200, PAD = { l: 38, r: 8, t: 12, b: 26 };
const nice = (v) => { const s = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000]; return s.find((x) => x >= v) || Math.ceil(v / 1000) * 1000; };
const WORD = { day: "Day", week: "Week of", month: "Month" };

export function WeekBars({ series, target, bucket, average, loggedDays }) {
  const { animations } = useSettings();
  const reduce = useReducedMotion() || animations === false;
  const wrap = useRef(null);
  const [w, setW] = useState(640);
  const [idx, setIdx] = useState(null);
  const [ready, setReady] = useState(reduce);
  useEffect(() => { if (!wrap.current || typeof ResizeObserver === "undefined") return undefined; const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width)))); ro.observe(wrap.current); return () => ro.disconnect(); }, []);
  useEffect(() => { setIdx(null); if (reduce) { setReady(true); return undefined; } setReady(false); const t = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true))); return () => cancelAnimationFrame(t); }, [series, reduce]);
  useEffect(() => {
    if (idx == null) return undefined;
    const away = (e) => { if (!wrap.current?.contains(e.target)) setIdx(null); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [idx]);

  const n = series.length;
  const top = nice(Math.max(target || 0, ...series.map((d) => d.kcal || 0)) * 1.08);
  const iw = w - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const step = iw / Math.max(n, 1);
  const bw = Math.max(3, Math.min(48, step * 0.62));
  const X = (i) => PAD.l + step * (i + 0.5);
  const Y = (v) => PAD.t + ih - (v / top) * ih;
  const ticks = [0, top / 2, top];
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 56))));
  const at = (clientX) => { const r = wrap.current.getBoundingClientRect(); return Math.min(n - 1, Math.max(0, Math.floor((clientX - r.left - PAD.l) / step))); };
  const cur = idx != null ? series[idx] : null;
  const nameOf = (d) => `${WORD[bucket]} ${d.label}`;
  const onKey = (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); setIdx((i) => Math.min(n - 1, Math.max(0, (i == null ? (e.key === "ArrowRight" ? -1 : n) : i) + (e.key === "ArrowRight" ? 1 : -1)))); }
    else if (e.key === "Home") { e.preventDefault(); setIdx(0); } else if (e.key === "End") { e.preventDefault(); setIdx(n - 1); } else if (e.key === "Escape") setIdx(null);
  };
  return (
    <div data-testid="week-bars">
      <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-sm" aria-live="polite">
        <span className="font-semibold">{bucket === "day" ? "Energy per day" : `Average energy per ${bucket}`}</span>
        <span className="text-xs text-muted-foreground" data-testid="week-readout">
          {cur ? (cur.kcal == null ? `${nameOf(cur)} · nothing logged` : `${nameOf(cur)} · ${fmt(cur.kcal)} kcal${target ? ` · ${Math.round((cur.kcal / target) * 100)}% of the reference` : ""}`)
            : `Average ${fmt(average)} kcal over ${loggedDays} logged ${loggedDays === 1 ? "day" : "days"}`}
        </span>
      </p>
      <div ref={wrap} className="relative mt-3 touch-pan-y select-none outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ height: H }} tabIndex={0} role="group"
        aria-label={`Bar chart of ${bucket === "day" ? "daily" : `${bucket}ly average`} energy. Use the left and right arrow keys to read each bar.`} onKeyDown={onKey}
        onPointerMove={(e) => setIdx(at(e.clientX))} onPointerDown={(e) => setIdx(at(e.clientX))} onPointerLeave={(e) => { if (e.pointerType === "mouse") setIdx(null); }}>
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block overflow-visible" aria-hidden="true">
          {ticks.map((t) => (
            <g key={t}><line x1={PAD.l} x2={w - PAD.r} y1={Y(t)} y2={Y(t)} stroke="var(--chart-grid)" strokeDasharray={t === 0 ? undefined : "3 5"} /><text x={PAD.l - 8} y={Y(t) + 4} textAnchor="end" fontSize="11" fill="hsl(var(--muted-foreground))">{fmt(t)}</text></g>
          ))}
          {series.map((d, i) => {
            const on = idx === i;
            const h = d.kcal == null ? 0 : Math.max(2, (d.kcal / top) * ih);
            return (
              <g key={d.date}>
                {on && <rect x={X(i) - step / 2} y={PAD.t} width={step} height={ih} fill="var(--line)" opacity="0.5" rx="6" />}
                {d.kcal == null ? <circle cx={X(i)} cy={Y(0) - 3} r="2" fill="hsl(var(--muted-foreground))" opacity="0.6" /> : (
                  <rect x={X(i) - bw / 2} y={Y(0) - h} width={bw} height={h} rx={Math.min(6, bw / 2)} fill={on ? "var(--chart-line)" : "var(--chart-line-soft)"}
                    style={{ transformBox: "fill-box", transformOrigin: "50% 100%", transform: ready ? "scaleY(1)" : "scaleY(0)", transition: reduce ? "none" : `transform 0.9s cubic-bezier(0.16,1,0.3,1) ${Math.min(i, 24) * 24}ms, fill 0.2s` }} />
                )}
                {i % every === 0 && <text x={X(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">{d.label}</text>}
              </g>
            );
          })}
          {target ? <line x1={PAD.l} x2={w - PAD.r} y1={Y(target)} y2={Y(target)} stroke="var(--chart-line)" strokeWidth="1.5" strokeDasharray="5 5" /> : null}
        </svg>
      </div>
      {target ? <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"><span aria-hidden="true" className={cn("inline-block h-0 w-5 border-t-[1.5px] border-dashed")} style={{ borderColor: "var(--chart-line)" }} />reference {fmt(target)} kcal</p> : null}
    </div>
  );
}
