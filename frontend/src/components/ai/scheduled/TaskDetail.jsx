import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ArrowLeft, Copy, Loader2, Pause, Pencil, Play, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AIMarkdown } from "@/components/ai/AIMarkdown";
import { DeliveryPill, Pill, RunStatusPill, TaskStatusPill } from "@/components/ai/scheduled/Pills";
import { duration, errorText, formatWhen, isLive, relative } from "@/components/ai/scheduled/scheduleUtils";
import { cn } from "@/lib/utils";

const TRIGGER = { schedule: "Scheduled", manual: "Run now", retry: "Retry", preview: "Preview" };

function Action({ icon: Icon, children, onClick, busy, primary, danger, testid, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={busy || disabled} data-testid={testid}
      className={cn("inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-colors disabled:opacity-50",
        primary ? "bg-emerald-700 text-white hover:bg-emerald-700" : danger ? "border border-border text-red-600 hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-500/10" : "border border-border hover:border-emerald-500/60")}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}{children}
    </button>
  );
}

export function RunView({ runId, task, onBack, onChanged }) {
  const { data: run, reload } = useFetch(`/scheduled/runs/${runId}`);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (isLive(run)) { const t = setTimeout(reload, 2000); return () => clearTimeout(t); } return undefined; }, [run, reload]);

  const retry = async () => {
    setBusy(true);
    try { await api.post(`/scheduled/runs/${runId}/retry`); toast.success(run.status === "succeeded" ? "Trying the email again" : "Running it again"); await reload(); onChanged(); }
    catch (e) { toast.error(errorText(e)); }
    finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(run.output || ""); toast.success("Copied"); } catch { toast.error("Could not copy"); } };

  if (!run) return <div className="space-y-3 p-4" aria-hidden="true"><div className="skeleton h-6 w-40" /><div className="skeleton h-40 w-full" /></div>;
  const canRerun = (run.status === "failed" || run.status === "missed") && run.trigger !== "preview";
  const canResend = run.status === "succeeded" && ["failed", "not_configured"].includes(run.delivery_status) && run.trigger !== "preview";

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="run-view">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <button type="button" onClick={onBack} aria-label="Back to history" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"><ArrowLeft className="h-4 w-4" /></button>
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold tracking-tight">{TRIGGER[run.trigger] || "Run"} · {formatWhen(run.started_at || run.created_at, task.timezone)}</h2>
          <p className="text-xs text-muted-foreground">{run.duration_ms != null ? `Took ${duration(run.duration_ms)}` : "In progress"}</p>
        </div>
        <div className="ml-auto flex items-center gap-1.5"><RunStatusPill status={run.status} />{run.trigger !== "preview" && run.status === "succeeded" && <DeliveryPill status={run.delivery_status} />}</div>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
        {run.status === "failed" || run.status === "missed" ? (
          <div role="alert" className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100" data-testid="run-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-medium">{run.status === "missed" ? "This run was missed" : "This run failed"}</p><p className="mt-0.5">{run.error}</p></div>
          </div>
        ) : null}
        {isLive(run) && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Writing the report from your data…</p>}
        {run.output && (
          <section className="rounded-2xl border border-border bg-card p-4" aria-label="Report" data-testid="run-output">
            <div className="mb-2 flex justify-end"><button type="button" onClick={copy} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"><Copy className="h-3.5 w-3.5" />Copy</button></div>
            <AIMarkdown text={run.output} />
          </section>
        )}
        {run.trigger !== "preview" && run.delivery_status !== "none" && (
          <section aria-label="Email delivery" className="space-y-2" data-testid="run-delivery">
            <h3 className="text-sm font-semibold">Email</h3>
            <p className="text-sm text-muted-foreground">{run.delivery_detail}</p>
            <ul className="space-y-1">
              {(run.deliveries || []).map((d) => (
                <li key={d.email} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{d.email}</span>
                  <Pill tone={d.status === "sent" ? "emerald" : d.status === "not_configured" ? "amber" : "red"}>{d.status === "sent" ? "Sent" : d.status === "not_configured" ? "Not set up" : "Failed"}</Pill></li>
              ))}
            </ul>
            {(run.deliveries || []).filter((d) => d.status !== "sent" && d.detail).map((d) => <p key={d.email} className="text-xs text-muted-foreground">{d.email}: {d.detail}</p>)}
          </section>
        )}
        {run.data_errors?.length > 0 && <p className="text-xs text-muted-foreground">Could not load: {run.data_errors.join(", ")}.</p>}
        {run.tools_used?.length > 0 && <p className="text-xs text-muted-foreground">Read: {run.tools_used.map((t) => t.replace("get_", "").replace(/_/g, " ")).join(", ")}.</p>}
        <div className="flex flex-wrap gap-2">
          {canRerun && <Action icon={RotateCcw} onClick={retry} busy={busy} primary testid="run-retry">Run again</Action>}
          {canResend && <Action icon={RotateCcw} onClick={retry} busy={busy} primary testid="run-retry-email">Retry the email</Action>}
        </div>
      </div>
    </div>
  );
}

export function TaskDetail({ task, onBack, onEdit, onChanged, onDeleted }) {
  const { data: runs, loading, reload } = useFetch(`/scheduled/tasks/${task.id}/runs`);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const live = (runs || []).some(isLive);

  useEffect(() => { if (live) { const t = setTimeout(() => { reload(); onChanged(); }, 2500); return () => clearTimeout(t); } return undefined; }, [live, runs, reload, onChanged]);

  const act = useCallback(async (key, fn, ok) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); await reload(); onChanged(); }
    catch (e) { toast.error(errorText(e)); }
    finally { setBusy(null); }
  }, [onChanged, reload]);

  if (selected) return <RunView runId={selected} task={task} onBack={() => { setSelected(null); reload(); }} onChanged={() => { reload(); onChanged(); }} />;

  const draft = task.status === "draft";
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="task-detail">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <button type="button" onClick={onBack} aria-label="Back to scheduled tasks" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"><ArrowLeft className="h-4 w-4" /></button>
        <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">{task.title}</h2>
        <TaskStatusPill status={task.status} />
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
        <section className="space-y-1.5 text-sm">
          <p className="text-muted-foreground">{task.instruction}</p>
          <p><span className="text-muted-foreground">Runs </span>{task.schedule_text}</p>
          {task.next_run_at && task.status === "active" && <p><span className="text-muted-foreground">Next </span><span className="lm-money">{formatWhen(task.next_run_at, task.timezone)}</span> <span className="text-muted-foreground">({relative(task.next_run_at)})</span></p>}
          <p><span className="text-muted-foreground">Emails </span>{task.recipients.length ? task.recipients.join(", ") : "No one"}</p>
          {draft && <p className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">This task is not running yet. Review it and activate it to start the schedule.</p>}
        </section>

        <div className="flex flex-wrap gap-2">
          {draft && <Action icon={Play} primary onClick={() => onEdit(task, 3)} testid="task-review">Review and activate</Action>}
          {!draft && <Action icon={Play} busy={busy === "run"} onClick={() => act("run", () => api.post(`/scheduled/tasks/${task.id}/run`), "Started")} testid="task-run-now">Run now</Action>}
          {draft && <Action icon={Play} busy={busy === "preview"} onClick={() => act("preview", () => api.post(`/scheduled/tasks/${task.id}/preview`), "Preview started")} testid="task-preview">Preview</Action>}
          {task.status === "active" && <Action icon={Pause} busy={busy === "pause"} onClick={() => act("pause", () => api.post(`/scheduled/tasks/${task.id}/pause`), "Paused")} testid="task-pause">Pause</Action>}
          {task.status === "paused" && <Action icon={Play} primary busy={busy === "resume"} onClick={() => act("resume", () => api.post(`/scheduled/tasks/${task.id}/resume`), "Resumed")} testid="task-resume">Resume</Action>}
          <Action icon={Pencil} onClick={() => onEdit(task)} testid="task-edit">Edit</Action>
          <Action icon={Copy} busy={busy === "dup"} onClick={() => act("dup", () => api.post(`/scheduled/tasks/${task.id}/duplicate`), "Copy created as a draft")} testid="task-duplicate">Duplicate</Action>
          <Action icon={Trash2} danger onClick={() => setConfirmDelete(true)} testid="task-delete">Delete</Action>
        </div>

        <section aria-label="History" className="space-y-2">
          <h3 className="text-sm font-semibold">History</h3>
          {loading && !runs && <div className="space-y-2" aria-hidden="true">{[0, 1].map((i) => <div key={i} className="skeleton h-14 w-full" />)}</div>}
          {runs && runs.length === 0 && <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground" data-testid="history-empty">No runs yet. {draft ? "Preview it to see what it would write." : "The first run appears here when it happens."}</p>}
          <ul className="space-y-1.5">
            {(runs || []).map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setSelected(r.id)} data-testid="run-row"
                  className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-emerald-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <RunStatusPill status={r.status} />
                    {r.trigger !== "preview" && r.status === "succeeded" && r.delivery_status !== "none" && <DeliveryPill status={r.delivery_status} />}
                    <span className="ml-auto text-xs text-muted-foreground">{TRIGGER[r.trigger]} · {formatWhen(r.started_at || r.created_at, task.timezone)}{r.duration_ms != null ? ` · ${duration(r.duration_ms)}` : ""}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.error || r.output_preview || "…"}</p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title="Delete this scheduled task?"
        description={`“${task.title}” and its run history will be removed, and it will stop running.`} confirmText="Delete task"
        onConfirm={async () => { setConfirmDelete(false); try { await api.delete(`/scheduled/tasks/${task.id}`); toast.success("Task deleted"); onDeleted(); } catch (e) { toast.error(errorText(e)); } }} />
    </div>
  );
}
