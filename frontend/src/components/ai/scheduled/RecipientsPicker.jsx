import { useState } from "react";
import { Check, Mail, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "@/components/ai/scheduled/Pills";
import { errorText } from "@/components/ai/scheduled/scheduleUtils";
import { inputClass } from "@/components/ai/scheduled/ScheduleFields";

/**
 * Who a report is emailed to. Only verified addresses can be ticked: your account address, plus others that
 * confirmed a code we emailed them. Nothing here sends a report.
 */
export function RecipientsPicker({ selected, onChange, email }) {
  const { data, loading, reload } = useFetch("/scheduled/recipients");
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(null);
  const [codes, setCodes] = useState({});
  const ready = email?.configured;

  const toggle = (addr, on) => onChange(on ? [...new Set([...selected, addr])] : selected.filter((e) => e !== addr));

  const add = async (e) => {
    e?.preventDefault();
    if (!adding.trim()) return;
    setBusy("add");
    try { await api.post("/scheduled/recipients", { email: adding.trim() }); setAdding(""); toast.success("Code sent. Ask them for it."); await reload(); }
    catch (err) { toast.error(errorText(err)); }
    finally { setBusy(null); }
  };
  const verify = async (r) => {
    setBusy(r.id);
    try { await api.post(`/scheduled/recipients/${r.id}/verify`, { code: (codes[r.id] || "").trim() }); toast.success(`${r.email} is verified`); setCodes((c) => ({ ...c, [r.id]: "" })); await reload(); onChange([...new Set([...selected, r.email])]); }
    catch (err) { toast.error(errorText(err)); }
    finally { setBusy(null); }
  };
  const resend = async (r) => {
    setBusy(r.id);
    try { await api.post("/scheduled/recipients", { email: r.email }); toast.success("A new code was sent"); }
    catch (err) { toast.error(errorText(err)); }
    finally { setBusy(null); }
  };
  const remove = async (r) => {
    setBusy(r.id);
    try { await api.delete(`/scheduled/recipients/${r.id}`); onChange(selected.filter((e) => e !== r.email)); await reload(); }
    catch (err) { toast.error(errorText(err)); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-3" data-testid="recipients">
      {!ready && (
        <p role="note" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" data-testid="email-not-ready">
          Reports can’t be emailed yet: {email?.problem || "email is not set up on this server."} You can still run them and read the results here.
        </p>
      )}
      {loading && !data && <div className="skeleton h-12 w-full" aria-hidden="true" />}
      <ul className="space-y-1.5">
        {(data || []).map((r) => (
          <li key={r.id} className="rounded-xl border border-border bg-card px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              {r.verified ? (
                <Checkbox checked={selected.includes(r.email)} disabled={!ready} onCheckedChange={(v) => toggle(r.email, !!v)} aria-label={`Email reports to ${r.email}`} data-testid="recipient-check" />
              ) : <Mail className="h-4 w-4 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate text-sm">{r.email}{r.own && <span className="text-muted-foreground"> · your account</span>}</span>
              {r.verified ? <Pill tone="emerald"><Check className="h-3 w-3" />Verified</Pill> : <Pill tone="amber">Not verified</Pill>}
              {!r.own && <button type="button" aria-label={`Remove ${r.email}`} onClick={() => remove(r)} disabled={busy === r.id} className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>}
            </div>
            {!r.verified && !r.own && (
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                <input value={codes[r.id] || ""} onChange={(e) => setCodes((c) => ({ ...c, [r.id]: e.target.value.replace(/\D/g, "") }))} inputMode="numeric" maxLength={6}
                  placeholder="6-digit code" aria-label={`Code for ${r.email}`} className={`${inputClass} h-9 w-32 font-mono`} />
                <button type="button" onClick={() => verify(r)} disabled={busy === r.id || (codes[r.id] || "").length < 4}
                  className="h-9 rounded-xl bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">Verify</button>
                <button type="button" onClick={() => resend(r)} disabled={busy === r.id || !ready} className="text-xs font-medium text-emerald-700 hover:underline disabled:opacity-50 dark:text-emerald-300">Send a new code</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2">
        <input type="email" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add another address" aria-label="Another email address" disabled={!ready}
          data-testid="recipient-add-input" className={inputClass} />
        <button type="submit" disabled={!ready || busy === "add" || !adding.trim()} data-testid="recipient-add"
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium transition-colors hover:border-emerald-500/60 disabled:opacity-50">
          {busy === "add" ? <Send className="h-4 w-4 animate-pulse" /> : <Plus className="h-4 w-4" />}Send code
        </button>
      </form>
      <p className="text-xs text-muted-foreground">We email the address a 6-digit code. It can only receive reports once they read it back to you.</p>
    </div>
  );
}
