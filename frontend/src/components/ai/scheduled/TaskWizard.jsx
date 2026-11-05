import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Play, Sparkles, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Checkbox } from "@/components/ui/checkbox";
import { AIMarkdown } from "@/components/ai/AIMarkdown";
import { RecipientsPicker } from "@/components/ai/scheduled/RecipientsPicker";
import { Field, NextRuns, ScheduleFields, inputClass } from "@/components/ai/scheduled/ScheduleFields";
import { RunStatusPill } from "@/components/ai/scheduled/Pills";
import { defaultSchedule, detectTimezone, errorText, formatWhen, isLive } from "@/components/ai/scheduled/scheduleUtils";
import { cn } from "@/lib/utils";

const STEPS = ["Describe", "When", "What and who", "Review"];

const EXAMPLES = [
  "Every Monday at 9:00, review last week's spending and tell me what changed.",
  "On the 1st of each month, summarise how I did against my category budgets.",
  "Every Friday at 17:00, list my overdue tasks and what I ate this week.",
];

function Sources({ options, value, onChange }) {
  const all = options?.sources || [];
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Data the report may read">
      {all.map((s) => {
        const on = value.includes(s.id);
        return (
          <button key={s.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(s.id)} data-testid={`source-${s.id}`}
            className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-sm transition-colors",
              on ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100" : "border-border hover:border-emerald-500/60")}>
            {on && <Check className="h-3.5 w-3.5" />}{s.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Create or edit a scheduled task in four steps. Nothing runs or is emailed until the last step, where the owner
 * previews the report, reviews who receives it and confirms.
 */
export function TaskWizard({ task, options, initialStep, onClose, onSaved }) {
  const editing = !!task;
  const [step, setStep] = useState(initialStep ?? (editing ? 1 : 0));
  const [request, setRequest] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [form, setForm] = useState(() => task ? {
    title: task.title, instruction: task.instruction, schedule: task.schedule, timezone: task.timezone, data_sources: task.data_sources || [], recipients: task.recipients || [],
  } : { title: "", instruction: "", schedule: defaultSchedule("weekly"), timezone: detectTimezone(), data_sources: [], recipients: [] });
  const [scheduleOk, setScheduleOk] = useState(true);
  const [savedId, setSavedId] = useState(task?.id || null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState(null); // { run, loading }
  const [error, setError] = useState(null);
  const poll = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const body = useRef(null);

  useEffect(() => () => clearTimeout(poll.current), []);
  useEffect(() => { body.current?.scrollTo({ top: 0 }); }, [step]);

  const draft = async () => {
    setDrafting(true); setError(null);
    try {
      const { data } = await api.post("/scheduled/draft", { request, timezone: form.timezone });
      setForm((f) => ({ ...f, title: data.title, instruction: data.instruction, schedule: data.schedule, data_sources: data.data_sources, recipients: data.send_email && options?.email?.configured && options.account_email_verified ? [options.account_email] : f.recipients }));
      setStep(1);
      toast.success("Drafted. Check the schedule and details.");
    } catch (e) { setError(errorText(e)); }
    finally { setDrafting(false); }
  };

  const save = useCallback(async () => {
    const payload = { ...form, title: form.title.trim(), instruction: form.instruction.trim() };
    const { data } = savedId ? await api.put(`/scheduled/tasks/${savedId}`, payload) : await api.post("/scheduled/tasks", payload);
    setSavedId(data.id);
    return data;
  }, [form, savedId]);

  const watch = useCallback((id) => {
    const tick = async () => {
      try {
        const { data } = await api.get(`/scheduled/runs/${id}`);
        setPreview({ run: data, loading: isLive(data) });
        if (isLive(data)) poll.current = setTimeout(tick, 1800);
      } catch { setPreview(null); }
    };
    tick();
  }, []);

  const runPreview = async () => {
    setError(null); setPreview({ run: null, loading: true });
    try {
      const saved = await save();
      const { data } = await api.post(`/scheduled/tasks/${saved.id}/preview`);
      watch(data.id);
    } catch (e) { setPreview(null); setError(errorText(e)); }
  };

  const finish = async (activate) => {
    setSaving(true); setError(null);
    try {
      let saved = await save();
      if (activate) saved = (await api.post(`/scheduled/tasks/${saved.id}/activate`, { confirm: true, confirm_recipients: form.recipients })).data;
      toast.success(activate ? `Scheduled. Next run ${formatWhen(saved.next_run_at, saved.timezone)}` : "Saved as a draft");
      onSaved(saved);
    } catch (e) { setError(errorText(e)); }
    finally { setSaving(false); }
  };

  const canNext = step === 0 ? true : step === 1 ? scheduleOk : step === 2 ? form.title.trim().length > 0 && form.instruction.trim().length >= 5 : true;
  const emailing = form.recipients.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="task-wizard">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <button type="button" onClick={onClose} aria-label="Back to scheduled tasks" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"><ArrowLeft className="h-4 w-4" /></button>
        <h2 className="text-[15px] font-semibold tracking-tight">{editing ? "Edit scheduled task" : "New scheduled task"}</h2>
        <ol className="ml-auto flex items-center gap-1" aria-label="Steps">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? "step" : undefined}>
              <button type="button" disabled={i > step || (editing && i === 0)} onClick={() => setStep(i)} aria-label={s}
                className={cn("h-1.5 rounded-full transition-all", i === step ? "w-6 bg-emerald-700" : i < step ? "w-3 bg-emerald-500/60" : "w-3 bg-muted")} />
            </li>
          ))}
        </ol>
      </header>

      <div ref={body} className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-5">
        <p className="text-xs font-medium text-muted-foreground">Step {step + 1} of {STEPS.length} · {STEPS[step]}</p>

        {step === 0 && (
          <section className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold tracking-tight">What should it do, and when?</h3>
              <p className="mt-1 text-sm text-muted-foreground">Describe it in your own words. I’ll turn it into a schedule you can review.</p>
            </div>
            <textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={4} maxLength={1000} placeholder="Every Monday at 9:00, review last week's spending and email me the key changes"
              aria-label="Describe the task" data-testid="wizard-request" className={cn(inputClass, "h-auto resize-none py-2.5 leading-relaxed")} />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => <button key={ex} type="button" onClick={() => setRequest(ex)} className="rounded-xl border border-border px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-emerald-500/60 hover:text-foreground">{ex}</button>)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={draft} disabled={drafting || request.trim().length < 5} data-testid="wizard-draft"
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
                {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}{drafting ? "Drafting…" : "Draft it for me"}
              </button>
              <button type="button" onClick={() => setStep(1)} data-testid="wizard-manual" className="h-10 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:text-foreground">Set it up myself</button>
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="space-y-4">
            <ScheduleFields schedule={form.schedule} onChange={(schedule) => set({ schedule })} timezone={form.timezone} onTimezone={(timezone) => set({ timezone })} />
            <NextRuns schedule={form.schedule} timezone={form.timezone} onValidity={setScheduleOk} />
          </section>
        )}

        {step === 2 && (
          <section className="space-y-5">
            <Field label="Title" htmlFor="task-title"><input id="task-title" value={form.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} data-testid="task-title" className={inputClass} /></Field>
            <Field label="What the report should cover" htmlFor="task-instruction" hint="Reports only read your data. They never change it.">
              <textarea id="task-instruction" value={form.instruction} rows={5} maxLength={2000} onChange={(e) => set({ instruction: e.target.value })} data-testid="task-instruction"
                className={cn(inputClass, "h-auto resize-y py-2.5 leading-relaxed")} />
            </Field>
            <Field label="Data it may read" hint={form.data_sources.length ? undefined : "Nothing picked means it may read any area."}>
              <Sources options={options} value={form.data_sources} onChange={(data_sources) => set({ data_sources })} />
            </Field>
            <Field label="Email the report to">
              <RecipientsPicker selected={form.recipients} onChange={(recipients) => set({ recipients })} email={options?.email} />
            </Field>
          </section>
        )}

        {step === 3 && (
          <section className="space-y-4" data-testid="wizard-review">
            <div className="rounded-2xl border border-border bg-card p-4">
              <h3 className="text-base font-semibold tracking-tight">{form.title}</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">{form.instruction}</p>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted-foreground">Runs</dt><dd><NextRuns schedule={form.schedule} timezone={form.timezone} /></dd></div>
                <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted-foreground">Reads</dt><dd>{form.data_sources.length ? (options?.sources || []).filter((s) => form.data_sources.includes(s.id)).map((s) => s.label).join(", ") : "Any area of your data (read-only)"}</dd></div>
                <div className="flex gap-3"><dt className="w-20 shrink-0 text-muted-foreground">Emails</dt><dd>{emailing ? form.recipients.join(", ") : "No one. Results stay in the run history."}</dd></div>
              </dl>
            </div>

            <div className="space-y-2">
              <button type="button" onClick={runPreview} disabled={preview?.loading || !scheduleOk} data-testid="wizard-preview"
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-border px-4 text-sm font-medium transition-colors hover:border-emerald-500/60 disabled:opacity-50">
                {preview?.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}{preview?.loading ? "Writing the report…" : "Preview the report"}
              </button>
              <p className="text-xs text-muted-foreground">Runs it once now with your real data. Nothing is emailed.</p>
              {preview?.run && !preview.loading && (
                <div className="rounded-2xl border border-border bg-background p-4" data-testid="wizard-preview-output">
                  <div className="mb-2 flex items-center gap-2"><RunStatusPill status={preview.run.status} /></div>
                  {preview.run.status === "succeeded" ? <AIMarkdown text={preview.run.output} /> : <p role="alert" className="text-sm text-red-700 dark:text-red-300">{preview.run.error}</p>}
                </div>
              )}
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-muted/40 p-3 text-sm">
              <Checkbox checked={confirm} onCheckedChange={(v) => setConfirm(!!v)} className="mt-0.5" data-testid="wizard-confirm" aria-label="Confirm the task" />
              <span>I understand this will run automatically{emailing ? <> and email its results to <strong className="font-semibold">{form.recipients.join(", ")}</strong></> : ""}, using my account’s data.</span>
            </label>
          </section>
        )}

        {error && <p role="alert" data-testid="wizard-error" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-200">{error}</p>}
      </div>

      <footer className="flex items-center gap-2 border-t border-border px-4 py-3">
        {step > (editing ? 1 : 0) && <button type="button" onClick={() => setStep(step - 1)} className="h-10 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:text-foreground">Back</button>}
        <div className="ml-auto flex items-center gap-2">
          {step === 3 ? (
            <>
              <button type="button" onClick={() => finish(false)} disabled={saving} data-testid="wizard-save-draft" className="h-10 rounded-xl border border-border px-4 text-sm font-medium hover:border-emerald-500/60 disabled:opacity-50">Save as draft</button>
              <button type="button" onClick={() => finish(true)} disabled={saving || !confirm || !scheduleOk} data-testid="wizard-activate"
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Activate
              </button>
            </>
          ) : step > 0 && (
            <button type="button" onClick={() => setStep(step + 1)} disabled={!canNext} data-testid="wizard-next"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">Next<ArrowRight className="h-4 w-4" /></button>
          )}
        </div>
      </footer>
    </div>
  );
}
