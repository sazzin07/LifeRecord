import { useState, useEffect } from "react";
import { Timer, Plus, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { Label } from "@/components/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const WORKOUT_TEMPLATES = {
  Push: { color: "#10B981", exercises: [
    { name: "Dips", sets: 3, reps: 12, weight: 0 }, { name: "Pike push-ups", sets: 3, reps: 10, weight: 0 },
    { name: "Push-ups", sets: 3, reps: 15, weight: 0 }, { name: "Pseudo planche", sets: 3, reps: 8, weight: 0 },
    { name: "Planche lean", is_isometric: true, duration: 30 }] },
  Pull: { color: "#6366F1", exercises: [
    { name: "Pull-ups", sets: 3, reps: 8, weight: 0 }, { name: "Rows", sets: 3, reps: 10, weight: 20 },
    { name: "Chin-ups", sets: 3, reps: 8, weight: 0 }, { name: "Face pulls", sets: 3, reps: 15, weight: 10 },
    { name: "Dead hang", is_isometric: true, duration: 45 }] },
  Legs: { color: "#F59E0B", exercises: [
    { name: "Pistol squats", sets: 3, reps: 6, weight: 0 }, { name: "Nordic curls", sets: 3, reps: 6, weight: 0 },
    { name: "Calf raises", sets: 3, reps: 20, weight: 0 }, { name: "Lunges", sets: 3, reps: 12, weight: 0 },
    { name: "Wall sit", is_isometric: true, duration: 60 }] },
};

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Stored exercise -> editable row. Original sets are kept so an untouched row is saved exactly as it was. */
const toRow = (e) => e.is_isometric
  ? { name: e.name, is_isometric: true, duration: e.duration ?? 0, note: e.note || "" }
  : { name: e.name, is_isometric: false, sets: e.sets.length || 1, reps: e.sets[0]?.reps ?? 0, weight: e.sets[0]?.weight ?? 0, note: e.note || "", original: e.sets };

const toExercise = (e) => e.is_isometric
  ? { name: e.name, is_isometric: true, duration: parseInt(e.duration) || 0, sets: [], note: e.note || "" }
  : { name: e.name, is_isometric: false, note: e.note || "",
      sets: e.original && !e.dirty ? e.original
        : Array.from({ length: parseInt(e.sets) || 1 }).map(() => ({ reps: parseInt(e.reps) || 0, weight: parseFloat(e.weight) || 0 })) };

/** Log a new session, or edit `workout` when given. */
export function WorkoutDialog({ open, setOpen, workout = null }) {
  const editing = !!workout;
  const [type, setType] = useState("Push");
  const [date, setDate] = useState(localToday());
  const [notes, setNotes] = useState("");
  const [exs, setExs] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (workout) {
      setType(workout.type); setDate(workout.date); setNotes(workout.notes || "");
      setExs((workout.exercises || []).map(toRow));
    } else {
      setType("Push"); setDate(localToday()); setNotes("");
      setExs(WORKOUT_TEMPLATES.Push.exercises.map((e) => ({ ...e })));
    }
  }, [open, workout]);

  const changeType = (t) => {
    setType(t);
    if (!editing && WORKOUT_TEMPLATES[t]) setExs(WORKOUT_TEMPLATES[t].exercises.map((e) => ({ ...e })));
  };
  const setEx = (i, k, v) => setExs((a) => a.map((x, idx) => idx === i ? { ...x, [k]: v, dirty: x.dirty || ["sets", "reps", "weight"].includes(k) } : x));

  const save = async () => {
    const exercises = exs.filter((e) => e.name.trim()).map(toExercise);
    const body = { type, date, notes, exercises };
    setSaving(true);
    try {
      if (editing) await api.put(`/workouts/${workout.id}`, body);
      else await api.post("/workouts", body);
      toast.success(editing ? "Session updated" : `${type} session logged`);
      refreshAll();
      setOpen(false);
    } catch (err) {
      toast.error(errorMessage(err, editing ? "Could not update session" : "Could not save session"));
    } finally {
      setSaving(false);
    }
  };

  const types = Object.keys(WORKOUT_TEMPLATES).includes(type) ? Object.keys(WORKOUT_TEMPLATES) : [...Object.keys(WORKOUT_TEMPLATES), type];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="workout-log-dialog">
        <DialogHeader><DialogTitle>{editing ? "Edit workout" : "Log workout"}</DialogTitle>
          <DialogDescription className="sr-only">{editing ? "Change a logged workout session" : "Record a completed workout session"}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Select value={type} onValueChange={changeType}>
              <SelectTrigger data-testid="workout-type" aria-label="Workout type"><SelectValue /></SelectTrigger>
              <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
            <DatePicker value={date} onChange={(v) => v && setDate(v)} clearable={false} aria-label="Date" data-testid="workout-date"
              presets={[{ label: "Today", days: 0 }, { label: "Yesterday", days: -1 }]} />
          </div>
          <div className="space-y-2">
            {exs.map((e, i) => (
              <div key={i} className="rounded-xl border border-border p-3" data-testid={`workout-ex-${i}`}>
                <div className="flex items-center gap-2 mb-2">
                  <Input value={e.name} onChange={(ev) => setEx(i, "name", ev.target.value)} className="h-8 font-medium" aria-label="Exercise name" />
                  <button type="button" aria-label={`Remove ${e.name}`} onClick={() => setExs((a) => a.filter((_, idx) => idx !== i))} className="text-slate-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                </div>
                {e.is_isometric ? (
                  <div className="flex items-center gap-2 text-sm"><Timer className="h-4 w-4 text-emerald-600" /><Input type="number" value={e.duration} onChange={(ev) => setEx(i, "duration", ev.target.value)} className="h-8 w-24" aria-label="Seconds" /> seconds</div>
                ) : (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <div><Label>Sets</Label><Input type="number" value={e.sets} onChange={(ev) => setEx(i, "sets", ev.target.value)} className="h-8 mt-1" aria-label="Sets" /></div>
                      <div><Label>Reps</Label><Input type="number" value={e.reps} onChange={(ev) => setEx(i, "reps", ev.target.value)} className="h-8 mt-1" aria-label="Reps" /></div>
                      <div><Label>Weight (kg)</Label><Input type="number" value={e.weight} onChange={(ev) => setEx(i, "weight", ev.target.value)} className="h-8 mt-1" aria-label="Weight in kg" /></div>
                    </div>
                    {e.original && !e.dirty && new Set(e.original.map((s) => `${s.reps}|${s.weight}`)).size > 1 && (
                      <p className="mt-1.5 text-xs text-slate-500">Logged as {e.original.map((s) => `${s.reps}${s.weight ? `@${s.weight}kg` : ""}`).join(", ")}. Changing the numbers above replaces these sets.</p>
                    )}
                  </>
                )}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setExs((a) => [...a, { name: "New exercise", sets: 3, reps: 10, weight: 0 }])}><Plus className="h-4 w-4 mr-1" />Add exercise</Button>
          </div>
          <div><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="How did it go?" className="mt-1" data-testid="workout-notes" /></div>
          <Button onClick={save} disabled={saving} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="workout-save">{editing ? "Save changes" : "Save session"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
