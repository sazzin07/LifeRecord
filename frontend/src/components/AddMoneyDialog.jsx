import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage, eur } from "@/lib/api";
import { currencyStep, currencySymbol } from "@/lib/money";
import { refreshAll } from "@/lib/useFetch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Put money into an account without editing its whole balance: choose the place it lands in, say how much, done. It is recorded as income, so it
 *  shows in the history and the totals. `options` are the places (and accounts without places), "Main › Place"; `defaultId` preselects one. */
export function AddMoneyDialog({ open, setOpen, options, defaultId }) {
  const [where, setWhere] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAmount(""); setNote("");
    setWhere((defaultId && options.some((o) => o.id === defaultId)) ? defaultId : (options.find((o) => o.is_favorite) || options[0])?.id || "");
  }, [open, defaultId, options]);

  const target = useMemo(() => options.find((o) => o.id === where), [options, where]);
  const typed = Number(amount);
  const ok = !!target && typed > 0 && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    try {
      await api.post("/transactions/income", { account: where, account_id: where, amount: typed, description: note.trim() || "Money added" });
      toast.success(`${eur(typed, target.currency)} added to ${target.label}`);
      setOpen(false);
      refreshAll();
    } catch (err) { toast.error(errorMessage(err, "Could not add the money")); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="mny-theme mny-dialog max-w-md" data-testid="add-money-dialog">
        <DialogHeader>
          <DialogTitle>Add money</DialogTitle>
          <DialogDescription>Money that comes in (a salary, a gift, cash from a friend). It lands in the place you choose and shows in your history.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-2 space-y-3">
          <div>
            <Label className="mny-muted text-xs">Where does it go?</Label>
            <Select value={where} onValueChange={setWhere}>
              <SelectTrigger className="mny-field" aria-label="Where the money goes" data-testid="add-money-where"><SelectValue placeholder="Choose a place" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.label} · {eur(o.balance, o.currency)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mny-muted text-xs" htmlFor="add-money-amount">Amount ({currencySymbol(target?.currency)})</Label>
            <Input id="add-money-amount" type="number" min={currencyStep(target?.currency)} step={currencyStep(target?.currency)} value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00" autoFocus className="mny-field" data-testid="add-money-amount" aria-describedby="add-money-preview" />
            <p id="add-money-preview" data-testid="add-money-preview" className="mny-muted mt-1.5 text-xs">
              {target && typed > 0 ? `${target.label} goes from ${eur(target.balance, target.currency)} to ${eur((Number(target.balance) || 0) + typed, target.currency)}.` : "Choose where it goes and how much."}
            </p>
          </div>
          <div>
            <Label className="mny-muted text-xs" htmlFor="add-money-note">Note (optional)</Label>
            <Input id="add-money-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Salary, birthday" className="mny-field" data-testid="add-money-note" />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="mny-pill" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="mny-pill mny-cta" disabled={!ok} data-testid="add-money-submit">Add money</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
