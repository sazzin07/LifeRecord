import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { eur } from "@/lib/api";
import { cn } from "@/lib/utils";

const show = (b) => (b == null ? "" : String(b));

/**
 * Budget input for a shopping list.
 *   empty  -> no budget (placeholder says so)
 *   0      -> stays 0; we suggest a budget based on what is on the list
 *   > 0    -> progress, remaining / over budget
 * The value is saved when you finish editing (blur or Enter), never per keystroke, and the field is plain
 * text so a trackpad scroll over it cannot nudge the number.
 */
export function BudgetField({ summary, listId, onCommit }) {
  const unknown = !summary; // not loaded for this list yet: avoid flashing "No budget"
  const budget = summary?.budget ?? null;
  const estimated = summary?.estimated_total ?? 0;
  const [text, setText] = useState(show(budget));
  const focused = useRef(false);

  // Follow the server (list switch, AI change, refresh) unless the user is typing.
  useEffect(() => { if (!focused.current) setText(show(budget)); }, [budget, listId]);

  const commit = (raw) => {
    const cleaned = raw.trim().replace(",", ".");
    if (cleaned === "") {
      if (budget !== null) onCommit(null);
      return;
    }
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) { setText(show(budget)); return; }
    const rounded = Math.round(n * 100) / 100;
    setText(String(rounded));
    if (rounded !== budget) onCommit(rounded);
  };

  const suggested = Math.max(1, Math.ceil(estimated));
  const remaining = summary?.remaining ?? 0;
  const over = remaining < 0;
  const pct = budget > 0 ? Math.min(100, Math.round((estimated / budget) * 100)) : 0;

  if (unknown) return <div className="space-y-3" aria-busy="true"><div className="skeleton h-10 rounded-xl" /><div className="skeleton h-4 w-2/3" /></div>;

  return (
    <div className="space-y-3">
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">€</span>
        <Input
          type="text"
          inputMode="decimal"
          aria-label="List budget"
          placeholder="No budget"
          className="pl-7"
          value={text}
          onFocus={() => { focused.current = true; }}
          onChange={(e) => { if (/^[0-9]*[.,]?[0-9]{0,2}$/.test(e.target.value)) setText(e.target.value); }}
          onBlur={(e) => { focused.current = false; commit(e.target.value); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setText(show(budget)); e.currentTarget.blur(); } }}
        />
      </div>

      <div className="flex justify-between text-xs">
        <span className="text-slate-500">Estimated total</span>
        <span className={cn("font-medium", over ? "text-red-500" : "text-slate-700 dark:text-slate-200")}>{eur(estimated)}</span>
      </div>

      {budget === null && <p className="text-xs text-slate-500">No limit set. Type an amount to track spending.</p>}

      {budget === 0 && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-accent/60 px-3 py-2 text-xs">
          <span>Recommended budget: <strong>{eur(suggested)}</strong></span>
          {estimated > 0 && <Button type="button" size="sm" variant="outline" className="h-7 rounded-full px-3 text-xs" onClick={() => { setText(String(suggested)); onCommit(suggested); }}>Use it</Button>}
        </div>
      )}

      {budget > 0 && (
        <>
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Budget used">
            <div className={cn("h-full rounded-full transition-all duration-500", over ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
          </div>
          <p className={cn("text-xs", over ? "font-medium text-red-500" : "text-slate-500")}>
            {over ? `${eur(Math.abs(remaining))} over budget` : `${eur(remaining)} remaining of ${eur(budget)}`}
          </p>
        </>
      )}
    </div>
  );
}
