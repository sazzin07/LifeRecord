import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Loader2, Pause, Play, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { DeliveryPill, RunStatusPill, TaskStatusPill } from "@/components/ai/scheduled/Pills";
import { TaskWizard } from "@/components/ai/scheduled/TaskWizard";
import { TaskDetail } from "@/components/ai/scheduled/TaskDetail";
import { clockOf, dayOf, errorText, isLive, relative } from "@/components/ai/scheduled/scheduleUtils";
import { cn } from "@/lib/utils";

function TaskCard({ task, onOpen, onChanged }) {
  const [busy, setBusy] = useState(false);
  const last = task.last_run;
  const active = task.status === "active";
  const toggle = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try { await api.post(`/scheduled/tasks/${task.id}/${active ? "pause" : "resume"}`); toast.success(active ? "Paused" : "Resumed"); onChanged(); }
    catch (err) { toast.error(errorText(err)); }
    finally { setBusy(false); }
  };
  return (
    <li>
      <div role="button" tabIndex={0} onClick={() => onOpen(task)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(task); } }} data-testid="task-card"
        className="group flex w-full cursor-pointer gap-3 rounded-2xl border border-border bg-card p-3.5 text-left transition-colors hover:border-emerald-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50">
        <div className={cn("flex w-[4.6rem] shrink-0 flex-col items-center justify-center rounded-xl py-2 text-center", active ? "bg-emerald-50 dark:bg-emerald-500/10" : "bg-muted")} aria-label={active && task.next_run_at ? `Next run ${dayOf(task.next_run_at, task.timezone)} ${clockOf(task.next_run_at, task.timezone)}` : undefined}>
          {active && task.next_run_at ? (
            <>
              <span className="text-[11px] leading-4 text-muted-foreground">{dayOf(task.next_run_at, task.timezone)}</span>
              <span className="lm-money text-lg leading-6">{clockOf(task.next_run_at, task.timezone)}</span>
            </>
          ) : <CalendarClock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-5">{task.title}</h3>
            <TaskStatusPill status={task.status} />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{task.schedule_text}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {last ? (
              <>
                <RunStatusPill status={last.status} />
                {last.status === "succeeded" && last.delivery_status !== "none" && <DeliveryPill status={last.delivery_status} />}
                <span className="text-xs text-muted-foreground">{relative(last.finished_at || last.created_at)}</span>
              </>
            ) : <span className="text-xs text-muted-foreground">{task.status === "draft" ? "Not running yet" : "No runs yet"}</span>}
            {(active || task.status === "paused") && (
              <button type="button" onClick={toggle} disabled={busy} data-testid="task-card-toggle" aria-label={active ? `Pause ${task.title}` : `Resume ${task.title}`}
                className="ml-auto inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2 text-xs font-medium transition-colors hover:border-emerald-500/60 disabled:opacity-50">
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : active ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}{active ? "Pause" : "Resume"}
              </button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/** The Scheduled tasks area of the assistant: cards, a detail view with run history, and the create/edit flow. */
export function ScheduledView() {
  const { data: tasks, loading, reload } = useFetch("/scheduled/tasks");
  const { data: options } = useFetch("/scheduled/options");
  const [mode, setMode] = useState({ name: "list" });

  const anyLive = (tasks || []).some((t) => isLive(t.last_run));
  useEffect(() => { if (anyLive && mode.name === "list") { const t = setTimeout(reload, 3000); return () => clearTimeout(t); } return undefined; }, [anyLive, tasks, mode.name, reload]);
  const refresh = useCallback(() => reload(), [reload]);
  // Tasks change without the user: the scheduler runs them. Refresh when moving between screens and every 20 seconds.
  useEffect(() => { reload(); }, [mode.name, reload]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") reload(); }, 20000);
    return () => clearInterval(t);
  }, [reload]);

  if (mode.name === "wizard") {
    return <TaskWizard key={mode.task?.id || "new"} task={mode.task} initialStep={mode.step} options={options} onClose={() => setMode(mode.task ? { name: "detail", id: mode.task.id } : { name: "list" })}
      onSaved={(saved) => { refresh(); setMode({ name: "detail", id: saved.id }); }} />;
  }
  if (mode.name === "detail") {
    const task = (tasks || []).find((t) => t.id === mode.id);
    if (!task) return <div className="p-4" aria-hidden="true"><div className="skeleton h-24 w-full" /></div>;
    return <TaskDetail task={task} onBack={() => setMode({ name: "list" })} onChanged={refresh} onEdit={(t, step) => setMode({ name: "wizard", task: t, step })}
      onDeleted={() => { refresh(); setMode({ name: "list" }); }} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="scheduled-view">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <p className="min-w-0 text-sm text-muted-foreground">Reports that read your data on a schedule and can be emailed to you.</p>
        <button type="button" onClick={() => setMode({ name: "wizard" })} data-testid="scheduled-new"
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"><Plus className="h-4 w-4" />New</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" aria-busy={loading}>
        {tasks === null && loading && <div className="space-y-2.5" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-24 w-full" />)}</div>}
        {tasks && tasks.length === 0 && (
          <div className="mx-auto max-w-sm pt-10 text-center" data-testid="scheduled-empty">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><CalendarClock className="h-6 w-6" /></div>
            <h3 className="mt-4 text-lg font-semibold tracking-tight">Put your reports on autopilot</h3>
            <p className="mt-1 text-sm text-muted-foreground">Tell me what to look at and when, for example “every Monday at 9:00, review last week’s spending”. I’ll run it for you and can email the results.</p>
            <button type="button" onClick={() => setMode({ name: "wizard" })} className="mt-5 inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"><Plus className="h-4 w-4" />Create your first task</button>
          </div>
        )}
        <ul className="space-y-2.5">
          {(tasks || []).map((t) => <TaskCard key={t.id} task={t} onOpen={(x) => setMode({ name: "detail", id: x.id })} onChanged={refresh} />)}
        </ul>
      </div>
    </div>
  );
}
