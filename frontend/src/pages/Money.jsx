import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, AreaChart, Area, XAxis,
  BarChart, Bar, YAxis, CartesianGrid,
} from "recharts";
import {
  Plus, Trash2, Wallet, CreditCard, Pencil, Search, Download, ArrowUpRight,
  ArrowDownRight, TrendingUp, CalendarDays, Target, Store, X, ChevronRight,
  ChevronUp, PiggyBank, Building2, Smartphone, ArrowRightLeft, Lock,
} from "lucide-react";
import { moneyPaths } from "@/lib/periods";
import { peekQuery, fetchQuery, subscribeQuery } from "@/lib/query";
import { api, eur, CATEGORY_COLORS } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import {
  Card, StatCard, SectionHeading, EmptyState, Label, SkeletonCard, ConfidenceBadge,
} from "@/components/common";
import { ExpenseDialog } from "@/components/ExpenseDialog";
import { EditExpenseDialog } from "@/components/EditExpenseDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AccountDialog, buildAccountTree, canHaveSubPlaces } from "@/components/AccountDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Hint } from "@/components/ui/hint";

const REFUND_BADGE = {
  pending: { type: "unknown", label: "Pending" },
  partial: { type: "estimated", label: "Partly refunded" },
  settled: { type: "exact", label: "Settled" },
};

const SORTS = [
  { id: "date_desc", label: "Newest first" },
  { id: "date_asc", label: "Oldest first" },
  { id: "amount_desc", label: "Highest amount" },
  { id: "amount_asc", label: "Lowest amount" },
  { id: "merchant", label: "Merchant (A-Z)" },
];

function formatMonthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1).toLocaleString("default", { month: "long", year: "numeric" });
}

function exportCSV(rows) {
  const header = ["Date", "Type", "Merchant", "Category", "Account", "Gross", "Personal", "Reimbursable", "Refund Status", "People"];
  const lines = rows.map((t) => [
    t.date,
    t.type,
    `"${(t.merchant || t.description || "").replace(/"/g, "'")}"`,
    t.category,
    t.payment_method,
    t.gross_amount,
    t.personal_amount,
    t.reimbursable_amount,
    t.refund_status,
    (t.responsible || []).join("; "),
  ]);
  return [header, ...lines].map((l) => l.join(",")).join("\n");
}

// Effect of a transaction on the user's total money: transfers just move it around.
function signedAmount(t) {
  if (t.type === "income") return t.gross_amount;
  if (t.type === "expense") return -t.gross_amount;
  return 0;
}

function sumChildren(account) {
  if (!account) return 0;
  return account.children.reduce((s, c) => s + (c.balance || 0), 0) + (account.balance || 0);
}

export default function Money() {
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const PERIODS = [{ id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "all", label: "All Time" }];

  const [period, setPeriod] = useState("week");
  const [pm, setPm] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  // Start from the last-seen data for the default view so the page paints instantly.
  const seed = useMemo(() => {
    const m = moneyPaths("week");
    const s0 = peekQuery(m.summary);
    return s0 ? { sum: s0, txns: peekQuery(m.transactions) || [], categories: peekQuery(m.categories) || [] } : null;
  }, []);
  const [sum, setSum] = useState(seed?.sum ?? null);
  const [txns, setTxns] = useState(seed?.txns ?? []);
  const [categories, setCategories] = useState(seed?.categories ?? []);
  const [accounts, setAccounts] = useState(seed?.sum?.accounts ?? []);
  const [loading, setLoading] = useState(!seed);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editTxn, setEditTxn] = useState(null);
  const [deleteTxnId, setDeleteTxnId] = useState(null);
  const [deleteTxnOpen, setDeleteTxnOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [sort, setSort] = useState("date_desc");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetForm, setBudgetForm] = useState({});
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferDefaults, setTransferDefaults] = useState({ to: "" });
  const [accountDialog, setAccountDialog] = useState({ open: false, account: null, parent: null });
  const [deleteAccountId, setDeleteAccountId] = useState(null);
  const scrollRef = useRef(null);

  const load = useCallback(async ({ force = true } = {}) => {
    const m = moneyPaths(period, pm);
    // Switching filter: show that filter's last-seen data right away if we have it.
    const cs = peekQuery(m.summary);
    if (cs) { setSum(cs); setAccounts(cs.accounts || []); const ct = peekQuery(m.transactions); if (ct) setTxns(ct); }
    else setLoading(true);
    try {
      const [s, t, c] = await Promise.all([
        fetchQuery(m.summary, { force }),
        fetchQuery(m.transactions, { force }),
        fetchQuery(m.categories, { force }),
      ]);
      setSum(s);
      setTxns(t);
      setCategories(c);
      setAccounts(s.accounts || []);
    } finally { setLoading(false); }
  }, [period, pm]);

  useEffect(() => {
    const m = moneyPaths(period, pm);
    const unsubs = [m.summary, m.transactions, m.categories].map(subscribeQuery);
    load({ force: false });
    const h = () => load({ force: true });
    window.addEventListener("lm:refresh", h);
    return () => { window.removeEventListener("lm:refresh", h); unsubs.forEach((u) => u()); };
  }, [load, period, pm]);

  const del = async (id) => {
    await api.delete(`/transactions/${id}`);
    toast.success("Deleted");
    refreshAll();
  };
  const txnToDelete = txns.find((t) => t.id === deleteTxnId);

  const { roots: accountRoots, byId: accountById } = useMemo(() => buildAccountTree(accounts), [accounts]);
  const accountName = (id) => accountById[id]?.name || id || "";

  const mainAccounts = useMemo(() => {
    const find = (type) => accountRoots.find((a) => a.type === type) || null;
    return {
      bank: find("bank"),
      cash: find("cash"),
      revolut: find("revolut"),
    };
  }, [accountRoots]);

  const months = useMemo(() => {
    const base = (sum?.months || []).map((k) => ({ key: k, label: formatMonthLabel(k) }));
    if (!base.some((m) => m.key === curYM)) base.unshift({ key: curYM, label: formatMonthLabel(curYM) });
    return base.sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [sum, curYM]);

  const filteredExpenses = useMemo(() => {
    let rows = typeFilter === "all" ? [...txns] : txns.filter((t) => t.type === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((t) =>
        (t.merchant || "").toLowerCase().includes(q) ||
        (t.description || "").toLowerCase().includes(q) ||
        (t.category || "").toLowerCase().includes(q) ||
        (t.responsible || []).some((p) => p.toLowerCase().includes(q))
      );
    }
    if (catFilter !== "all") rows = rows.filter((t) => t.category === catFilter);
    const label = (t) => t.merchant || t.description || "";
    rows.sort((a, b) => {
      if (sort === "date_desc") return b.date.localeCompare(a.date) || (b.created_at || "").localeCompare(a.created_at || "");
      if (sort === "date_asc") return a.date.localeCompare(b.date) || (a.created_at || "").localeCompare(b.created_at || "");
      if (sort === "amount_desc") return b.gross_amount - a.gross_amount;
      if (sort === "amount_asc") return a.gross_amount - b.gross_amount;
      return label(a).localeCompare(label(b));
    });
    return rows;
  }, [txns, search, catFilter, sort, typeFilter]);

  const groupedExpenses = useMemo(() => {
    const map = {};
    filteredExpenses.forEach((t) => {
      if (!map[t.date]) map[t.date] = [];
      map[t.date].push(t);
    });
    return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredExpenses]);

  const trendPct = useMemo(() => {
    if (!sum || !sum.previous_period_gross) return null;
    return Math.round(((sum.gross - sum.previous_period_gross) / sum.previous_period_gross) * 100);
  }, [sum]);

  const onExport = () => {
    const blob = new Blob([exportCSV(filteredExpenses)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `life-record-money-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  };

  const saveBudgets = async () => {
    await Promise.all(
      categories.map((c) =>
        api.put(`/categories/${c.id}`, {
          name: c.name,
          icon: c.icon,
          color: c.color,
          monthly_budget: budgetForm[c.id] ? parseFloat(budgetForm[c.id]) : null,
        })
      )
    );
    toast.success("Budgets saved");
    setBudgetOpen(false);
    refreshAll();
  };

  const deleteAccount = async (id) => {
    try {
      await api.delete(`/accounts/${id}`);
      toast.success("Deleted");
      setDeleteAccountId(null);
      refreshAll();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not delete account");
    }
  };

  const doTransfer = async (fromId, toId, amount) => {
    try {
      await api.post("/accounts/transfer", { from_account_id: fromId, to_account_id: toId, amount: parseFloat(amount) });
      toast.success("Transfer done");
      setTransferOpen(false);
      refreshAll();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Transfer failed");
    }
  };

  const openNewSubAccount = (parent) => setAccountDialog({ open: true, account: null, parent });
  const openEditAccount = (acc) => setAccountDialog({ open: true, account: acc, parent: null });

  const openTransferTo = (toId) => {
    setTransferDefaults({ to: toId });
    setTransferOpen(true);
  };

  const insightCards = useMemo(() => {
    if (!sum) return [];
    const top = sum.by_category?.[0];
    return [
      { label: "Daily average", value: eur(sum.daily_average), icon: CalendarDays, hint: "Over selected period" },
      { label: "Projected monthly", value: eur(sum.projected_month_spend), icon: TrendingUp, hint: "At current pace" },
      { label: "vs previous period", value: trendPct == null ? "—" : `${Math.abs(trendPct)}%`, icon: trendPct > 0 ? ArrowUpRight : ArrowDownRight, hint: trendPct == null ? "No prior data" : (trendPct > 0 ? "Spending more" : "Spending less"), accent: trendPct > 0 ? "text-red-500" : trendPct < 0 ? "text-emerald-500" : "" },
      { label: "Top category", value: top ? top.name : "—", icon: Target, hint: top ? eur(top.value) : "" },
    ];
  }, [sum, trendPct]);

  const BalanceSection = ({ icon: Icon, label, amount, color, children, onEdit, onAddSub, onTransferIn, testid }) => (
    <Card className={cn("p-4 flex flex-col gap-3 h-full", color && "border-l-4")} style={color ? { borderLeftColor: color } : {}} data-testid={testid}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-slate-100 dark:bg-slate-800 grid place-items-center">
            <Icon className="h-5 w-5 text-slate-600 dark:text-slate-300" />
          </div>
          <div>
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-xl font-bold">{eur(amount || 0)}</p>
          </div>
        </div>
        <div className="flex gap-1">
          {onAddSub && (
            <Hint label="Add sub-place"><Button variant="ghost" size="icon" className="h-8 w-8" onClick={onAddSub} aria-label="Add sub-place">
              <Plus className="h-4 w-4" />
            </Button></Hint>
          )}
          {onEdit && (
            <Hint label="Edit"><Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} aria-label="Edit">
              <Pencil className="h-4 w-4" />
            </Button></Hint>
          )}
          {onTransferIn && (
            <Hint label="Transfer in"><Button variant="ghost" size="icon" className="h-8 w-8" onClick={onTransferIn} aria-label="Transfer in">
              <ArrowRightLeft className="h-4 w-4" />
            </Button></Hint>
          )}
        </div>
      </div>
      {children}
    </Card>
  );

  const SubPlaces = ({ account }) => {
    const [open, setOpen] = useState(false);
    if (!account || account.children.length === 0) return null;
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {open ? "Hide details" : `Show ${account.children.length} places`}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-1.5">
            {account.children.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)).map((child) => (
              <div key={child.id} className={cn("flex items-center justify-between text-sm py-1.5 px-2 rounded-lg", child.is_locked ? "bg-amber-50 dark:bg-amber-900/20" : "bg-slate-50 dark:bg-slate-800/50")}>
                <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                  {child.name}
                  {child.is_locked && <Hint label="Locked / not available"><span className="inline-flex"><Lock className="h-3 w-3 text-amber-600 dark:text-amber-400" aria-label="Locked" /></span></Hint>}
                </span>
                <div className="flex items-center gap-2">
                  <span className={cn("font-medium", child.is_locked && "text-amber-700 dark:text-amber-300")}>{eur(child.balance || 0)}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditAccount(child)} aria-label={`Edit ${child.name}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" onClick={() => setDeleteAccountId(child.id)} aria-label={`Delete ${child.name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  const accountOptions = useMemo(() => {
    return accounts
      .filter((a) => a.type !== "owed" && a.type !== "owed_person")
      .map((a) => ({ value: a.id, label: a.name }));
  }, [accounts]);

  const cashTotal = sumChildren(mainAccounts.cash);

  return (
    <div className="space-y-6">
      <SectionHeading title="Money" sub="Bank, cash, Revolut and actual spending"
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { setTransferDefaults({ to: "" }); setTransferOpen(true); }} className="h-9 hidden sm:flex">
              <ArrowRightLeft className="h-4 w-4 mr-1" /> Transfer
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setBudgetForm(Object.fromEntries(categories.map((c) => [c.id, c.monthly_budget || ""]))); setBudgetOpen(true); }} className="h-9 hidden sm:flex">
              <Target className="h-4 w-4 mr-1" /> Budgets
            </Button>
            <Button variant="outline" size="sm" onClick={onExport} className="h-9">
              <Download className="h-4 w-4 mr-1" /> Export
            </Button>
            <Button data-testid="add-expense-btn" onClick={() => setExpenseOpen(true)} className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="h-4 w-4 mr-1" />Add expense
            </Button>
          </div>
        } />

      {/* Period filter */}
      <div className="relative">
        <div ref={scrollRef} className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide snap-x">
          {PERIODS.map((p) => (
            <button key={p.id} data-testid={`period-${p.id}`} onClick={() => setPeriod(p.id)}
              className={cn("snap-start rounded-full px-4 h-9 text-sm font-medium border transition-colors shrink-0",
                period === p.id ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "border-border text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50")}>
              {p.label}
            </button>
          ))}
          {months.map((m) => {
            const enabled = m.key <= curYM;
            return (
              <button key={m.key} data-testid={`period-${m.key}`} disabled={!enabled} onClick={() => enabled && setPeriod(m.key)}
                className={cn("snap-start rounded-full px-4 h-9 text-sm font-medium border transition-colors shrink-0",
                  !enabled ? "border-dashed border-border text-slate-300 dark:text-slate-600 cursor-not-allowed"
                    : period === m.key ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                      : "border-border text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50")}>
                {m.label}{!enabled && " · soon"}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <>
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
        </>
      ) : (
        <>
          {/* Primary balances */}
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <BalanceSection
              icon={Building2}
              label="Bank account"
              amount={mainAccounts.bank?.balance}
              color="#3B82F6"
              testid="money-bank"
              onEdit={() => mainAccounts.bank && openEditAccount(mainAccounts.bank)}
              onTransferIn={() => mainAccounts.bank && openTransferTo(mainAccounts.bank.id)}
            >
              {sum?.bank_initial ? (
                <div className="text-xs text-slate-500">
                  Started {eur(sum.bank_initial)} · left bank {eur(sum.money_left_bank)}
                </div>
              ) : null}
            </BalanceSection>
            <BalanceSection
              icon={Wallet}
              label="Money in hand"
              amount={sum?.cash_available}
              color="#10B981"
              testid="money-cash"
              onEdit={() => mainAccounts.cash && openEditAccount(mainAccounts.cash)}
              onAddSub={() => mainAccounts.cash && openNewSubAccount(mainAccounts.cash)}
              onTransferIn={() => mainAccounts.cash && openTransferTo(mainAccounts.cash.id)}
            >
              {(sum?.cash_locked || 0) > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {eur(sum.cash_locked)} locked
                </p>
              )}
              <SubPlaces account={mainAccounts.cash} />
            </BalanceSection>
            <BalanceSection
              icon={Smartphone}
              label="Revolut"
              amount={sum?.revolut}
              color="#1964FF"
              testid="money-revolut"
              onEdit={() => mainAccounts.revolut && openEditAccount(mainAccounts.revolut)}
              onAddSub={() => mainAccounts.revolut && openNewSubAccount(mainAccounts.revolut)}
              onTransferIn={() => mainAccounts.revolut && openTransferTo(mainAccounts.revolut.id)}
            >
              {(sum?.revolut_locked || 0) > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {eur(sum.revolut_locked)} locked
                </p>
              )}
              <SubPlaces account={mainAccounts.revolut} />
            </BalanceSection>
          </div>

          {/* Spending summary */}
          <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
            <Card className="p-4 bg-slate-50 dark:bg-slate-800/30">
              <p className="text-xs text-slate-500">Money that left the bank</p>
              <p className="text-2xl font-bold">{eur(sum?.money_left_bank)}</p>
              <p className="text-xs text-slate-400">Bank started {eur(sum?.bank_initial)} → now {eur(sum?.bank)}</p>
            </Card>
            <Card className="p-4 bg-slate-50 dark:bg-slate-800/30">
              <p className="text-xs text-slate-500">Still in hand (cash + Revolut)</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{eur(sum?.in_hand)}</p>
              <p className="text-xs text-slate-400">Available cash + Revolut, locked money excluded</p>
            </Card>
            <Card className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800">
              <p className="text-xs text-emerald-700 dark:text-emerald-300">Actual spending</p>
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-200">{eur(sum?.actual_spent)}</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">Money left bank − still in hand</p>
            </Card>
          </div>

          {/* Total available */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">Total available now</p>
                <p className="text-2xl font-bold">{eur(sum?.total_available)}</p>
                {((sum?.cash_locked || 0) + (sum?.revolut_locked || 0)) > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    + {eur((sum.cash_locked || 0) + (sum.revolut_locked || 0))} locked
                  </p>
                )}
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-slate-500">Bank <span className="font-medium text-slate-700 dark:text-slate-200">{eur(sum?.bank)}</span></span>
                <span className="text-slate-500">Hand <span className="font-medium text-slate-700 dark:text-slate-200">{eur(sum?.cash_available)}</span></span>
                <span className="text-slate-500">Revolut <span className="font-medium text-slate-700 dark:text-slate-200">{eur(sum?.revolut)}</span></span>
              </div>
            </div>
          </Card>

          {/* Period spending */}
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <StatCard testid="money-gross" label="Spent (period)" value={eur(sum?.gross)} hint={`Your share ${eur(sum?.personal)}`} />
            <StatCard testid="money-card-spent" label="Card spending" value={eur(sum?.card_spent)} icon={CreditCard} />
            <StatCard testid="money-cash-spent" label="Cash spending" value={eur(sum?.cash_spent)} icon={Wallet} />
            <StatCard testid="money-pending" label="Pending refunds" value={eur(sum?.pending)} accent="text-amber-600 dark:text-amber-400" hint={`Refunded ${eur(sum?.refunded)}`} />
          </div>

          {/* Insights */}
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            {insightCards.map((i, idx) => (
              <StatCard key={idx} label={i.label} value={i.value} icon={i.icon} hint={i.hint} accent={i.accent} />
            ))}
          </div>

          {/* Charts + side panels */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <Label>Spending over time</Label>
                <span className="text-xs text-slate-400">{sum?.by_day?.length || 0} days</span>
              </div>
              {sum?.by_day?.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={sum.by_day}>
                    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10B981" stopOpacity={0.35} /><stop offset="100%" stopColor="#10B981" stopOpacity={0} /></linearGradient></defs>
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} stroke="#94A3B8" />
                    <Tooltip formatter={(v) => eur(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                    <Area type="monotone" dataKey="value" stroke="#10B981" strokeWidth={2} fill="url(#g)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-slate-500 mt-10 text-center">No spending in this period.</p>}
            </Card>

            <div className="space-y-4">
              <Card className="p-5">
                <Label>By category</Label>
                {sum?.by_category?.length ? (
                  <ResponsiveContainer width="100%" height={180} className="mt-3">
                    <PieChart>
                      <Pie data={sum.by_category} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={2}>
                        {sum.by_category.map((e, i) => <Cell key={i} fill={CATEGORY_COLORS[e.name] || "#94A3B8"} />)}
                      </Pie>
                      <Tooltip formatter={(v, n) => [eur(v), n]} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-sm text-slate-500 mt-8 text-center">No data.</p>}
              </Card>

              <Card className="p-5">
                <Label className="flex items-center gap-2"><Store className="h-4 w-4" /> Top merchants</Label>
                {sum?.top_merchants?.length ? (
                  <div className="mt-3 space-y-2">
                    {sum.top_merchants.map((m) => (
                      <div key={m.name} className="flex items-center justify-between text-sm">
                        <span className="truncate max-w-[60%]">{m.name}</span>
                        <span className="font-medium">{eur(m.value)}</span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-sm text-slate-500 mt-4 text-center">No data.</p>}
              </Card>
            </div>
          </div>

          {/* Budget progress */}
          {sum?.by_category?.some((c) => c.budget) && (
            <Card className="p-5">
              <div className="flex items-center justify-between mb-4">
                <Label className="flex items-center gap-2"><Target className="h-4 w-4" /> Category budgets</Label>
                <Button variant="ghost" size="sm" onClick={() => { setBudgetForm(Object.fromEntries(categories.map((c) => [c.id, c.monthly_budget || ""]))); setBudgetOpen(true); }}>Edit</Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sum.by_category.filter((c) => c.budget).map((c) => {
                  const pct = Math.min(100, Math.round((c.value / c.budget) * 100));
                  const over = c.value > c.budget;
                  return (
                    <div key={c.name} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: CATEGORY_COLORS[c.name] || "#94A3B8" }} />{c.name}</span>
                        <span className={cn("font-medium", over && "text-red-500")}>{eur(c.value)} <span className="text-slate-400">/ {eur(c.budget)}</span></span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all", over ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-xs text-slate-500">{pct}% used{over && " · over budget"}</p>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Income vs expense */}
          <Card className="p-5">
            <Label>Income vs expense</Label>
            <div className="grid grid-cols-3 gap-4 mt-3 text-center">
              <div><p className="text-xs text-slate-500">Income</p><p className="text-lg font-semibold text-emerald-600">{eur(sum?.income)}</p></div>
              <div><p className="text-xs text-slate-500">Expense</p><p className="text-lg font-semibold text-slate-700 dark:text-slate-200">{eur(sum?.gross)}</p></div>
              <div><p className="text-xs text-slate-500">Net</p><p className={cn("text-lg font-semibold", (sum?.net || 0) >= 0 ? "text-emerald-600" : "text-red-500")}>{eur(sum?.net)}</p></div>
            </div>
            <ResponsiveContainer width="100%" height={120} className="mt-4">
              <BarChart data={[{ name: "Period", income: sum?.income || 0, expense: sum?.gross || 0 }]} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" hide />
                <Tooltip formatter={(v) => eur(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Bar dataKey="income" fill="#10B981" radius={[4, 4, 4, 4]} barSize={16} />
                <Bar dataKey="expense" fill="#64748B" radius={[4, 4, 4, 4]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Transactions */}
          <Card>
            <div className="p-4 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h3 className="font-semibold">Transactions</h3>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                  <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9 w-full sm:w-48" />
                  {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>}
                </div>
                <Select value={catFilter} onValueChange={setCatFilter}>
                  <SelectTrigger className="h-9 w-full sm:w-40"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="h-9 w-full sm:w-40"><SelectValue placeholder="Sort" /></SelectTrigger>
                  <SelectContent>
                    {SORTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 shrink-0">
                  {[["all", "All"], ["expense", "Expenses"], ["income", "Income"], ["transfer", "Transfers"]].map(([k, l]) => (
                    <button key={k} data-testid={`type-${k}`} onClick={() => setTypeFilter(k)}
                      className={cn("rounded-md px-3 py-1 text-xs font-medium transition-colors",
                        typeFilter === k ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm" : "text-slate-500")}>
                      {l}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 shrink-0">
                  {["all", "card", "cash"].map((m) => (
                    <button key={m} data-testid={`pm-${m}`} onClick={() => setPm(m)}
                      className={cn("rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                        pm === m ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm" : "text-slate-500")}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {groupedExpenses.length === 0 ? (
              <EmptyState icon={Wallet} title="No transactions here" sub="Add an expense or change the filters above."
                action={<Button onClick={() => setExpenseOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="h-4 w-4 mr-1" />Add expense</Button>} />
            ) : (
              <div className="divide-y divide-border">
                {groupedExpenses.map(([date, group]) => (
                  <div key={date}>
                    <div className="sticky top-0 z-10 bg-slate-50/90 dark:bg-slate-900/90 backdrop-blur px-5 py-1.5 text-xs font-semibold text-slate-500 flex items-center justify-between">
                      <span>{new Date(date).toLocaleDateString("default", { weekday: "short", month: "short", day: "numeric" })}</span>
                      <span>{eur(group.reduce((a, t) => a + signedAmount(t), 0))}</span>
                    </div>
                    {group.map((t) => {
                      const isExpense = t.type === "expense";
                      const isIncome = t.type === "income";
                      const isTransfer = t.type === "transfer";
                      const badge = isExpense ? REFUND_BADGE[t.refund_status] : null;
                      const color = isIncome ? "#10B981" : isTransfer ? "#3B82F6" : (CATEGORY_COLORS[t.category] || "#94A3B8");
                      const title = isTransfer
                        ? `${accountName(t.from_account)} → ${accountName(t.to_account)}`
                        : (t.merchant || t.description || t.category);
                      return (
                        <div key={t.id} data-testid={`txn-${t.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 group">
                          <div className="h-9 w-9 rounded-xl grid place-items-center shrink-0" style={{ background: color + "22" }}>
                            {isIncome ? <ArrowDownRight className="h-4 w-4" style={{ color }} />
                              : isTransfer ? <ArrowRightLeft className="h-4 w-4" style={{ color }} />
                                : <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm truncate">{title}</p>
                              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                                {t.payment_method === "cash" ? <Wallet className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}{isExpense ? t.payment_method : accountName(t.account)}
                              </span>
                              {badge && t.reimbursable_amount > 0.005 && <ConfidenceBadge type={badge.type}>{badge.label}</ConfidenceBadge>}
                            </div>
                            <p className="text-xs text-slate-500">
                              {isIncome ? "Income" : isTransfer ? "Transfer" : t.category}
                              {isIncome && t.description && t.description !== title ? ` · ${t.description}` : ""}
                              {isTransfer && t.description ? ` · ${t.description}` : ""}
                              {t.responsible?.length ? ` · with ${t.responsible.join(", ")}` : ""}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={cn("stat-num font-semibold text-sm", isIncome && "text-emerald-600 dark:text-emerald-400")}>{isIncome ? "+" : ""}{eur(t.gross_amount)}</p>
                            {isExpense && t.reimbursable_amount > 0.005 && <p className="text-xs text-amber-600 dark:text-amber-400">{eur(t.remaining_refund)} owed</p>}
                          </div>
                          <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            {isExpense && <button data-testid={`edit-txn-${t.id}`} onClick={() => setEditTxn(t)} className="p-1.5 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800"><Pencil className="h-4 w-4" /></button>}
                            <button data-testid={`del-txn-${t.id}`} onClick={() => { setDeleteTxnId(t.id); setDeleteTxnOpen(true); }} className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}

      <ExpenseDialog open={expenseOpen} setOpen={setExpenseOpen} />
      <EditExpenseDialog txn={editTxn} open={!!editTxn} setOpen={(v) => !v && setEditTxn(null)} />

      <AccountDialog open={accountDialog.open} setOpen={(o) => setAccountDialog((d) => ({ ...d, open: o }))}
        account={accountDialog.account} parent={accountDialog.parent} parents={accountRoots.filter(canHaveSubPlaces)} />

      {/* Transfer dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer money</DialogTitle>
            <DialogDescription>Move money from one location to another.</DialogDescription>
          </DialogHeader>
          <TransferForm accounts={accountOptions} defaultTo={transferDefaults.to} onSubmit={doTransfer} onCancel={() => setTransferOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Budget dialog */}
      <Dialog open={budgetOpen} onOpenChange={setBudgetOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Category budgets</DialogTitle>
            <DialogDescription>Set a monthly spending target for each category. Leave empty to disable.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color || CATEGORY_COLORS[c.name] || "#94A3B8" }} />
                <span className="flex-1 text-sm">{c.name}</span>
                <Input type="number" min={0} step="0.01" placeholder="€"
                  value={budgetForm[c.id] || ""}
                  onChange={(e) => setBudgetForm((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  className="h-9 w-28" />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setBudgetOpen(false)}>Cancel</Button>
            <Button onClick={saveBudgets} className="bg-emerald-600 hover:bg-emerald-700 text-white">Save budgets</Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteAccountId}
        onOpenChange={(v) => !v && setDeleteAccountId(null)}
        title="Delete money place?"
        description="This will permanently delete the place. Make sure it has no transactions."
        onConfirm={() => deleteAccountId && deleteAccount(deleteAccountId)}
        confirmText="Delete"
        variant="danger"
      />

      <ConfirmDialog
        open={deleteTxnOpen}
        onOpenChange={setDeleteTxnOpen}
        title="Delete transaction?"
        description={txnToDelete ? `This will permanently delete "${txnToDelete.merchant || txnToDelete.description || "this transaction"}" (${eur(txnToDelete.gross_amount)}).` : "This will permanently delete the transaction."}
        onConfirm={() => { const id = deleteTxnId; if (id) del(id); }}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}

function TransferForm({ accounts, defaultTo, onSubmit, onCancel }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(defaultTo || "");
  const [amount, setAmount] = useState("");
  useEffect(() => { if (defaultTo) setTo(defaultTo); }, [defaultTo]);
  return (
    <div className="space-y-3 mt-2">
      <div>
        <Label className="text-xs">From</Label>
        <Select value={from} onValueChange={setFrom}>
          <SelectTrigger><SelectValue placeholder="Select source" /></SelectTrigger>
          <SelectContent>
            {accounts.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">To</Label>
        <Select value={to} onValueChange={setTo}>
          <SelectTrigger><SelectValue placeholder="Select destination" /></SelectTrigger>
          <SelectContent>
            {accounts.filter((a) => a.value !== from).map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">Amount (€)</Label>
        <Input type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSubmit(from, to, amount)} disabled={!from || !to || !amount || from === to} className="bg-emerald-600 hover:bg-emerald-700 text-white">Transfer</Button>
      </div>
    </div>
  );
}
