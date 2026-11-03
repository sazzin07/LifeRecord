import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Lock, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { api, CATEGORY_COLORS, eur, errorMessage } from "@/lib/api";
import { useSettings } from "@/context/SettingsContext";
import { refreshAll } from "@/lib/useFetch";
import { AccountDialog, buildAccountTree, canHaveSubPlaces } from "@/components/AccountDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Row, SavedBadge, Section, Segmented } from "@/components/settings/controls";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const PERIODS = [{ value: "week", label: "Last 7 days" }, { value: "day", label: "Today" }, { value: "all", label: "All time" }];
const COLORS = Object.values(CATEGORY_COLORS);

function Places({ accounts }) {
  const [dialog, setDialog] = useState({ open: false, account: null, parent: null });
  const [deleteId, setDeleteId] = useState(null);
  const { roots } = useMemo(() => buildAccountTree((accounts || []).filter((a) => a.type !== "owed" && a.type !== "owed_person")), [accounts]);
  const toDelete = (accounts || []).find((a) => a.id === deleteId);

  const remove = async (id) => {
    try {
      await api.delete(`/accounts/${id}`);
      toast.success("Place deleted");
      refreshAll();
    } catch (err) {
      toast.error(errorMessage(err, "Could not delete the place"));
    } finally {
      setDeleteId(null);
    }
  };

  const row = (a, child) => (
    <motion.div layout key={a.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
      className={cn("mny-row flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm", child && "ml-5")} data-testid={`settings-account-${a.id}`}>
      <span className={cn("flex min-w-0 flex-1 items-center gap-1.5", child ? "mny-muted" : "mny-title font-medium")}>
        <span className="truncate">{a.name}</span>{a.is_locked && <Lock className="mny-amber h-3 w-3 shrink-0" aria-label="Locked" />}
      </span>
      <span className="mny-num mny-title shrink-0 font-semibold">{eur(a.balance)}</span>
      <button type="button" className="mny-icon-btn" aria-label={`Edit ${a.name}`} onClick={() => setDialog({ open: true, account: a, parent: null })}><Pencil className="h-3.5 w-3.5" /></button>
      {child
        ? <button type="button" className="mny-icon-btn danger" aria-label={`Delete ${a.name}`} onClick={() => setDeleteId(a.id)}><Trash2 className="h-3.5 w-3.5" /></button>
        : <span className="h-8 w-8" aria-hidden="true" />}
    </motion.div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="mny-title text-sm font-medium">Money places</p>
          <p className="mny-muted text-sm">Bank, cash, Revolut and the places inside them.</p>
        </div>
        <button type="button" className="mny-pill sm" onClick={() => setDialog({ open: true, account: null, parent: roots.find(canHaveSubPlaces) || null })} data-testid="settings-add-place"><Plus className="h-3.5 w-3.5" aria-hidden="true" />Add place</button>
      </div>
      <div className="mt-3 space-y-0.5">
        {accounts === null && [0, 1, 2].map((i) => <div key={i} className="skeleton my-1.5 h-8 rounded-lg" aria-hidden="true" />)}
        <AnimatePresence initial={false}>
          {roots.map((r) => (
            <motion.div key={r.id} layout className="mny-hair border-b py-1 last:border-b-0">
              {row(r, false)}
              <AnimatePresence initial={false}>{r.children.map((c) => row(c, true))}</AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <p className="mny-muted mt-3 text-xs">Deleting a place gives its money back to its main account. Moving money between places is on the Money page.</p>
      <AccountDialog open={dialog.open} setOpen={(o) => setDialog((d) => ({ ...d, open: o }))} account={dialog.account} parent={dialog.parent} parents={roots.filter(canHaveSubPlaces)} />
      <ConfirmDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }} title="Delete place?"
        description={toDelete ? `"${toDelete.name}" will be removed. The ${eur(toDelete.balance)} in it goes back to its main account. Its past transactions stay in your history.` : "This place will be removed."}
        onConfirm={() => deleteId && remove(deleteId)} confirmText="Delete place" variant="danger" />
    </div>
  );
}

function Categories({ cats }) {
  const [name, setName] = useState("");
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);       // { id, name, budget }
  const [editError, setEditError] = useState("");
  const [del, setDel] = useState(null);

  const budgetValue = (v) => (String(v).trim() === "" ? null : Math.max(0, parseFloat(v) || 0));

  const add = async (e) => {
    e?.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await api.post("/categories", { name: name.trim(), monthly_budget: budgetValue(budget), color: COLORS[(cats?.length || 0) % COLORS.length] });
      setName(""); setBudget("");
      refreshAll();
      toast.success("Category added");
    } catch (err) { toast.error(errorMessage(err, "Could not add the category")); } finally { setBusy(false); }
  };

  const save = async (e) => {
    e.preventDefault();
    const c = (cats || []).find((x) => x.id === edit.id);
    if (!c) return;
    setBusy(true); setEditError("");
    try {
      await api.put(`/categories/${c.id}`, { name: edit.name.trim(), icon: c.icon, color: c.color, monthly_budget: budgetValue(edit.budget) });
      setEdit(null);
      refreshAll();
      toast.success("Category saved");
    } catch (err) { setEditError(errorMessage(err, "Could not save the category")); } finally { setBusy(false); }
  };

  const remove = async () => {
    const c = del; setDel(null);
    try { await api.delete(`/categories/${c.id}`); refreshAll(); toast.success(`"${c.name}" deleted`); }
    catch (err) { toast.error(errorMessage(err, "Could not delete the category")); }
  };

  return (
    <div>
      <p className="mny-title text-sm font-medium">Categories and monthly budgets</p>
      <p className="mny-muted text-sm">Every expense belongs to one category. A budget is a monthly target the Money page tracks.</p>
      <form onSubmit={add} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input placeholder="New category" aria-label="New category name" value={name} onChange={(e) => setName(e.target.value)} className="mny-field h-10 flex-1" data-testid="category-input" maxLength={60} />
        <Input type="number" min={0} step="0.01" inputMode="decimal" placeholder="Budget € (optional)" aria-label="Monthly budget in euros" value={budget} onChange={(e) => setBudget(e.target.value)} className="mny-field h-10 sm:w-44" data-testid="category-budget-input" />
        <button type="submit" disabled={!name.trim() || busy} aria-label="Add category" className="mny-pill mny-cta h-10" data-testid="category-add"><Plus className="h-4 w-4" aria-hidden="true" />Add</button>
      </form>
      <ul className="mt-4 space-y-1.5" data-testid="category-list">
        {cats === null && [0, 1, 2, 3].map((i) => <li key={i} className="skeleton h-11 rounded-xl" aria-hidden="true" />)}
        <AnimatePresence initial={false} mode="popLayout">
          {(cats || []).map((c) => (
            <motion.li layout key={c.id} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              className="mny-tile mny-row flex items-center gap-3 px-3 py-2" data-testid={`category-${c.name}`}>
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.color || CATEGORY_COLORS[c.name] || "#94A3B8" }} aria-hidden="true" />
              <span className="mny-title min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
              <span className="mny-num mny-muted shrink-0 text-xs">{c.monthly_budget ? `${eur(c.monthly_budget)} / month` : "No budget"}</span>
              <button type="button" className="mny-icon-btn" aria-label={`Edit ${c.name} category`} onClick={() => { setEditError(""); setEdit({ id: c.id, name: c.name, budget: c.monthly_budget ?? "" }); }}><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" className="mny-icon-btn danger" aria-label={`Delete ${c.name} category`} onClick={() => setDel(c)}><Trash2 className="h-3.5 w-3.5" /></button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      <Dialog open={!!edit} onOpenChange={(o) => !o && !busy && setEdit(null)}>
        <DialogContent className="max-w-md" data-testid="category-dialog">
          <DialogHeader>
            <DialogTitle>Edit category</DialogTitle>
            <DialogDescription>Renaming also renames it on every past transaction, so your history stays together.</DialogDescription>
          </DialogHeader>
          {edit && (
            <form onSubmit={save} className="space-y-3">
              <div>
                <label htmlFor="cat-name" className="text-sm font-medium">Name</label>
                <Input id="cat-name" autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="mt-1" maxLength={60} data-testid="category-edit-name" />
              </div>
              <div>
                <label htmlFor="cat-budget" className="text-sm font-medium">Monthly budget (€)</label>
                <Input id="cat-budget" type="number" min={0} step="0.01" inputMode="decimal" placeholder="No budget" value={edit.budget} onChange={(e) => setEdit({ ...edit, budget: e.target.value })} className="mt-1" data-testid="category-edit-budget" />
              </div>
              <p role="alert" className="min-h-[1.25rem] text-sm text-red-700 dark:text-red-400">{editError}</p>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => setEdit(null)} disabled={busy}>Cancel</Button>
                <Button type="submit" disabled={!edit.name.trim() || busy} className="bg-emerald-700 text-white hover:bg-emerald-800" data-testid="category-edit-save">Save</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} title="Delete this category?"
        description={del ? `"${del.name}" is removed from your list${del.monthly_budget ? ` and its ${eur(del.monthly_budget)} monthly budget is dropped` : ""}. Past transactions keep the name "${del.name}" but it will no longer be a category you can pick or budget.` : ""}
        onConfirm={remove} confirmText="Delete category" variant="danger" />
    </div>
  );
}

export function MoneySettings({ index, accounts, cats }) {
  const { moneyPeriod, setMoneyPeriod } = useSettings();
  return (
    <Section id="money" index={index} icon={Wallet} title="Money" description="What the Money page opens on, your places and your categories." aside={<SavedBadge />}>
      <Row title="Money opens on" description="The period you see first. You can still switch it on the page.">
        <Segmented label="Money opens on" value={moneyPeriod} onChange={setMoneyPeriod} options={PERIODS} testid="money-period" />
      </Row>
      <div className="mny-hair mt-4 border-t pt-4"><Places accounts={accounts} /></div>
      <div className="mny-hair mt-4 border-t pt-4"><Categories cats={cats} /></div>
    </Section>
  );
}

