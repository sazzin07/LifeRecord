import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KINDS, TIME_PRESETS, WEEKDAYS, WEEKDAYS_LONG, clockOf, dayOf, defaultSchedule, errorText, timezoneList } from "@/components/ai/scheduled/scheduleUtils";
import { cn } from "@/lib/utils";

export function Field({ label, hint, children, htmlFor }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export const inputClass = "h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20";

/** Live check of the schedule against the server, so the user sees the real upcoming times before saving. */
export function NextRuns({ schedule, timezone, onValidity }) {
  const [state, setState] = useState({ loading: true, error: null, next: [], text: "" });
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(async () => {
      try {
        const { data } = await api.post("/scheduled/schedule-preview", { schedule, timezone });
        if (!cancelled) { setState({ loading: false, error: null, next: data.next, text: data.text }); onValidity?.(true); }
      } catch (e) {
        if (!cancelled) { setState({ loading: false, error: errorText(e), next: [], text: "" }); onValidity?.(false); }
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [schedule, timezone, onValidity]);

  if (state.error) return <p role="alert" data-testid="schedule-error" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">{state.error}</p>;
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3" aria-live="polite" data-testid="schedule-preview">
      <p className={cn("text-sm font-medium", state.loading && "opacity-60")}>{state.text || "Checking…"}</p>
      {state.next.length > 0 && (
        <ol className="mt-2 space-y-1">
          {state.next.map((iso) => (
            <li key={iso} className="flex items-baseline gap-3 text-xs text-muted-foreground">
              <span className="w-24 shrink-0">{dayOf(iso, timezone)}</span>
              <span className="lm-money text-foreground">{clockOf(iso, timezone)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ScheduleFields({ schedule, onChange, timezone, onTimezone }) {
  const zones = useMemo(timezoneList, []);
  const set = (patch) => onChange({ ...schedule, ...patch });
  const kind = schedule.kind;
  const toggleDay = (d) => {
    const days = new Set(schedule.weekdays || []);
    if (days.has(d)) days.delete(d); else days.add(d);
    set({ weekdays: [...days].sort() });
  };

  return (
    <div className="space-y-4">
      <Field label="Repeats">
        <Select value={kind} onValueChange={(k) => { const next = defaultSchedule(k); onChange(next.time && schedule.time ? { ...next, time: schedule.time } : next); }}>
          <SelectTrigger aria-label="How often" data-testid="schedule-kind"><SelectValue /></SelectTrigger>
          <SelectContent>{KINDS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
      </Field>

      {kind === "weekly" && (
        <Field label="On">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Weekdays">
            {WEEKDAYS.map((d, i) => {
              const on = (schedule.weekdays || []).includes(i);
              return (
                <button key={d} type="button" role="checkbox" aria-checked={on} aria-label={WEEKDAYS_LONG[i]} onClick={() => toggleDay(i)} data-testid={`weekday-${i}`}
                  className={cn("h-9 min-w-[3rem] rounded-xl border px-2.5 text-sm font-medium transition-colors",
                    on ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-background hover:border-emerald-500/60")}>{d}</button>
              );
            })}
          </div>
        </Field>
      )}

      {kind === "monthly" && (
        <Field label="On day" hint="Months without that day run on their last day.">
          <Select value={String(schedule.day_of_month || 1)} onValueChange={(v) => set({ day_of_month: Number(v) })}>
            <SelectTrigger aria-label="Day of the month"><SelectValue /></SelectTrigger>
            <SelectContent className="max-h-64">{Array.from({ length: 31 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)}>{i + 1}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
      )}

      {kind === "once" && (
        <Field label="Date">
          <DatePicker aria-label="Date" value={schedule.date || ""} onChange={(v) => set({ date: v })} clearable={false}
            presets={[{ label: "Tomorrow", days: 1 }, { label: "In a week", days: 7 }]} />
        </Field>
      )}

      {kind === "interval" ? (
        <Field label="Every" hint="At most once an hour.">
          <div className="flex gap-2">
            <input type="number" min={1} max={999} value={schedule.every ?? ""} aria-label="Repeat every" data-testid="interval-every"
              onChange={(e) => set({ every: e.target.value === "" ? "" : Number(e.target.value) })} className={cn(inputClass, "w-24")} />
            <Select value={schedule.unit || "hours"} onValueChange={(v) => set({ unit: v })}>
              <SelectTrigger aria-label="Unit"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="hours">hours</SelectItem><SelectItem value="days">days</SelectItem></SelectContent>
            </Select>
          </div>
        </Field>
      ) : (
        <Field label="At" htmlFor="sched-time">
          <input id="sched-time" value={schedule.time || ""} inputMode="numeric" placeholder="09:00" maxLength={5} data-testid="schedule-time"
            onChange={(e) => set({ time: e.target.value.replace(/[^0-9:]/g, "") })} className={cn(inputClass, "w-28 font-mono")} />
          <div className="flex flex-wrap gap-1.5 pt-1.5">
            {TIME_PRESETS.map((t) => (
              <button key={t} type="button" onClick={() => set({ time: t })}
                className={cn("rounded-lg border px-2 py-1 font-mono text-xs transition-colors", schedule.time === t ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200" : "border-border hover:border-emerald-500/60")}>{t}</button>
            ))}
          </div>
        </Field>
      )}

      <Field label="Timezone" hint="Times follow this timezone all year, including when the clocks change.">
        <Select value={timezone} onValueChange={onTimezone}>
          <SelectTrigger aria-label="Timezone" data-testid="schedule-timezone"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">{zones.map((z) => <SelectItem key={z} value={z}>{z.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
    </div>
  );
}
