import { useEffect, useState } from "react";
import { BadgeInfo } from "lucide-react";
import { api } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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

const EMPTY = { name: "", type: "cash_place", parent_id: "", opening_balance: "", initial_balance: "", is_locked: false, currency: "EUR" };

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
      });
    } else {
      setForm({ ...EMPTY, type: parent?.type === "revolut" ? "revolut_space" : "cash_place", parent_id: parent?.id || "" });
    }
  }, [open, account, parent]);

  const save = async () => {
    if (!form.name.trim()) { toast.error("Give the place a name"); return; }
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
      toast.error(err.response?.data?.detail || "Could not save account");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md" data-testid="account-dialog">
        <DialogHeader>
          <DialogTitle>{account ? "Edit place" : "Add place"}</DialogTitle>
          <DialogDescription>{account ? "Update the name and balance." : "Create a new money place under the selected location."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div>
            <Label className="text-xs" htmlFor="account-name">Name</Label>
            <Input id="account-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Wallet" data-testid="account-name" />
          </div>
          <div>
            <Label className="text-xs" htmlFor="account-balance">Current balance (€)</Label>
            <Input id="account-balance" type="number" min={0} step="0.01" value={form.opening_balance} onChange={(e) => setForm((f) => ({ ...f, opening_balance: e.target.value }))} placeholder="0.00" data-testid="account-balance" />
          </div>
          {account?.type === "bank" && (
            <div>
              <Label className="text-xs flex items-center gap-1">Initial bank balance (€) <Hint label="Used to calculate money that left the bank"><span className="inline-flex"><BadgeInfo className="h-3 w-3" aria-label="More info" /></span></Hint></Label>
              <Input type="number" min={0} step="0.01" value={form.initial_balance} onChange={(e) => setForm((f) => ({ ...f, initial_balance: e.target.value }))} placeholder="0.00" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Checkbox id="is-locked" checked={!!form.is_locked} onCheckedChange={(c) => setForm((f) => ({ ...f, is_locked: c === true }))} />
            <Label htmlFor="is-locked" className="text-xs">Locked / not freely available</Label>
          </div>
          {!account && (
            <div>
              <Label className="text-xs">Parent location</Label>
              <Select value={form.parent_id} onValueChange={(v) => setForm((f) => ({ ...f, parent_id: v }))}>
                <SelectTrigger aria-label="Parent location" data-testid="account-parent"><SelectValue placeholder="Select parent" /></SelectTrigger>
                <SelectContent>
                  {parents.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="account-save">Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
