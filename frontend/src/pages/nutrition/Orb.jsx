import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Play } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { MACRO_COLORS, STATUS_LABEL, fmt } from "./shared";
import { dayEvents, totalsUntil } from "./timeline";
import { cn } from "@/lib/utils";

// The day as nested rings: energy outside, then protein, carbs and fat, with what is left of the day's energy in the middle. Each ring draws itself when the
// page opens (and again when the numbers change); "Replay the day" plays the day's entries back in the order they were eaten. Hovering, focusing or tapping a ring
// puts that nutrient in the middle (name, value, target, status) and dims the rest, so nothing needs a floating label. The figure in the middle is sized from the
// width of the orb (container units) and from how many digits it has, so it always sits inside the innermost ring.
const EXPO = [0.16, 1, 0.3, 1];
export const RINGS = [
  { key: "energy", r: 148, w: 12, color: "hsl(var(--primary))", name: "Energy", unit: "kcal" },
  { key: "protein_g", r: 130, w: 10, color: MACRO_COLORS.protein_g, name: "Protein", unit: "g" },
  { key: "carbs_available_g", r: 114, w: 10, color: MACRO_COLORS.carbs_available_g, name: "Carbohydrate", unit: "g" },
  { key: "fat_g", r: 98, w: 10, color: MACRO_COLORS.fat_g, name: "Fat", unit: "g" },
];
const frac = (v, t) => (t > 0 ? Math.max(0, Math.min(1, v / t)) : 0);
const figSize = (len) => (len <= 4 ? 17 : len === 5 ? 15 : len === 6 ? 12.5 : 10.5);   // cqw: the figure's size as a share of the orb's width

export function useReplay(day) {
  const reduce = useReducedMotion();
  const [state, setState] = useState(null);        // null, or { h, totals }: the day played back up to hour h
  const raf = useRef(0);
  const events = dayEvents(day);
  const stop = () => { cancelAnimationFrame(raf.current); setState(null); };
  const play = (slow = false) => {
    cancelAnimationFrame(raf.current);
    if (!events.length) return;
    const from = Math.min(6, events[0].h - 0.5), to = events[events.length - 1].h + 0.6;
    const dur = (reduce ? 500 : 4600) * (slow ? 4 : 1);
    const t0 = performance.now();
    const step = (now) => {
      const f = Math.min(1, (now - t0) / dur);
      const h = from + f * (to - from);
      setState({ h, totals: totalsUntil(events, h) });
      if (f < 1) raf.current = requestAnimationFrame(step); else setTimeout(() => setState(null), 900);
    };
    raf.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return { state, play, stop, has: events.length > 0 };
}

/**
 * `active` is the ring being looked at (hover, focus or a pinned tap, decided by the panel so the chips under the orb light up with it); `onHover(key|null)`
 * reports the pointer or keyboard focus, `onPin(key)` a click or tap.
 */
export function NutritionOrb({ day, loading = false, active = null, onHover, onPin }) {
  const { animations } = useSettings();
  const reduce = useReducedMotion() || animations === false;
  const replay = useReplay(day);
  const [slow, setSlow] = useState(false);
  const prog = day.progress || {};
  const target = day.energy_target || 0;
  const total = replay.state ? replay.state.totals.kcal : day.totals?.energy_kcal || 0;
  const macro = (k) => {
    const p = prog[k] || {};
    const t = p.target ?? p.max ?? 0;
    const v = replay.state ? { protein_g: replay.state.totals.p, carbs_available_g: replay.state.totals.c, fat_g: replay.state.totals.f }[k] : p.intake || 0;
    return { v, t, p };
  };
  const left = target ? target - total : null;
  const label = loading ? "kcal left today" : left == null ? "kcal today" : replay.state ? "eaten so far" : left >= 0 ? "kcal left today" : "kcal over today";
  const big = loading ? "0000" : left == null || replay.state ? fmt(total) : fmt(Math.abs(left));
  const ring = (k) => (k === "energy" ? { v: total, t: target, p: null } : macro(k));
  const values = Object.fromEntries(RINGS.map((g) => [g.key, frac(ring(g.key).v, ring(g.key).t)]));
  const summary = `${RINGS.map((g) => `${g.name} ${Math.round(values[g.key] * 100)} percent`).join(", ")}.`;
  const shown = loading || replay.state ? null : RINGS.find((g) => g.key === active) || null;

  // what the middle says about the ring being looked at
  const read = shown && (() => {
    const { v, t, p } = ring(shown.key);
    const pct = t > 0 ? Math.round((v / t) * 100) : null;
    const status = shown.key === "energy" ? (t > 0 ? (v >= t ? "At or above target" : "Below target") : "") : p?.status === "no_data" ? STATUS_LABEL.no_data : STATUS_LABEL[p?.status] || "";
    return { value: fmt(v), unit: shown.unit, of: t > 0 ? `of ${fmt(t)} ${shown.unit}${pct != null ? ` · ${pct}%` : ""}` : "no target set", status };
  })();
  const ringLabel = (g) => { const { v, t, p } = ring(g.key); const pct = t > 0 ? Math.round((v / t) * 100) : null; return `${g.name}: ${fmt(v)} ${g.unit}${t > 0 ? ` of ${fmt(t)}, ${pct} percent` : ", no target set"}${p?.status && STATUS_LABEL[p.status] ? `, ${STATUS_LABEL[p.status]}` : ""}`; };
  const swap = reduce ? { duration: 0 } : { duration: 0.18, ease: EXPO };
  const fig = shown ? read.value : big;

  return (
    <div data-testid="orb" className="relative">
      <div className="relative mx-auto aspect-square w-[min(100%,max(11rem,calc(100svh_-_25rem)),19.5rem)] [container-type:inline-size]" role="group" aria-label="Energy and macronutrient rings">
        <p className="sr-only">{loading ? "Loading" : `${big} ${label}. ${summary}`}</p>
        <svg viewBox="0 0 320 320" className="h-full w-full overflow-visible" onClick={(e) => { if (e.target === e.currentTarget) onPin?.(null); }}>
          {RINGS.map((g, i) => {
            const on = shown?.key === g.key;
            return (
              <g key={g.key} transform="rotate(-90 160 160)" className={cn("outline-none transition-opacity duration-300", shown && !on && "opacity-30")}
                {...(loading ? { "aria-hidden": "true" } : {
                  role: "button", tabIndex: 0, "aria-label": ringLabel(g), "aria-pressed": active === g.key,
                  onPointerEnter: (e) => { if (e.pointerType === "mouse") onHover?.(g.key); }, onPointerLeave: (e) => { if (e.pointerType === "mouse") onHover?.(null); },
                  onClick: () => onPin?.(g.key),
                  onFocus: (e) => { if (e.target.matches?.(":focus-visible")) onHover?.(g.key); }, onBlur: () => onHover?.(null),
                  onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPin?.(g.key); } },
                })}>
                <circle cx="160" cy="160" r={g.r} fill="none" stroke="var(--line)" strokeWidth={g.w} />
                <motion.circle cx="160" cy="160" r={g.r} fill="none" stroke={g.color} strokeLinecap="round"
                  initial={reduce || replay.state ? false : { pathLength: 0, strokeWidth: g.w }} animate={{ pathLength: loading ? 0 : values[g.key], strokeWidth: g.w + (on ? 3 : 0) }}
                  transition={reduce || replay.state ? { duration: 0 } : { pathLength: { duration: 1.5, ease: EXPO, delay: 0.12 * i }, strokeWidth: { duration: 0.2, ease: EXPO } }} />
                <circle cx="160" cy="160" r={g.r} fill="none" stroke="transparent" strokeWidth={g.w + 8} pointerEvents={loading ? "none" : "stroke"} className="cursor-pointer" />
              </g>
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={shown ? shown.key : "rest"} initial={{ opacity: 0, y: reduce ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={swap}
              className="w-[56cqw] text-center" aria-hidden="true" data-testid={shown ? "orb-readout" : undefined}>
              {shown && <p className="text-[length:max(0.6875rem,4.2cqw)] font-medium leading-tight text-muted-foreground">{shown.name}</p>}
              <p className="stat-num font-semibold leading-none tracking-[-0.045em]" style={{ fontSize: `${figSize(fig.length)}cqw`, marginTop: shown ? "0.15em" : 0 }} data-testid={shown ? undefined : "energy-left"}>
                {loading ? <span className="sk-ph">{big}</span> : <>{fig}{shown && <span className="ml-[0.12em] text-[0.34em] font-medium tracking-normal text-muted-foreground">{read.unit}</span>}</>}
              </p>
              {shown ? (
                <>
                  <p className="mt-[0.5em] text-[length:max(0.6875rem,3.9cqw)] leading-snug text-muted-foreground">{read.of}</p>
                  {read.status && <p className="text-[length:max(0.6875rem,3.9cqw)] font-medium leading-snug">{read.status}</p>}
                </>
              ) : (
                <>
                  <p className="mt-[0.5em] text-[length:max(0.6875rem,4.2cqw)] leading-tight text-muted-foreground">{label}</p>
                  {target > 0 && !replay.state && <p className="mt-0.5 text-[length:max(0.625rem,3.6cqw)] leading-tight text-muted-foreground">{loading ? <span className="sk-ph">of 0000 kcal</span> : `of ${fmt(target)} kcal`}</p>}
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
      {replay.has && !loading && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <button type="button" onClick={() => (replay.state ? replay.stop() : replay.play(slow))} data-testid="replay-day"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong bg-field px-3.5 text-xs font-semibold transition-[background-color,transform] duration-200 hover:bg-hover active:scale-95">
            <Play className="h-3.5 w-3.5" aria-hidden="true" />{replay.state ? "Stop" : "Replay the day"}
          </button>
          <button type="button" aria-pressed={slow} onClick={() => setSlow((s) => !s)} aria-label="¼× slow motion"
            className={cn("inline-flex h-9 items-center rounded-full border px-3 text-xs font-semibold transition-colors duration-200", slow ? "border-transparent pill-fill" : "border-line-strong bg-field hover:bg-hover")}>¼×</button>
        </div>
      )}
    </div>
  );
}

/** The three macro figures under the orb. Hovering or tapping one lights its ring (and the other way round). */
export function MacroChips({ day, loading = false, active = null, onHover, onPin }) {
  const prog = day.progress || {};
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="macro-chips">
      {[["protein_g", "protein"], ["carbs_available_g", "carbs"], ["fat_g", "fat"]].map(([k, name]) => {
        const p = prog[k] || {};
        const t = p.target ?? p.max;
        const on = active === k;
        return (
          <button key={k} type="button" data-testid={`chip-${k}`} aria-pressed={on} disabled={loading}
            onPointerEnter={(e) => { if (e.pointerType === "mouse") onHover?.(k); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") onHover?.(null); }}
            onFocus={(e) => { if (e.target.matches?.(":focus-visible")) onHover?.(k); }} onBlur={() => onHover?.(null)} onClick={() => onPin?.(k)}
            className={cn("min-w-0 rounded-2xl border bg-field px-3 py-2.5 text-left outline-none transition-[border-color,background-color,transform] duration-200 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:pointer-events-none", on ? "border-line-strong bg-hover" : "border-line")}>
            <span className="flex items-center gap-1.5 text-[11.5px] leading-none text-muted-foreground">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: MACRO_COLORS[k] }} />{name}
            </span>
            <span className="stat-num mt-1.5 block text-lg font-semibold leading-tight">{loading ? <span className="sk-ph">000</span> : p.status === "no_data" ? "–" : <>{fmt(p.intake || 0)}<span className="ml-0.5 text-xs font-normal text-muted-foreground">g</span></>}</span>
            <span className="block text-[11.5px] leading-snug text-muted-foreground">{loading ? <span className="sk-ph">of 000 g</span> : t ? `of ${fmt(t)} g` : "no target"}</span>
          </button>
        );
      })}
    </div>
  );
}
