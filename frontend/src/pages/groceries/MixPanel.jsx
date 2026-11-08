import { Clock, Dumbbell, Feather, RotateCcw, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { EMPTY_MIX, GOALS, QUICK_MINUTES, WITH, leftIf, leftIfQuick, toggleInclude, toggleQuick } from "./kitchenMix";
import { Sticker, plural } from "./todayParts";

const GOAL_ICON = { protein: Dumbbell, energy: Zap, light: Feather };

/* "Mix your meal": pick what you want most of, then what it has to contain. Every choice combines with the others, each ingredient chip says how
   many recipes would be left if you added it, and one that would leave none is dimmed (and does nothing). */
export function MixPanel({ mix, setMix, base, list }) {
  const quickLabel = `Under ${QUICK_MINUTES} min`;
  const bits = [mix.goal && GOALS.find((g) => g.id === mix.goal).label, ...mix.inc.map((t) => WITH.find((w) => w.id === t).label), mix.quick && quickLabel].filter(Boolean);
  const quickLeft = mix.quick ? list.length : leftIfQuick(base, mix), quickDim = !mix.quick && quickLeft === 0;
  const anyTime = base.some((e) => e.recipe.cook_minutes);
  return (
    <section className="gt-card gt-mix" aria-label="Mix your meal">
      <div className="gt-mix-head">
        <div>
          <h3 className="gt-mix-title"><Sparkles aria-hidden="true" />Mix your meal</h3>
          <p className="gt-note" aria-live="polite">{bits.length ? <><b>{plural(list.length, "recipe", "recipes")}</b> for {bits.join(" + ")}</> : "Pick what you want most of, then what it has to contain. They all combine."}</p>
        </div>
        {bits.length > 0 && <button type="button" className="gt-btn" onClick={() => setMix(EMPTY_MIX)}><RotateCcw aria-hidden="true" />Start over</button>}
      </div>
      <div className="gt-mix-row"><span className="gt-mix-lab">I want</span>
        <div className="gt-mix-chips">{GOALS.map((g) => {
          const Icon = GOAL_ICON[g.id], on = mix.goal === g.id;
          return <button key={g.id} type="button" className={cn("gt-mx", on && "on")} aria-pressed={on} onClick={() => setMix({ ...mix, goal: on ? null : g.id })}><Icon aria-hidden="true" /><span>{g.label}</span></button>;
        })}</div>
      </div>
      <div className="gt-mix-row"><span className="gt-mix-lab">It has</span>
        <div className="gt-mix-chips">{WITH.map((w) => {
          const on = mix.inc.includes(w.id), left = on ? list.length : leftIf(base, mix, w.id), dim = !on && left === 0;
          return (
            <button key={w.id} type="button" className={cn("gt-mx", on && "on", dim && "dim")} aria-pressed={on} aria-disabled={dim || undefined}
              onClick={() => { if (!dim) setMix(toggleInclude(mix, w.id)); }}>
              <Sticker name={w.sticker[0]} category={w.sticker[1]} size={22} /><span>{w.label}</span>{" "}<b>{left}<span className="sr-only"> left</span></b>
            </button>
          );
        })}</div>
      </div>
      <div className="gt-mix-row"><span className="gt-mix-lab">It takes</span>
        <div className="gt-mix-chips"><button type="button" className={cn("gt-mx", mix.quick && "on", quickDim && "dim")} aria-pressed={mix.quick} aria-disabled={quickDim || undefined}
          onClick={() => { if (!quickDim) setMix(toggleQuick(mix)); }}>
          <Clock aria-hidden="true" /><span>{quickLabel}</span>{" "}<b>{quickLeft}<span className="sr-only"> left</span></b>
          {quickDim && <span className="sr-only">{anyTime ? ". None of these recipes is that quick." : ". No recipe has a cooking time yet; add one when you edit a recipe."}</span>}
        </button></div>
      </div>
    </section>
  );
}
