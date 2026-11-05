import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { fmt, refreshNutrition } from "./shared";
import { cn } from "@/lib/utils";

/** The water row under the orb: each glass is 250 ml, filled by what has been drunk (drinks and the water in food count, as in the reference). One tap on the next
 *  glass adds 250 ml. The full list of drinks, with editing, stays in the Hydration card. */
const GLASS = 250;

export function QuickWater({ day, date, loading = false }) {
  const h = day.hydration || { total_ml: 0, target_ml: 2500 };
  const count = Math.max(4, Math.min(12, Math.ceil((h.target_ml || 2000) / GLASS)));
  const filled = Math.floor((h.total_ml || 0) / GLASS);
  const add = async () => {
    try { await api.post("/nutrition/water", { amount_ml: GLASS, beverage: "water", date }); refreshNutrition(); }
    catch (err) { toast.error(errorMessage(err, "Could not add water")); }
  };
  return (
    <div className="flex items-center gap-3 text-sm" data-testid="quick-water">
      <span className="shrink-0 text-muted-foreground">Water</span>
      <div className="flex min-w-0 flex-1 gap-1" role="group" aria-label={`Water: ${fmt((h.total_ml || 0) / 1000, 2)} litres`}>
        {Array.from({ length: count }, (_, i) => {
          const on = i < filled;
          const next = i === filled;
          return (
            <button key={i} type="button" disabled={loading || !next} onClick={add} aria-label={next ? "Add a glass, 250 millilitres" : on ? "A glass drunk" : "A glass to come"}
              className={cn("relative h-7 flex-1 overflow-hidden rounded-b-[0.7rem] rounded-t-md border outline-none transition-[background-color,transform] duration-300 focus-visible:ring-2 focus-visible:ring-ring",
                on ? "border-transparent bg-sky-500" : "border-line-strong bg-field", next && "hover:-translate-y-0.5 hover:bg-hover active:scale-95")} />
          );
        })}
      </div>
      <span className="stat-num shrink-0 text-xs text-muted-foreground">{loading ? <span className="sk-ph">0.0 L</span> : `${fmt((h.total_ml || 0) / 1000, 1)} L`}</span>
    </div>
  );
}
