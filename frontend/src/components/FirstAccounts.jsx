import { useState } from "react";
import { Banknote, Building2, CreditCard, Loader2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { Card } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

const CHOICES = [
  { type: "cash", name: "Money in hand", icon: Banknote, hint: "Cash you carry. Wallets or envelopes can sit inside it later." },
  { type: "bank", name: "Bank account", icon: Building2, hint: "Your main bank balance." },
  { type: "revolut", name: "Revolut", icon: CreditCard, hint: "Revolut, with spaces for savings if you use them." },
];

/** What a person with no accounts sees on Money: pick the places they keep money in and how much is there now.
 *  A new account starts with categories but no accounts, because names and balances are theirs to say. */
export function FirstAccounts() {
  const [chosen, setChosen] = useState({ cash: true, bank: false, revolut: false });
  const [balance, setBalance] = useState({ cash: "", bank: "", revolut: "" });
  const [saving, setSaving] = useState(false);

  const picked = CHOICES.filter((c) => chosen[c.type]);
  const invalid = picked.find((c) => balance[c.type] !== "" && !(parseFloat(balance[c.type]) >= 0));
  const problem = picked.length === 0 ? "Choose at least one place."
    : invalid ? `${invalid.name}: enter an amount of zero or more.` : null;

  const create = async (e) => {
    e.preventDefault();
    if (problem) return;
    setSaving(true);
    try {
      for (const c of picked) {
        await api.post("/accounts", { name: c.name, type: c.type, opening_balance: parseFloat(balance[c.type] || "0"), currency: "EUR" });
      }
      toast.success(picked.length === 1 ? "Account created" : "Accounts created");
      refreshAll();
    } catch (err) {
      toast.error(errorMessage(err, "Could not create the accounts"));
      refreshAll(); // some may have been created before the failure: show what exists
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6" data-testid="onboarding-first-account">
      <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50">Set up your money</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-xl">
        Your categories (Groceries, Bills, …) are ready. Tell Life Record where you keep money and how much is there now,
        and you can record your first expense. You can rename or add places any time in Settings.
      </p>
      <form onSubmit={create} className="mt-5 space-y-3" noValidate>
        {CHOICES.map((c) => (
          <div key={c.type} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
            <Checkbox id={`first-${c.type}`} checked={chosen[c.type]} onCheckedChange={(v) => setChosen((s) => ({ ...s, [c.type]: v === true }))}
              data-testid={`onboarding-account-${c.type}`} />
            <label htmlFor={`first-${c.type}`} className="flex flex-1 min-w-[12rem] items-center gap-2 cursor-pointer">
              <c.icon className="h-5 w-5 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <span>
                <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{c.name}</span>
                <span className="block text-xs text-slate-600 dark:text-slate-400">{c.hint}</span>
              </span>
            </label>
            <div className="w-36">
              <label htmlFor={`first-balance-${c.type}`} className="sr-only">{c.name}: amount there now, in euros</label>
              <Input id={`first-balance-${c.type}`} type="number" inputMode="decimal" min="0" step="0.01" placeholder="Amount now"
                value={balance[c.type]} disabled={!chosen[c.type]} onChange={(e) => setBalance((s) => ({ ...s, [c.type]: e.target.value }))}
                data-testid={`onboarding-balance-${c.type}`} />
            </div>
          </div>
        ))}
        <p role="alert" className="min-h-[1.25rem] text-sm text-red-700 dark:text-red-400" data-testid="onboarding-problem">{problem}</p>
        <Button type="submit" disabled={saving || !!problem} data-testid="onboarding-create"
          className="bg-emerald-700 hover:bg-emerald-800 text-white font-semibold">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Create my accounts"}
        </Button>
      </form>
    </Card>
  );
}
