import { useState } from "react";
import { Pause, Pencil, Play, Plus, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, eur, errorMessage } from "@/lib/api";
import { refreshAll, useFetch } from "@/lib/useFetch";
import { Resolve, Sk } from "@/components/skeletons";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const REPEATS = [["weekly", "Every week"], ["monthly", "Every month"], ["yearly", "Every year"]];
const today = () => new Date().toISOString().slice(0, 10);
const when = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("default", { day: "numeric", month: "short", year: "numeric" });
const EMPTY = { kind: "expense", description: "", amount: "", account: "", category: "Bills", repeat: "monthly", start_date: today(), end_date: "" };

/** The money that repeats (rent, a subscription, a salary). Each item becomes a real transaction on its day, by itself. */
export function Recurring({ accounts, categories }) {
  const { data, loading, error, reload } = useFetch("/recurring");
  const [form, setForm] = useState(null);          // null = closed; { id?, ...fields }
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const rows = data || [];

  const open = (r) => setForm(r ? { id: r.id, kind: r.kind, description: r.description || r.merchant || "", amount: String(r.amount), account: r.account,
    category: r.category || "Bills", repeat: r.repeat, start_date: r.next_due, end_date: r.end_date || "" } : { ...EMPTY, account: accounts[0]?.id || "", start_date: today() });

  const save = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!(amount > 0)) { toast.error("Enter an amount above zero"); return; }
    if (!form.account) { toast.error("Choose the place it is paid from or into"); return; }
    setSaving(true);
    try {
      const body = { amount, account: form.account, description: form.description.trim() || null, merchant: form.description.trim() || null,
        category: form.kind === "expense" ? form.category : null, repeat: form.repeat };
      if (form.id) await api.put(`/recurring/${form.id}`, { ...body, next_due: form.start_date, ...(form.end_date ? { end_date: form.end_date } : { clear_end: true }) });
      else await api.post("/recurring", { ...body, kind: form.kind, start_date: form.start_date, end_date: form.end_date || null });
      toast.success(form.id ? "Saved" : "Added. It will be recorded on its day.");
      setForm(null); reload({ force: true }); refreshAll();
    } catch (err) { toast.error(errorMessage(err, "Could not save this")); } finally { setSaving(false); }
  };
  const act = async (fn, ok) => { try { await fn(); toast.success(ok); reload({ force: true }); refreshAll(); } catch (err) { toast.error(errorMessage(err, "That did not work")); } };

  return (
    <section className="mny-card overflow-hidden" aria-labelledby="mny-rec-h" data-testid="recurring-card">
      <div className="flex items-center justify-between gap-2 p-5 pb-3">
        <h3 id="mny-rec-h" className="mny-title flex items-center gap-2 text-base font-semibold"><Repeat className="h-4 w-4" aria-hidden="true" />Recurring</h3>
        <button type="button" className="mny-pill sm" onClick={() => open(null)} disabled={!accounts.length} data-testid="recurring-add"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Add</button>
      </div>
      <Resolve loading={loading} error={error} onRetry={() => reload({ force: true })} label="Loading recurring items" what="recurring items"
        skeleton={<div className="space-y-3 px-5 pb-5">{[0, 1].map((i) => <div key={i} className="flex items-center gap-3"><Sk className="h-10 w-10 !rounded-full" /><div className="flex-1 space-y-1.5"><Sk className="h-3.5 w-1/3" /><Sk className="h-3 w-1/2" /></div><Sk className="h-4 w-16" /></div>)}</div>}>
        {rows.length === 0 ? (
          <p className="mny-muted px-5 pb-5 text-sm">Rent, a subscription, a salary: add it once and it is recorded on its day, by itself.</p>
        ) : (
          <ul className="mny-hair divide-y border-t">
            {rows.map((r) => {
              const label = r.description || r.merchant || (r.kind === "income" ? "Income" : "Recurring");
              const state = r.status === "active" ? null : r.status === "paused" ? "Paused" : "Ended";
              return (
                <li key={r.id} data-testid={`recurring-${r.id}`} className="mny-row group flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="mny-title truncate text-sm font-medium">{label}</p>
                      {state && <span className="mny-state amber">{state}</span>}
                    </div>
                    <p className="mny-muted text-xs">
                      {REPEATS.find(([k]) => k === r.repeat)?.[1]}{r.status === "active" ? ` · next ${when(r.next_due)}` : ""} · {r.account_name || "a place"}
                    </p>
                    {r.note && <p role="status" className="mny-amber mt-0.5 text-xs">{r.note}</p>}
                  </div>
                  <p className={cn("mny-num shrink-0 text-sm font-semibold", r.kind === "income" ? "mny-green" : "mny-title")}>{r.kind === "income" ? "+" : ""}{eur(r.amount)}</p>
                  <div className="flex items-center gap-0.5">
                    {r.status === "active"
                      ? <button type="button" className="mny-icon-btn" aria-label={`Pause ${label}`} onClick={() => act(() => api.post(`/recurring/${r.id}/pause`), "Paused")}><Pause className="h-4 w-4" /></button>
                      : r.status === "paused" && <button type="button" className="mny-icon-btn" aria-label={`Resume ${label}`} onClick={() => act(() => api.post(`/recurring/${r.id}/resume`), "Resumed")}><Play className="h-4 w-4" /></button>}
                    <button type="button" className="mny-icon-btn" aria-label={`Edit ${label}`} onClick={() => open(r)}><Pencil className="h-4 w-4" /></button>
                    <button type="button" className="mny-icon-btn danger" aria-label={`Delete ${label}`} onClick={() => setToDelete(r)}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Resolve>

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent className="mny-dialog max-w-md" data-testid="recurring-dialog">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Edit recurring" : "New recurring"}</DialogTitle>
            <DialogDescription>It is recorded as a normal transaction on each due day, by itself. You can undo or delete any of them.</DialogDescription>
          </DialogHeader>
          {form && (
            <form onSubmit={save} className="mt-2 space-y-3">
              {!form.id && (
                <div className="flex gap-1.5" role="group" aria-label="Type">
                  {[["expense", "Expense"], ["income", "Income"]].map(([k, l]) => <button key={k} type="button" className="mny-pill" aria-pressed={form.kind === k} data-testid={`recurring-kind-${k}`} onClick={() => set("kind")(k)}>{l}</button>)}
                </div>
              )}
              <div><Label className="mny-muted text-xs" htmlFor="rec-name">Name</Label><Input id="rec-name" className="mny-field" value={form.description} onChange={(e) => set("description")(e.target.value)} placeholder={form.kind === "income" ? "e.g. Salary" : "e.g. Rent"} data-testid="recurring-name" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="mny-muted text-xs" htmlFor="rec-amount">Amount (€)</Label><Input id="rec-amount" className="mny-field" type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set("amount")(e.target.value)} data-testid="recurring-amount" /></div>
                <div>
                  <Label className="mny-muted text-xs">Repeats</Label>
                  <Select value={form.repeat} onValueChange={set("repeat")}>
                    <SelectTrigger className="mny-field" aria-label="Repeats" data-testid="recurring-repeat"><SelectValue /></SelectTrigger>
                    <SelectContent>{REPEATS.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="mny-muted text-xs">{form.kind === "income" ? "Paid into" : "Paid from"}</Label>
                <Select value={form.account} onValueChange={set("account")}>
                  <SelectTrigger className="mny-field" aria-label={form.kind === "income" ? "Paid into" : "Paid from"} data-testid="recurring-account"><SelectValue placeholder="Choose a place" /></SelectTrigger>
                  <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {form.kind === "expense" && (
                <div>
                  <Label className="mny-muted text-xs">Category</Label>
                  <Select value={form.category} onValueChange={set("category")}>
                    <SelectTrigger className="mny-field" aria-label="Category"><SelectValue /></SelectTrigger>
                    <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="mny-muted text-xs" htmlFor="rec-start">{form.id ? "Next date" : "First date"}</Label><Input id="rec-start" className="mny-field" type="date" value={form.start_date} onChange={(e) => set("start_date")(e.target.value)} data-testid="recurring-start" /></div>
                <div><Label className="mny-muted text-xs" htmlFor="rec-end">Ends (optional)</Label><Input id="rec-end" className="mny-field" type="date" value={form.end_date} onChange={(e) => set("end_date")(e.target.value)} /></div>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className="mny-pill" onClick={() => setForm(null)}>Cancel</button>
                <button type="submit" className="mny-pill mny-cta" disabled={saving} data-testid="recurring-save">Save</button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)} title="Delete this recurring item?"
        description={toDelete ? `"${toDelete.description || toDelete.merchant || "This item"}" will stop. What it already recorded stays in your history.` : ""}
        onConfirm={() => { const r = toDelete; setToDelete(null); act(() => api.delete(`/recurring/${r.id}`), "Deleted"); }} confirmText="Delete" variant="danger" />
    </section>
  );
}
