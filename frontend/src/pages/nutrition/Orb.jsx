import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Play } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { MACRO_COLORS, fmt } from "./shared";
import { dayEvents, totalsUntil } from "./timeline";
import { cn } from "@/lib/utils";

// The day as nested rings: energy outside, then protein, carbs and fat, with what is left of the day's energy in the middle. Each ring draws itself when the
// page opens (and again when the numbers change); "Replay the day" plays the day's entries back in the order they were eaten.
const EXPO = [0.16, 1, 0.3, 1];
const RINGS = [
  { key: "energy", r: 146, w: 16, color: "hsl(var(--primary))" },
  { key: "protein_g", r: 118, w: 12, color: MACRO_COLORS.protein_g },
  { key: "carbs_available_g", r: 96, w: 12, color: MACRO_COLORS.carbs_available_g },
  { key: "fat_g", r: 74, w: 12, color: MACRO_COLORS.fat_g },
];
const frac = (v, t) => (t > 0 ? Math.max(0, Math.min(1, v / t)) : 0);

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

export function NutritionOrb({ day, loading = false }) {
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
    return { v, t };
  };
  const left = target ? target - total : null;
  const label = loading ? "kcal left today" : left == null ? "kcal today" : replay.state ? "eaten so far" : left >= 0 ? "kcal left today" : "kcal over today";
  const big = loading ? "0000" : left == null || replay.state ? fmt(total) : fmt(Math.abs(left));
  const values = { energy: frac(total, target), protein_g: frac(macro("protein_g").v, macro("protein_g").t), carbs_available_g: frac(macro("carbs_available_g").v, macro("carbs_available_g").t), fat_g: frac(macro("fat_g").v, macro("fat_g").t) };
  const names = { energy: "Energy", protein_g: "Protein", carbs_available_g: "Carbohydrate", fat_g: "Fat" };
  const summary = `${names.energy} ${Math.round(values.energy * 100)} percent of target. ${["protein_g", "carbs_available_g", "fat_g"].map((k) => `${names[k]} ${Math.round(values[k] * 100)} percent`).join(", ")}.`;
  return (
    <div data-testid="orb" className="relative">
      <div className="relative mx-auto aspect-square w-full max-w-[19.5rem]" role="img" aria-label={`${big} ${label}. ${loading ? "" : summary}`}>
        <svg viewBox="0 0 320 320" className="h-full w-full overflow-visible" aria-hidden="true">
          {RINGS.map((g, i) => (
            <g key={g.key} transform="rotate(-90 160 160)">
              <circle cx="160" cy="160" r={g.r} fill="none" stroke="var(--line)" strokeWidth={g.w} />
              <motion.circle cx="160" cy="160" r={g.r} fill="none" stroke={g.color} strokeWidth={g.w} strokeLinecap="round"
                initial={reduce || replay.state ? false : { pathLength: 0 }} animate={{ pathLength: loading ? 0 : values[g.key] }}
                transition={reduce || replay.state ? { duration: 0 } : { duration: 1.5, ease: EXPO, delay: 0.12 * i }} />
            </g>
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-content-center text-center">
          <p className="stat-num text-[3.4rem] font-semibold leading-none tracking-[-0.045em] sm:text-[3.6rem]" data-testid="energy-left">{loading ? <span className="sk-ph">{big}</span> : big}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{label}</p>
          {target > 0 && !replay.state && <p className="mt-0.5 text-xs text-muted-foreground">{loading ? <span className="sk-ph">of 0000 kcal</span> : `of ${fmt(target)} kcal`}</p>}
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

/** The three macro figures under the orb. */
export function MacroChips({ day, loading = false }) {
  const prog = day.progress || {};
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="macro-chips">
      {[["protein_g", "protein"], ["carbs_available_g", "carbs"], ["fat_g", "fat"]].map(([k, name]) => {
        const p = prog[k] || {};
        const t = p.target ?? p.max;
        return (
          <div key={k} className="rounded-2xl border border-line bg-field px-3 py-2.5" data-testid={`chip-${k}`}>
            <span aria-hidden="true" className="mb-1.5 block h-2 w-2 rounded-full" style={{ background: MACRO_COLORS[k] }} />
            <p className="stat-num text-lg font-semibold leading-tight">{loading ? <span className="sk-ph">000</span> : p.status === "no_data" ? "–" : fmt(p.intake || 0)}</p>
            <p className="text-[11.5px] leading-snug text-muted-foreground">{loading ? <span className="sk-ph">of 000 g protein</span> : `${t ? `of ${fmt(t)} g ` : ""}${name}`}</p>
          </div>
        );
      })}
    </div>
  );
}
