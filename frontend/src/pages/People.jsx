import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Archive, ArrowDownLeft, ArrowUpRight, HandCoins, Loader2, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { mainCurrency } from "@/lib/money";
import { api, eur, errorMessage } from "@/lib/api";
import { newKey } from "@/lib/debts";
import { useFetch, refreshAll } from "@/lib/useFetch";
import { Avatar } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Busy, ErrorBlock, Sk } from "@/components/skeletons";
import { Amount } from "@/pages/people/Amount";
import { DebtDialog } from "@/pages/people/DebtDialog";
import { PersonProfile } from "@/pages/people/PersonProfile";

const SORTS = [
  { id: "name_asc", label: "Name A-Z" },
  { id: "name_desc", label: "Name Z-A" },
  { id: "they_owe", label: "They owe me most" },
  { id: "i_owe", label: "I owe most" },
];
const FILTERS = [
  { id: "all", label: "Everyone" },
  { id: "they_owe", label: "They owe me" },
  { id: "i_owe", label: "I owe them" },
  { id: "settled", label: "Settled" },
];
const EMPTY_FORM = { name: "", notes: "", payment_preference: "" };
const EASE = [0.2, 0, 0, 1];
const COLUMNS = "sm:grid-cols-[2rem_minmax(0,1.4fr)_minmax(0,8.5rem)_minmax(0,8.5rem)_17rem]";
const KIND_WORDS = { add: "debt added", reduce: "debt reduced", correct: "corrected", clear: "cleared", payment_in: "payment received", payment_out: "payment made" };

/** Deleting people: a compact glass bar at the top of the page, in the flow so it pushes the page down and never covers anything. It
 *  names who goes, says what happens to any balance, and has a red Delete and a Cancel. */
function DeleteBar({ targets, busy, onCancel, onConfirm }) {
  const reduce = useReducedMotion();
  const owing = (targets || []).filter((p) => p.owes_me > 0 || p.i_owe > 0 || p.other_currencies?.length);
  const names = (targets || []).map((p) => p.name);
  const bar = useRef(null);
  const open = !!(targets && targets.length > 0);
  useEffect(() => {
    // Asked from far down a long list, the bar is at the top: scroll it into view, and put keyboard focus on Cancel (the safe choice).
    if (!open || !bar.current) return;
    const frame = requestAnimationFrame(() => {
      if (!bar.current) return;
      // below the sticky app header; a short way glides, a long way (a long list) jumps
      const top = Math.max(0, bar.current.getBoundingClientRect().top + window.scrollY - 96);
      const far = Math.abs(top - window.scrollY) > window.innerHeight * 1.5;
      window.scrollTo({ top, behavior: reduce || far ? "auto" : "smooth" });
      bar.current.querySelector("[data-testid=delete-cancel]")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, reduce]);
  return (
    <AnimatePresence initial={false}>
      {targets && targets.length > 0 && (
        <motion.div key="delete-bar" ref={bar} role="alertdialog" aria-label="Confirm delete" aria-describedby="delete-bar-text" data-testid="delete-bar"
          initial={reduce ? false : { height: 0, opacity: 0, y: -8 }} animate={{ height: "auto", opacity: 1, y: 0 }} exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0, y: -8 }}
          transition={{ duration: 0.24, ease: EASE }} className="overflow-hidden">
          <div className="ppl-glass mx-auto w-full max-w-xl rounded-2xl p-3.5">
            <p id="delete-bar-text" className="text-sm font-semibold" data-testid="delete-bar-text">
              Delete {names.length === 1 ? names[0] : `${names.length} people (${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""})`}?
            </p>
            <p className="ppl-muted mt-0.5 text-xs leading-relaxed">
              {owing.length > 0
                ? `${owing.map((p) => [p.owes_me > 0 && `${p.name} owes you ${eur(p.owes_me)}`, p.i_owe > 0 && `you owe ${p.name} ${eur(p.i_owe)}`].filter(Boolean).join(" and ")).join("; ")}. Deleting also clears this: no payment is recorded. Everything is kept and can be restored.`
                : "Their history is kept and they can be restored."}
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" size="sm" className="h-8" onClick={onCancel} disabled={busy} data-testid="delete-cancel">Cancel</Button>
              <Button size="sm" className="ppl-btn-danger h-8" onClick={onConfirm} disabled={busy} data-testid="delete-confirm">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Delete"}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** One of a person's two balances in a row: a direction icon and the words, so colour is never the only signal. */
function Cell({ direction, amount, name }) {
  const theirs = direction === "they_owe";
  const Icon = theirs ? ArrowDownLeft : ArrowUpRight;
  const none = !(amount > 0);
  return (
    <div className={cn("flex items-center gap-1.5 text-sm", none ? "ppl-muted" : theirs ? "ppl-teal" : "ppl-amber")}>
      <span className="sr-only">{theirs ? `${name} owes you` : `You owe ${name}`}: </span>
      {none ? <span aria-hidden="true">—</span> : (<><Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><Amount value={amount} className="stat-num font-semibold" /></>)}
    </div>
  );
}

export default function People() {
  const nav = useNavigate();
  const reduce = useReducedMotion();
  const { id: profileId } = useParams();
  const location = useLocation();
  const { data: people, loading, error: peopleError, reload: reloadPeople } = useFetch("/people");
  const { data: overview } = useFetch("/debts/overview");
  const [view, setView] = useState("active");
  const { data: archived } = useFetch(view === "archived" ? "/debts/archived" : null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name_asc");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [debtDialog, setDebtDialog] = useState(null);
  const [deleteTargets, setDeleteTargets] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const editPerson = location.state?.editPerson;
    if (editPerson) {
      setEditing(editPerson); setForm({ name: editPerson.name, notes: editPerson.notes || "", payment_preference: editPerson.payment_preference || "" }); setFormOpen(true);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const source = useMemo(() => (view === "archived" ? (archived || []) : (people || [])), [view, archived, people]);
  const rows = useMemo(() => {
    let list = [...source];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));
    if (filter === "they_owe") list = list.filter((p) => p.owes_me > 0);
    if (filter === "i_owe") list = list.filter((p) => p.i_owe > 0);
    if (filter === "settled") list = list.filter((p) => !(p.owes_me > 0) && !(p.i_owe > 0));
    list.sort((a, b) => sort === "name_desc" ? b.name.localeCompare(a.name) : sort === "they_owe" ? b.owes_me - a.owes_me : sort === "i_owe" ? b.i_owe - a.i_owe : a.name.localeCompare(b.name));
    return list;
  }, [source, search, sort, filter]);

  const toggle = (id) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const startAdd = () => { setEditing(null); setForm(EMPTY_FORM); setFormOpen(true); };
  const startEdit = (p) => { setEditing(p); setForm({ name: p.name, notes: p.notes || "", payment_preference: p.payment_preference || "" }); setFormOpen(true); };

  const save = async (e) => {
    e?.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true);
    try {
      const body = { name: form.name.trim(), notes: form.notes, payment_preference: form.payment_preference };
      if (editing) await api.put(`/people/${editing.id}`, body); else await api.post("/people", body);
      toast.success(editing ? "Person updated" : "Person added");
      setFormOpen(false);
      refreshAll(["/people", "/debts"]);
    } catch (err) { toast.error(errorMessage(err, "Could not save")); } finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    const targets = deleteTargets || [];
    setDeleting(true);
    try {
      await api.post("/people/bulk-delete?clear_balances=true", { ids: targets.map((p) => p.id) });
      setDeleteTargets(null); setSelected(new Set());
      if (profileId && targets.some((p) => p.id === profileId)) nav("/people");
      refreshAll(["/people", "/debts", "/analytics"]);
      toast.success(targets.length === 1 ? `${targets[0].name} deleted` : `${targets.length} people deleted`, {
        duration: 9000,
        action: { label: "Undo", onClick: async () => {
          try { for (const p of targets) await api.post(`/debts/people/${p.id}/restore`, null, { headers: { "Idempotency-Key": newKey() } }); refreshAll(["/people", "/debts", "/analytics"]); toast.success("Restored"); }
          catch (err) { toast.error(errorMessage(err, "Could not restore")); }
        } },
      });
    } catch (err) { toast.error(errorMessage(err, "Could not delete")); } finally { setDeleting(false); }
  };

  const openDebt = (kind, direction, person, balances) => setDebtDialog({ kind, direction, person, currency: balances?.currency, current: kind === "correct" ? (direction === "they_owe" ? balances?.they_owe : balances?.i_owe) : undefined });
  const withBalance = overview?.people_with_debt ?? 0;

  return (
    <div className="ppl-theme ppl-stage p-4 sm:p-6 lg:p-8 space-y-6" data-testid="people-stage">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-[1.75rem] font-semibold tracking-[-0.015em] leading-tight">People</h1>
          <p className="ppl-muted mt-1 text-sm">Who owes you, and who you owe. Two separate balances for everyone.</p>
        </div>
        <Button onClick={startAdd} data-testid="add-person-btn" className="ppl-btn-primary h-10 rounded-xl px-4 font-semibold"><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Add person</Button>
      </header>

      <DeleteBar targets={deleteTargets} busy={deleting} onCancel={() => setDeleteTargets(null)} onConfirm={confirmDelete} />

      {/* The two totals, side by side and never added together; the latest activity beside them */}
      <section aria-label="Overview" className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="ppl-solid grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] divide-x divide-[var(--ppl-line)]">
          {[["they_owe", "They owe you", overview?.they_owe, ArrowDownLeft, "ppl-teal", "people-they-owe"], ["i_owe", "You owe", overview?.i_owe, ArrowUpRight, "ppl-amber", "people-i-owe"]].map(([key, label, value, Icon, tone, testid]) => (
            <div key={key} className="min-w-0 p-4 sm:p-5" data-testid={testid}>
              <p className="ppl-muted flex items-center gap-1.5 text-sm"><Icon className={cn("h-4 w-4", tone)} aria-hidden="true" />{label}</p>
              <p className={cn("mt-2 whitespace-nowrap text-2xl sm:text-3xl font-semibold tracking-tight", tone)}>
                {!overview ? <Sk className="inline-block h-8 w-28 align-middle" /> : <Amount value={value || 0} className="stat-num" compact />}
              </p>
              <p className="ppl-muted mt-1 text-xs">Added up across everyone</p>
            </div>
          ))}
          <p className="ppl-muted col-span-2 border-t border-[var(--ppl-line)] px-4 py-2.5 text-xs sm:px-5" data-testid="people-with-balance">
            {overview ? <>{withBalance} of {overview.people ?? 0} {(overview.people ?? 0) === 1 ? "person has" : "people have"} a balance</> : <Sk className="h-3.5 w-44" />}
          </p>
        </div>
        <div className="min-w-0 p-1" data-testid="people-recent">
          <h2 className="text-sm font-semibold">Latest</h2>
          {(overview?.recent || []).length === 0 ? <p className="ppl-muted mt-2 text-sm">Nothing yet. Debts and payments you record show up here.</p> : (
            <ul className="mt-2 space-y-2">
              {overview.recent.slice(0, 4).map((e, i) => (
                <li key={`${e.at_ms}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate"><span className="font-medium">{e.person}</span><span className="ppl-muted"> · {KIND_WORDS[e.kind] || e.kind}</span></span>
                  <span className={cn("stat-num shrink-0 text-xs font-semibold", e.direction === "they_owe" ? "ppl-teal" : "ppl-amber")}>{eur(e.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Directory */}
      <section aria-label="Directory" className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[12rem] flex-1">
            <Search className="ppl-muted absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden="true" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people" aria-label="Search people" className="h-10 rounded-xl bg-[var(--ppl-surface)] pl-9" data-testid="people-search" />
          </div>
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-10 w-full rounded-xl bg-[var(--ppl-surface)] sm:w-48" aria-label="Sort people" data-testid="people-sort"><SelectValue /></SelectTrigger>
            <SelectContent>{SORTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter people">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)} aria-pressed={filter === f.id} data-testid={`people-filter-${f.id}`} className="ppl-chip h-8 rounded-full px-3 text-sm font-medium">{f.label}</button>
          ))}
          <button type="button" onClick={() => { setView(view === "archived" ? "active" : "archived"); setSelected(new Set()); }} aria-pressed={view === "archived"} data-testid="people-archived-toggle"
            className="ppl-chip ml-auto inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm font-medium"><Archive className="h-3.5 w-3.5" aria-hidden="true" />Archived</button>
        </div>
        {selected.size > 0 && view === "active" && (
          <div className="ppl-solid flex items-center justify-between px-3 py-2 text-sm" data-testid="selection-bar">
            <span>{selected.size} selected</span>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelected(new Set())} data-testid="clear-selection">Clear selection</Button>
              <Button size="sm" className="ppl-btn-danger h-8" onClick={() => setDeleteTargets(source.filter((p) => selected.has(p.id)))} data-testid="bulk-delete-btn"><Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Delete</Button>
            </div>
          </div>
        )}

        {peopleError && !people ? (
          <ErrorBlock what="the people" onRetry={reloadPeople} className="ppl-solid" />
        ) : loading && !people ? (
          // The list's own shape: a checkbox cell, the avatar and a name, the two balance columns, the two action buttons.
          <Busy label="Loading people" className="ppl-solid divide-y divide-[var(--ppl-line)]">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} aria-hidden="true" className={cn("grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4", COLUMNS)}>
                <Sk className="h-4 w-4 justify-self-center" />
                <div className="flex min-w-0 items-center gap-3"><Sk className="h-10 w-10 shrink-0 !rounded-full" /><Sk className={i % 2 ? "h-4 w-32" : "h-4 w-40"} /></div>
                <div className="col-start-2 grid grid-cols-2 gap-3 sm:contents"><Sk className="h-8 w-24" /><Sk className="h-8 w-24" /></div>
                <div className="col-start-2 flex gap-1.5 sm:col-start-auto sm:justify-end"><Sk className="h-8 w-16 !rounded-lg" /><Sk className="h-8 w-24 !rounded-lg" /></div>
              </div>
            ))}
          </Busy>
        ) : rows.length === 0 ? (
          <div className="ppl-solid flex flex-col items-center px-6 py-14 text-center">
            <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl" style={{ background: "var(--ppl-teal-tint)" }}><Users className="ppl-teal h-6 w-6" aria-hidden="true" /></span>
            <p className="font-semibold">{source.length === 0 ? (view === "archived" ? "No archived people" : "No one here yet") : "No one matches"}</p>
            <p className="ppl-muted mt-1 max-w-sm text-sm">{source.length === 0 ? (view === "archived" ? "People you delete are kept here, with their history, until you restore them." : "Add the first person to start keeping track of who owes what.") : "Try another search or filter."}</p>
            {source.length === 0 && view === "active" && <Button onClick={startAdd} className="ppl-btn-primary mt-5 rounded-xl"><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Add person</Button>}
          </div>
        ) : (
          <div className="ppl-solid overflow-hidden">
            <div className={cn("ppl-muted hidden items-center gap-3 border-b border-[var(--ppl-line)] px-4 py-2 text-xs font-medium sm:grid", COLUMNS)} aria-hidden="true">
              <span /><span>Person</span><span>They owe you</span><span>You owe</span><span />
            </div>
            <ul className="divide-y divide-[var(--ppl-line)]" data-testid="people-list">
              <AnimatePresence initial={false}>
                {rows.map((p, i) => (
                  <motion.li key={p.id} layout={!reduce} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease: EASE, delay: reduce ? 0 : Math.min(i, 8) * 0.02 }} data-testid={`person-card-${p.id}`}
                    className={cn("ppl-row grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-3 py-3 sm:px-4", COLUMNS)}>
                    <span className="grid h-8 w-8 place-items-center">
                      {view === "active" ? <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} aria-label={`Select ${p.name}`} data-testid={`person-select-${p.id}`} /> : <span className="h-4 w-4" />}
                    </span>
                    <button type="button" onClick={() => nav(`/people/${p.id}`)} className="flex min-w-0 items-center gap-3 rounded-lg text-left" data-testid={`person-open-${p.id}`}>
                      <span className="shrink-0"><Avatar name={p.name} photo={p.photo} size="h-10 w-10" /></span>
                      <span className="min-w-0"><span className="block truncate font-medium" data-testid="person-name">{p.name}</span>
                        {p.payment_preference && <span className="ppl-muted block truncate text-xs">Pays by {p.payment_preference}</span>}
                        {p.other_currencies?.map((o) => (
                          <span key={o.currency} className="ppl-muted block truncate text-xs" data-testid={`other-currency-${o.currency}`}>
                            {[o.owes_me > 0 && `owes you ${eur(o.owes_me, o.currency)}`, o.i_owe > 0 && `you owe ${eur(o.i_owe, o.currency)}`].filter(Boolean).join(" · ")} in {o.currency}
                          </span>
                        ))}</span>
                    </button>
                    <div className="col-start-2 grid grid-cols-2 gap-3 sm:contents">
                      {p.owes_me > 0 || p.i_owe > 0 ? (
                        <>
                          <Cell direction="they_owe" amount={p.owes_me} name={p.name} />
                          <Cell direction="i_owe" amount={p.i_owe} name={p.name} />
                        </>
                      ) : <p className="ppl-muted col-span-2 text-sm">{p.other_currencies?.length ? `Settled in ${mainCurrency()}` : "Settled"}</p>}
                    </div>
                    <div className="col-start-2 flex gap-1.5 sm:col-start-auto sm:justify-end">
                      {view === "active" ? (
                        <>
                          <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={() => setDebtDialog({ kind: "add", person: p })} data-testid={`person-add-debt-${p.id}`}><Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Debt</Button>
                          <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={() => setDebtDialog({ kind: "payment", person: p })} data-testid={`person-payment-${p.id}`}><HandCoins className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Payment</Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(p)} aria-label={`Edit ${p.name}`} data-testid={`person-edit-${p.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="ppl-amber h-8 w-8" onClick={() => setDeleteTargets([p])} aria-label={`Delete ${p.name}`} data-testid={`person-delete-${p.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={async () => { try { await api.post(`/debts/people/${p.id}/restore`, null, { headers: { "Idempotency-Key": newKey() } }); refreshAll(["/people", "/debts"]); toast.success(`${p.name} is back`); } catch (err) { toast.error(errorMessage(err, "Could not restore")); } }} data-testid={`person-restore-${p.id}`}>Restore</Button>
                      )}
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </div>
        )}
      </section>

      <PersonProfile personId={profileId} onClose={() => nav("/people")} onEdit={startEdit}
        onDelete={(person, balances) => setDeleteTargets([{ ...person, owes_me: balances?.they_owe || 0, i_owe: balances?.i_owe || 0 }])} onAction={openDebt} />
      <DebtDialog state={debtDialog} onClose={() => setDebtDialog(null)} />

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="ppl-theme ppl-glass !bg-[var(--ppl-surface)] max-w-md" data-testid="person-form">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit person" : "Add person"}</DialogTitle>
            <DialogDescription className="ppl-muted">Notes and how they usually pay make settling up easier.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-3">
            <div><Label htmlFor="person-name" className="text-xs">Name</Label><Input id="person-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} data-testid="person-name-input" autoFocus /></div>
            <div><Label htmlFor="person-pref" className="text-xs">Usually pays by</Label><Input id="person-pref" value={form.payment_preference} onChange={(e) => setForm((f) => ({ ...f, payment_preference: e.target.value }))} placeholder="e.g. MB WAY" data-testid="person-pref-input" /></div>
            <div><Label htmlFor="person-notes" className="text-xs">Notes</Label><Textarea id="person-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} data-testid="person-notes-input" /></div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)} data-testid="person-form-cancel">Cancel</Button>
              <Button type="submit" disabled={!form.name.trim() || saving} className="ppl-btn-primary" data-testid="person-form-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Save"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
