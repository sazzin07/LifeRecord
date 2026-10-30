import { useCallback, useEffect, useState } from "react";
import { BellRing, Droplets, Utensils, X } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { Card } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { refreshNutrition } from "./shared";

const key = (day) => `lr_nutrition_reminders_dismissed_${day}`;
const readDismissed = (day) => { try { return JSON.parse(localStorage.getItem(key(day)) || "[]"); } catch { return []; } };
const writeDismissed = (day, ids) => { try { localStorage.setItem(key(day), JSON.stringify(ids)); } catch { /* private window: the reminder simply returns on reload */ } };

/**
 * Things the person asked to be nudged about that have not happened yet today. In-app only. "Not now" hides one for the rest of
 * the day on this device (a per-viewer convenience); logging the meal or drinking water makes it disappear for good.
 */
export function ReminderBanner({ onLogMeal }) {
  const { data, reload } = useFetch("/nutrition/reminders/due");
  const [dismissed, setDismissed] = useState([]);
  const day = data?.date;
  useEffect(() => { if (day) setDismissed(readDismissed(day)); }, [day]);
  useEffect(() => {
    const t = setInterval(() => reload({ force: true }), 5 * 60 * 1000); // the clock moves on even if nothing is clicked
    return () => clearInterval(t);
  }, [reload]);
  const hide = useCallback((id) => { const next = [...dismissed, id]; setDismissed(next); writeDismissed(day, next); }, [dismissed, day]);
  const addWater = async () => {
    try { await api.post("/nutrition/water", { amount_ml: 250 }); toast.success("Added 250 ml"); refreshNutrition(); } catch (err) { toast.error(errorMessage(err, "Could not add water")); }
  };
  const due = (data?.due || []).filter((d) => !dismissed.includes(d.id));
  if (!due.length) return null;
  return (
    <Card className="border-amber-200 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-500/10" role="status" data-testid="reminder-banner">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200"><BellRing className="h-4 w-4" aria-hidden="true" />Reminders</div>
      <ul className="mt-2 space-y-2">
        {due.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" data-testid={`reminder-${d.id}`}>
            <span className="min-w-0 flex-1 text-amber-900 dark:text-amber-100">{d.text}</span>
            {d.kind === "meal" && onLogMeal && <Button size="sm" variant="outline" className="h-8" onClick={() => onLogMeal(d.meal_type)}><Utensils className="mr-1.5 h-3.5 w-3.5" />Log {d.meal_type}</Button>}
            {d.kind === "water" && <Button size="sm" variant="outline" className="h-8" onClick={addWater}><Droplets className="mr-1.5 h-3.5 w-3.5" />Add 250 ml</Button>}
            <Button size="sm" variant="ghost" className="h-8" onClick={() => hide(d.id)} aria-label="Not now: hide this reminder until tomorrow"><X className="mr-1 h-3.5 w-3.5" />Not now</Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const MEAL_ROWS = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snack", "Snack"]];

/** Settings for the reminders: which meals, by what time, and a water check. Everything stays inside the app. */
export function RemindersSettings({ timezone }) {
  const { data } = useFetch("/nutrition/reminders");
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setF({ enabled: data.enabled, meals: { ...data.meals }, water_by: data.water_by || "" }); }, [data]);
  if (!f) return <div className="skeleton h-40 rounded-2xl" aria-busy="true" />;
  const setMeal = (m, v) => setF((x) => ({ ...x, meals: v ? { ...x.meals, [m]: v } : Object.fromEntries(Object.entries(x.meals).filter(([k]) => k !== m)) }));
  const save = async () => {
    setSaving(true);
    try { await api.put("/nutrition/reminders", { enabled: f.enabled, meals: f.meals, water_by: f.water_by || null }); toast.success(f.enabled ? "Reminders saved" : "Reminders are off"); refreshNutrition(); }
    catch (err) { toast.error(errorMessage(err, "Could not save reminders")); } finally { setSaving(false); }
  };
  return (
    <Card className="p-5" data-testid="reminders-settings">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">Reminders</h3>
          <p className="mt-1 text-sm text-slate-500">A nudge on the Nutrition page and on Home when a meal is not logged by the time you choose. They stay inside the app: nothing is emailed or pushed to your phone.</p>
        </div>
        <Switch checked={f.enabled} onCheckedChange={(v) => setF((x) => ({ ...x, enabled: v }))} aria-label="Turn reminders on" data-testid="reminders-enabled" />
      </div>
      <div className={f.enabled ? "mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5" : "mt-4 grid grid-cols-2 gap-3 opacity-50 sm:grid-cols-5"}>
        {MEAL_ROWS.map(([m, label]) => (
          <div key={m}><Label htmlFor={`rem-${m}`} className="text-xs">{label} by</Label><Input id={`rem-${m}`} type="time" disabled={!f.enabled} value={f.meals[m] || ""} onChange={(e) => setMeal(m, e.target.value)} className="mt-1 h-10" data-testid={`reminder-time-${m}`} /></div>
        ))}
        <div><Label htmlFor="rem-water" className="text-xs">Water check at</Label><Input id="rem-water" type="time" disabled={!f.enabled} value={f.water_by} onChange={(e) => setF((x) => ({ ...x, water_by: e.target.value }))} className="mt-1 h-10" data-testid="reminder-time-water" /></div>
      </div>
      <p className="mt-2 text-xs text-slate-500">Leave a time empty for no reminder. The water check appears if you have had less than half of your total-water reference by then. Times follow {timezone ? `your time zone (${timezone})` : "UTC, because no time zone is set above"}.</p>
      <div className="mt-3 flex justify-end"><Button onClick={save} disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="reminders-save">Save reminders</Button></div>
    </Card>
  );
}
