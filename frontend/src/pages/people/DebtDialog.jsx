import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api, eur } from "@/lib/api";
import { orderAccounts, defaultSpendAccount } from "@/lib/allocation";
import { changeDebt, errorMessage, I, newKey, THEY, undoChange } from "@/lib/debts";
import { refreshAll } from "@/lib/useFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NO_ACCOUNT = "__none__";
const METHODS = ["Cash", "MB WAY", "Revolut", "Other"];

const COPY = {
  add: { title: "Add debt", cta: "Add debt", hint: "Written down only: no expense and no payment is created." },
  reduce: { title: "Reduce debt", cta: "Reduce", hint: "Lowers what is owed without a payment. If money changed hands, record a payment instead." },
  correct: { title: "Correct the balance", cta: "Correct", hint: "Sets the balance to the right figure. The earlier lines stay in the history." },
  clear: { title: "Clear debt", cta: "Clear debt", hint: "Removes the amount without a payment. Nothing is erased: it stays in the cleared items, where it can be restored." },
  payment: { title: "Record a payment", cta: "Record payment", hint: "Money really changed hands. It lowers the debt it settles." },
};

/** One dialog for every change to a person's debt: add, reduce, correct, clear, payment. It sends the change with a key (a repeat
 *  cannot apply it twice), shows what the server saved, and offers Undo. A payment larger than the debt asks what the extra is. */
export function DebtDialog({ state, onClose, onDone }) {
  const { person, kind, direction: startDirection } = state || {};
  const open = !!state;
  const [direction, setDirection] = useState(THEY);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [account, setAccount] = useState(NO_ACCOUNT);
  const [method, setMethod] = useState("Other");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [ask, setAsk] = useState(null);        // the server asked what the extra of an overpayment is
  const [accounts, setAccounts] = useState([]);
  const attempt = useRef(newKey());

  useEffect(() => {
    if (!open) return;
    setDirection(startDirection || THEY); setAmount(kind === "correct" && state.current != null ? String(state.current) : ""); setNote(""); setProblem(""); setAsk(null);
    attempt.current = newKey();
    if (kind === "payment") {
      api.get("/accounts").then((r) => {
        const list = r.data.filter((a) => a.type !== "owed" && a.type !== "owed_person");
        setAccounts(list);
        setAccount(defaultSpendAccount(list)?.id || NO_ACCOUNT);
      }).catch(() => setAccounts([]));
    }
  }, [open, kind, startDirection, state]);

  const options = useMemo(() => orderAccounts(accounts), [accounts]);
  const copy = COPY[kind] || COPY.add;
  const owed = direction === THEY ? person?.owes_me : person?.i_owe;
  const noAmount = kind === "clear";
  const amountOk = noAmount || (kind === "correct" ? amount !== "" && Number(amount) >= 0 : Number(amount) > 0);

  const submit = async (e, excess) => {
    e?.preventDefault();
    if (busy || !amountOk) return;
    setBusy(true); setProblem("");
    try {
      let body;
      if (kind === "payment") {
        body = { direction: direction === THEY ? "in" : "out", amount: Number(amount), method, description: note || undefined, excess: excess || undefined };
        if (account !== NO_ACCOUNT) body.account = account;
      } else if (kind === "clear") {
        body = { direction, description: note || undefined };
      } else if (kind === "correct") {
        body = { direction, new_amount: Number(amount), description: note || undefined };
      } else {
        body = { direction, amount: Number(amount), description: note || undefined };
      }
      const result = await changeDebt(person.id, kind, body, attempt.current);
      if (result.needs_excess_choice) { setAsk(result); attempt.current = newKey(); return; }
      refreshAll(["/people", "/debts", "/accounts", "/analytics", "/transactions"]);
      onDone?.(result);
      onClose();
      toast.success(result.message, {
        duration: 9000,
        action: { label: "Undo", onClick: async () => { try { await undoChange(result); refreshAll(["/people", "/debts", "/accounts", "/analytics", "/transactions"]); onDone?.(); toast.success("Undone"); } catch (err) { toast.error(errorMessage(err, "Could not undo")); } } },
      });
    } catch (err) {
      setProblem(errorMessage(err, "That did not work. Nothing was changed."));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent className="ppl-theme ppl-glass max-w-md" data-testid="debt-dialog">
        <DialogHeader>
          <DialogTitle>{copy.title}{person ? ` · ${person.name}` : ""}</DialogTitle>
          <DialogDescription className="ppl-muted">{copy.hint}</DialogDescription>
        </DialogHeader>
        {open && (
          <form onSubmit={submit} className="space-y-4">
            {!startDirection && (
              <div role="radiogroup" aria-label="Which way" className="grid grid-cols-2 gap-1.5 rounded-xl bg-[var(--ppl-surface-2)] p-1">
                {[[THEY, "They owe me"], [I, "I owe them"]].map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={direction === value} onClick={() => setDirection(value)} data-testid={`debt-direction-${value}`}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${direction === value ? "bg-[var(--ppl-surface)] shadow-sm" : "ppl-muted"}`}>{label}</button>
                ))}
              </div>
            )}
            {startDirection && <p className="text-sm font-medium" data-testid="debt-direction-label">{startDirection === THEY ? `${person?.name} owes you` : `You owe ${person?.name}`} {eur(owed || 0)}</p>}
            {!noAmount && (
              <div>
                <Label htmlFor="debt-amount" className="text-xs">{kind === "correct" ? "What it should be now (€)" : "Amount (€)"}</Label>
                <Input id="debt-amount" inputMode="decimal" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus placeholder="0.00" data-testid="debt-amount" />
              </div>
            )}
            {kind === "payment" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs">Recorded in</Label>
                  <Select key={`${options.length}-${account}`} value={account} onValueChange={setAccount}>
                    <SelectTrigger aria-label="Account" data-testid="debt-account"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ACCOUNT}>Don't record in my accounts</SelectItem>
                      {options.map((a) => <SelectItem key={a.id} value={a.id}>{a.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">How</Label>
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger aria-label="Payment method" data-testid="debt-method"><SelectValue /></SelectTrigger>
                    <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <div>
              <Label htmlFor="debt-note" className="text-xs">Note (optional)</Label>
              <Input id="debt-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder={kind === "clear" ? "Why, if you like" : "e.g. dinner on Friday"} data-testid="debt-note" />
            </div>

            {ask && (
              <div role="group" aria-label="What is the extra?" className="ppl-solid p-3 text-sm" data-testid="debt-excess">
                <p className="font-medium">{eur(ask.excess)} more than is owed ({eur(ask.outstanding)}). What is the extra?</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={(e) => submit(e, "opposite")} data-testid="debt-excess-opposite">{ask.options?.find((o) => o.value === "opposite")?.label || "A debt the other way"}</Button>
                  <Button type="button" variant="outline" size="sm" disabled={busy} onClick={(e) => submit(e, "tip")} data-testid="debt-excess-tip">{ask.options?.find((o) => o.value === "tip")?.label || "A tip or gift, no debt"}</Button>
                </div>
              </div>
            )}

            <p role="alert" className="min-h-[1.25rem] text-sm ppl-amber" data-testid="debt-error">{problem}</p>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy || !amountOk || !!ask} data-testid="debt-submit"
                className={kind === "clear" ? "ppl-btn-danger" : "ppl-btn-primary"}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : copy.cta}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
