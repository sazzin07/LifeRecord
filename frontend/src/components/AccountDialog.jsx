import { useEffect, useState } from "react";
import { BadgeInfo } from "lucide-react";
import { api, errorMessage, eur } from "@/lib/api";
import { planAllocation, NEW_MONEY_LABEL } from "@/lib/allocation";
import { refreshAll } from "@/lib/useFetch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Hint } from "@/components/ui/hint";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

/** Accounts as a tree: top-level places (bank, cash, Revolut) with their sub-places. */
export function buildAccountTree(accounts) {
  const byId = {};
  accounts.forEach((a) => { byId[a.id] = { ...a, children: [] }; });
  const roots = [];
  accounts.forEach((a) => {
    if (a.parent_id && byId[a.parent_id]) {
      byId[a.parent_id].children.push(byId[a.id]);
    } else {
      roots.push(byId[a.id]);
    }
  });
  return { roots, byId };
}

export const canHaveSubPlaces = (a) => a.type === "cash" || a.type === "revolut";

const EMPTY = { name: "", type: "cash_place", parent_id: "", opening_balance: "", initial_balance: "", is_locked: false, currency: "EUR", add_as_new_money: false };

/**
 * Create a sub-place under `parent`, or edit `account`. `parents` are the places a new sub-place may go under.
 * Shared by the Money page and Settings so both behave the same.
 */
export function AccountDialog({ open, setOpen, account = null, parent = null, parents = [] }) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (account) {
      setForm({
        name: account.name,
        type: account.type,
        parent_id: account.parent_id || "",
        opening_balance: account.balance ?? account.opening_balance ?? "",
        initial_balance: account.initial_balance ?? "",
        is_locked: !!account.is_locked,
        currency: account.currency || "EUR",
        add_as_new_money: false,
      });
    } else {
      setForm({ ...EMPTY, type: parent?.type === "revolut" ? "revolut_space" : "cash_place", parent_id: parent?.id || "" });
    }
  }, [open, account, parent]);

  // The main account whose money this place is a part of, and what saving would do to it.
  const host = account ? (account.parent_id ? parents.find((p) => p.id === account.parent_id) : null) : (parents.find((p) => p.id === form.parent_id) || parent);
  const isMain = !!account && !account.parent_id;
  const plan = planAllocation({ account, host, amount: form.opening_balance, newMoney: form.add_as_new_money });

  const save = async () => {
    if (!form.name.trim()) { toast.error("Give the place a name"); return; }
    if (plan.error) { toast.error(plan.text); return; }
    const chosenParent = parents.find((p) => p.id === form.parent_id);
    const payload = {
      name: form.name.trim(),
      type: account ? form.type : chosenParent?.type === "revolut" ? "revolut_space" : "cash_place",
      parent_id: form.parent_id || null,
      currency: form.currency || "EUR",
      initial_balance: form.initial_balance === "" ? null : parseFloat(form.initial_balance || "0"),
      is_locked: !!form.is_locked,
      sort_order: 0,
      is_active: true,
    };
    // The form field is the current balance: when editing, let the server work out the opening balance.
    const amount = parseFloat(form.opening_balance || "0");
    if (account) payload.balance = amount;
    else payload.opening_balance = amount;
    if (host) payload.add_as_new_money = !!form.add_as_new_money;
    setSaving(true);
    try {
      if (account) {
        await api.put(`/accounts/${account.id}`, payload);
        toast.success("Updated");
      } else {
        await api.post("/accounts", payload);
        toast.success("Created");
      }
      setOpen(false);
      refreshAll();
    } catch (err) {
      toast.error(errorMessage(err, "Could not save account"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="mny-dialog max-w-md" data-testid="account-dialog">
        <DialogHeader>
          <DialogTitle>{account ? "Edit place" : "Add place"}</DialogTitle>
          <DialogDescription>{account ? "Update the name and balance." : "Set money aside in a new place under the selected location."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <Label className="mny-muted text-xs" htmlFor="account-name">Name</Label>
            <Input id="account-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Wallet" data-testid="account-name" className="mny-field" />
          </div>
          <div>
            <Label className="mny-muted text-xs" htmlFor="account-balance">{isMain && account.allocated_balance > 0 ? "Total balance, including sub-accounts (€)" : host ? (account ? "Balance (€)" : "Amount to set aside (€)") : "Current balance (€)"}</Label>
            <Input id="account-balance" type="number" min={0} step="0.01" value={form.opening_balance} onChange={(e) => setForm((f) => ({ ...f, opening_balance: e.target.value }))} placeholder="0.00" data-testid="account-balance" aria-describedby="account-allocation" className="mny-field" />
          </div>
          {host && plan.showNewMoney && (
            <div className="flex items-center gap-2">
              <Checkbox id="add-new-money" checked={!!form.add_as_new_money} onCheckedChange={(c) => setForm((f) => ({ ...f, add_as_new_money: c === true }))} data-testid="account-new-money" />
              <Label htmlFor="add-new-money" className="mny-title text-xs">{NEW_MONEY_LABEL}</Label>
            </div>
          )}
          <p id="account-allocation" role={plan.error ? "alert" : undefined} aria-live={plan.error ? undefined : "polite"} data-testid="account-allocation"
            className={plan.error ? "mny-neg text-xs" : "mny-muted text-xs"}>
            {plan.text || (host && !account ? `Unchecked: the money comes out of ${host.name} › ${host.favorite_place_name || "its favorite place"} (${eur(host.favorite_place_balance ?? host.unallocated_balance ?? 0)}), so its total does not change.` : "")}
          </p>
          {account?.type === "bank" && (
            <div>
              <Label className="mny-muted text-xs flex items-center gap-1">Initial bank balance (€) <Hint label="Used to calculate money that left the bank"><span className="inline-flex"><BadgeInfo className="h-3 w-3" aria-label="More info" /></span></Hint></Label>
              <Input type="number" min={0} step="0.01" value={form.initial_balance} onChange={(e) => setForm((f) => ({ ...f, initial_balance: e.target.value }))} placeholder="0.00" className="mny-field" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Checkbox id="is-locked" checked={!!form.is_locked} onCheckedChange={(c) => setForm((f) => ({ ...f, is_locked: c === true }))} />
            <Label htmlFor="is-locked" className="mny-title text-xs">Locked / not freely available</Label>
          </div>
          {!account && (
            <div>
              <Label className="mny-muted text-xs">Parent location</Label>
              <Select value={form.parent_id} onValueChange={(v) => setForm((f) => ({ ...f, parent_id: v }))}>
                <SelectTrigger className="mny-field" aria-label="Parent location" data-testid="account-parent"><SelectValue placeholder="Select parent" /></SelectTrigger>
                <SelectContent>
                  {parents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className="mny-pill" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className="mny-pill mny-cta" onClick={save} disabled={saving || plan.error} data-testid="account-save">Save</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
