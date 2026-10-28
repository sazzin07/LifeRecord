import { useState, useCallback, useEffect } from "react";
import { Dumbbell, Trash2, Trophy, Sparkles, Play, Pencil } from "lucide-react";
import { peekQuery, fetchQuery, subscribeQuery } from "@/lib/query";
import { api } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { Card, SectionHeading, EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { WorkoutDialog, WORKOUT_TEMPLATES as TEMPLATES } from "@/components/WorkoutDialog";
import { openAI } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";

export default function Fitness() {
  const [logOpen, setLogOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [history, setHistory] = useState(() => peekQuery("/workouts") || []);
  const [prs, setPrs] = useState(() => peekQuery("/workouts/prs") || []);
  const [loaded, setLoaded] = useState(() => peekQuery("/workouts") != null);
  const [deleteId, setDeleteId] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async ({ force = true } = {}) => {
    const [h, p] = await Promise.all([fetchQuery("/workouts", { force }), fetchQuery("/workouts/prs", { force })]);
    setHistory(h); setPrs(p); setLoaded(true);
  }, []);
  useEffect(() => {
    const unsubs = ["/workouts", "/workouts/prs"].map(subscribeQuery);
    load({ force: false });
    const fn = () => load({ force: true });
    window.addEventListener("lm:refresh", fn);
    return () => { window.removeEventListener("lm:refresh", fn); unsubs.forEach((u) => u()); };
  }, [load]);

  const del = async (id) => { await api.delete(`/workouts/${id}`); refreshAll(); };
  const workoutToDelete = history.find((w) => w.id === deleteId);

  return (
    <div className="space-y-6">
      <SectionHeading title="Fitness" sub="Calisthenics — log sessions and track personal bests"
        action={<div className="flex gap-2">
          <Button variant="outline" className="h-9" onClick={() => openAI("Log today's workout: ")}><Sparkles className="h-4 w-4 mr-1 text-emerald-600" />AI</Button>
          <Button className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setLogOpen(true)} data-testid="log-workout-btn"><Play className="h-4 w-4 mr-1" />Log session</Button>
        </div>} />

      <div className="grid lg:grid-cols-3 gap-4">
        {Object.entries(TEMPLATES).map(([name, t]) => (
          <Card key={name} className="p-5 lm-in">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-8 w-8 rounded-xl grid place-items-center" style={{ background: t.color + "22" }}><Dumbbell className="h-4 w-4" style={{ color: t.color }} /></div>
              <h3 className="font-bold">{name}</h3>
            </div>
            <div className="space-y-1.5">
              {t.exercises.map((e) => (
                <div key={e.name} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700 dark:text-slate-300">{e.name}</span>
                  <span className="stat-num text-xs text-slate-500">{e.is_isometric ? `${e.duration}s` : `${e.sets}×${e.reps}`}</span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {prs.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3"><Trophy className="h-4 w-4 text-amber-500" /><h3 className="font-semibold">Personal bests</h3></div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {prs.map((p) => (
              <div key={p.name} className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3">
                <p className="font-medium text-sm">{p.name}</p>
                <p className="stat-num text-lg font-bold text-emerald-600 dark:text-emerald-400">
                  {p.is_isometric ? `${p.best_duration}s` : `${p.best_reps} reps${p.best_weight ? ` @ ${p.best_weight}kg` : ""}`}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="p-5 pb-3"><h3 className="font-semibold">Session history</h3></div>
        {!loaded ? (
          <div className="skeleton m-5 mt-0 h-40 rounded-2xl" aria-busy="true" />
        ) : history.length === 0 ? (
          <EmptyState icon={Dumbbell} title="Your training history starts here" sub="Log your first session to build up your personal-best records."
            action={<Button onClick={() => setLogOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Play className="h-4 w-4 mr-1" />Log session</Button>} />
        ) : (
          <div className="divide-y divide-border">
            {history.map((w) => (
              <div key={w.id} data-testid={`workout-${w.id}`} className="px-5 py-3 group">
                <div className="flex items-center gap-3">
                  <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full")} style={{ background: (TEMPLATES[w.type]?.color || "#94A3B8") + "22", color: TEMPLATES[w.type]?.color || "#64748B" }}>{w.type}</span>
                  <span className="text-sm text-slate-500 flex-1">{w.date}</span>
                  <button onClick={() => setEditing(w)} aria-label={`Edit ${w.type} session from ${w.date}`} data-testid={`workout-edit-${w.id}`} className="sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-slate-400 hover:text-emerald-600"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => { setDeleteId(w.id); setDeleteOpen(true); }} aria-label={`Delete ${w.type} session from ${w.date}`} data-testid={`workout-delete-${w.id}`} className="sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-slate-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                  {w.exercises.map((e) => e.is_isometric ? `${e.name} ${e.duration}s` : `${e.name} ${e.sets.length}×${e.sets[0]?.reps || 0}${e.sets[0]?.weight ? `@${e.sets[0].weight}kg` : ""}`).join(" · ")}
                </p>
                {w.notes && <p className="text-xs text-slate-400 mt-1">{w.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <WorkoutDialog open={logOpen} setOpen={setLogOpen} />
      <WorkoutDialog open={!!editing} setOpen={(o) => { if (!o) setEditing(null); }} workout={editing} />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete workout session?"
        description={workoutToDelete ? `This will permanently delete the ${workoutToDelete.type.toLowerCase()} session from ${workoutToDelete.date}.` : "This will permanently delete the workout session."}
        onConfirm={() => { const id = deleteId; if (id) del(id); }}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
