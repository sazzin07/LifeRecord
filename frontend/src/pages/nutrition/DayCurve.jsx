import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useSettings } from "@/context/SettingsContext";
import { fmt } from "./shared";
import { cumulativeKnots, dayEvents } from "./timeline";

// The day as a line: how much energy has been eaten by each hour, against the pace that would reach the target by evening. Meals are the dots; the pointer
// (or a finger) scrubs along it. Drawn from the diary entries only, so it needs no data the page does not already have.
const FROM = 6, TO = 22, EXPO = [0.16, 1, 0.3, 1];

function smooth(p) {
  let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 0; i < p.length - 1; i += 1) {
    const [x0, y0] = p[i], [x1, y1] = p[i + 1], cx = (x0 + x1) / 2;
    d += `C${cx.toFixed(1)} ${y0.toFixed(1)} ${cx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d;
}
const clock = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}`;

export function DayCurve({ day, isToday, loading = false }) {
  const { animations } = useSettings();
  const reduce = useReducedMotion() || animations === false;
  const wrap = useRef(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState(null);
  useEffect(() => {
    if (!wrap.current || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const H = 190, padX = 12, padTop = 14, padBottom = 28;
  const target = day.energy_target || 2000;
  const events = loading ? [] : dayEvents(day);
  const nowH = isToday ? (() => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; })() : null;
  const top = Math.max(target * 1.08, (day.totals?.energy_kcal || 0) * 1.08, 500);
  const X = (h) => padX + ((h - FROM) / (TO - FROM)) * (w - padX * 2);
  const Y = (v) => H - padBottom - (v / top) * (H - padTop - padBottom);
  const knots = cumulativeKnots(events, FROM, TO, nowH != null ? Math.min(Math.max(nowH, FROM), TO) : null).map(([h, v]) => [X(h), Y(v)]);
  const line = smooth(knots);
  const lastY = knots[knots.length - 1][1];
  const dots = [];
  let run = 0;
  events.forEach((e) => { run += e.kcal; dots.push({ x: X(Math.min(TO, e.h + 0.45)), y: Y(run), h: e.h, v: run }); });
  const at = (clientX) => {
    const r = wrap.current.getBoundingClientRect();
    const h = FROM + ((clientX - r.left - padX) / (w - padX * 2)) * (TO - FROM);
    const hh = Math.min(TO, Math.max(FROM, h));
    const v = events.filter((e) => e.h <= hh).reduce((s, e) => s + e.kcal, 0);
    setHover({ h: hh, v });
  };
  const pace = nowH != null && nowH > FROM ? target * Math.min(1, (nowH - FROM) / 15) : null;
  const total = day.totals?.energy_kcal || 0;
  const status = loading ? "" : pace == null ? "" : total >= pace ? `${fmt(total - pace)} kcal ahead of an even pace` : `${fmt(pace - total)} kcal behind an even pace`;
  return (
    <section data-testid="day-curve" aria-label="Energy through the day" className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[1.0625rem] font-semibold">Through the day</h3>
        <p className="text-xs text-muted-foreground" aria-live="polite">{loading ? <span className="sk-ph">000 kcal ahead of an even pace</span> : hover ? `${clock(hover.h)} · ${fmt(hover.v)} kcal so far` : status}</p>
      </div>
      <div ref={wrap} className="relative mt-3 touch-pan-y select-none" style={{ height: H }}
        onPointerMove={(e) => !loading && at(e.clientX)} onPointerLeave={() => setHover(null)}>
        <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block overflow-visible" role="img"
          aria-label={loading ? "Loading" : events.length ? `${events.length} entries, ${fmt(total)} of ${fmt(target)} kilocalories` : "Nothing logged yet"}>
          <defs>
            <linearGradient id="dc-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--chart-line)" stopOpacity="0.34" /><stop offset="1" stopColor="var(--chart-line)" stopOpacity="0" /></linearGradient>
          </defs>
          {[6, 9, 12, 15, 18, 21].map((h) => (
            <g key={h}><line x1={X(h)} x2={X(h)} y1={padTop} y2={H - padBottom} stroke="var(--chart-grid)" /><text x={X(h)} y={H - 8} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">{String(h).padStart(2, "0")}:00</text></g>
          ))}
          <line x1={X(FROM)} y1={Y(0)} x2={X(21)} y2={Y(target)} stroke="hsl(var(--muted-foreground))" strokeOpacity="0.7" strokeDasharray="4 6" />
          <g pointerEvents="none"><line x1={padX + 4} x2={padX + 26} y1={padTop + 6} y2={padTop + 6} stroke="hsl(var(--muted-foreground))" strokeOpacity="0.7" strokeDasharray="4 6" /><text x={padX + 32} y={padTop + 10} fontSize="11" fill="hsl(var(--muted-foreground))">even pace to {fmt(target)}</text></g>
          {events.length > 0 && (
            <>
              <path d={`${line} L${knots[knots.length - 1][0]} ${H - padBottom} L${knots[0][0]} ${H - padBottom}Z`} fill="url(#dc-fill)" />
              <motion.path d={line} fill="none" stroke="var(--chart-line)" strokeWidth="2.5" strokeLinecap="round" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={reduce ? { duration: 0 } : { duration: 1.6, ease: EXPO }} />
              {dots.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r="4.5" fill="var(--tip-bg)" stroke="var(--chart-line)" strokeWidth="2.5" />)}
              {nowH != null && <><line x1={X(Math.min(Math.max(nowH, FROM), TO))} x2={X(Math.min(Math.max(nowH, FROM), TO))} y1={padTop} y2={H - padBottom} stroke="hsl(var(--foreground))" strokeWidth="1.2" /><circle cx={knots[knots.length - 1][0]} cy={lastY} r="6" fill="var(--chart-line)" stroke="var(--tip-bg)" strokeWidth="3" /></>}
            </>
          )}
          {hover && <g pointerEvents="none"><line x1={X(hover.h)} x2={X(hover.h)} y1={padTop} y2={H - padBottom} stroke="var(--line-strong)" strokeDasharray="3 5" /><circle cx={X(hover.h)} cy={Y(hover.v)} r="6" fill="var(--tip-bg)" stroke="var(--chart-line)" strokeWidth="3" /></g>}
        </svg>
        {!loading && !events.length && <p className="pointer-events-none absolute inset-x-0 top-[38%] text-center text-sm text-muted-foreground">The line starts with the first thing you log.</p>}
      </div>
    </section>
  );
}

