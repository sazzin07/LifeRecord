import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, AreaChart, Area, XAxis,
  BarChart, Bar, YAxis, CartesianGrid,
} from "recharts";
import {
  Plus, Trash2, Wallet, CreditCard, Pencil, Search, Download, ArrowUpRight,
  ArrowDownRight, TrendingUp, CalendarDays, Target, Store, X, ChevronRight,
  ChevronUp, PiggyBank, Building2, Smartphone, ArrowRightLeft, Lock, Star, AlertTriangle, Banknote, Sparkles,
} from "lucide-react";
import { moneyPaths } from "@/lib/periods";
import { peekQuery, fetchQuery, subscribeQuery } from "@/lib/query";
import { api, eur, errorMessage, CATEGORY_COLORS } from "@/lib/api";
import { currencyDigits, currencyStep, currencySymbol, moneyCompact } from "@/lib/money";
import { AddMoneyDialog } from "@/components/AddMoneyDialog";
import { openAI } from "@/components/AppShell";
import { followPointer } from "@/lib/pointerLight";
import { useSettings } from "@/context/SettingsContext";
import { orderAccounts, checkSpend, spendable } from "@/lib/allocation";
import { refreshAll } from "@/lib/useFetch";
import { Label } from "@/components/common";
import { ExpenseDialog } from "@/components/ExpenseDialog";
import { EditExpenseDialog } from "@/components/EditExpenseDialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AccountDialog, buildAccountTree, canHaveSubPlaces } from "@/components/AccountDialog";
import { FirstAccounts } from "@/components/FirstAccounts";
import { Recurring } from "@/pages/money/Recurring";
import { ErrorBlock, Resolve, Sk, SkChart } from "@/components/skeletons";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Hint } from "@/components/ui/hint";
import "@/styles/money.css";

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

/** The star of a favourite place or favourite main account. Filled: it is the favourite (hover says "Favorite"); outlined: a button that makes it so. */
function FavoriteStar({ on, name, onSet }) {
  return (
    <Hint label={on ? "Favorite" : "Make favorite"}>
      <button type="button" onClick={on ? undefined : onSet} aria-pressed={on} aria-disabled={on || undefined}
        aria-label={on ? `${name} is your favorite` : `Make ${name} your favorite`} data-testid={on ? "favorite-on" : "favorite-set"}
        className={cn("inline-flex h-5 w-5 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "cursor-default" : "hover:bg-[var(--mny-surface-2)]")}>
        <Star className={cn("h-3.5 w-3.5", on ? "fill-amber-400 text-amber-500" : "mny-muted")} aria-hidden="true" />
      </button>
    </Hint>
  );
}

export default function Money() {
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const PERIODS = [{ id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "all", label: "All Time" }];

  const { moneyPeriod } = useSettings();
  const [period, setPeriod] = useState(moneyPeriod);
  const [pm, setPm] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  // Start from the last-seen data for the default view so the page paints instantly.
  const seed = useMemo(() => {
    const m = moneyPaths(moneyPeriod);
    const s0 = peekQuery(m.summary);
    return s0 ? { sum: s0, txns: peekQuery(m.transactions) ?? null, categories: peekQuery(m.categories) || [] } : null;
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- only the first paint reads it
  const [sum, setSum] = useState(seed?.sum ?? null);
  const [txns, setTxns] = useState(seed?.txns ?? null);          // null = not here yet (a skeleton), [] = here and empty (an empty state)
  const [categories, setCategories] = useState(seed?.categories ?? []);
  const [accounts, setAccounts] = useState(seed?.sum?.accounts ?? []);
  const [sumError, setSumError] = useState(false);
  const [txnsError, setTxnsError] = useState(false);
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
  const [accountDialog, setAccountDialog] = useState({ open: false, account: null, parent: null, newMain: false });
  const [addMoney, setAddMoney] = useState({ open: false, defaultId: null });
  const [deleteAccountId, setDeleteAccountId] = useState(null);
  const scrollRef = useRef(null);

  // Three requests, three independent parts of the page: the summary (every card and chart), the transactions (the list) and the categories (the
  // filter). Each lands when it lands. A view that was seen before shows at once from the cache; one that was not shows skeletons, only where
  // its own data is missing, and a request that fails says so with a way to retry (never a skeleton that waits for ever).
  const viewKey = useRef(null);
  const reqId = useRef(0);
  const load = useCallback(({ force = true } = {}) => {
    const m = moneyPaths(period, pm);
    const key = `${m.summary}|${m.transactions}`;
    const id = ++reqId.current;
    if (viewKey.current !== key) {            // another view: its last-seen copy, or nothing yet (never the previous view's numbers)
      viewKey.current = key;
      const cs = peekQuery(m.summary);
      setSum(cs || null); setAccounts(cs?.accounts || []);
      setTxns(peekQuery(m.transactions) ?? null);
      setSumError(false); setTxnsError(false);
    }
    const mine = (apply) => (value) => { if (id === reqId.current) apply(value); };
    fetchQuery(m.summary, { force }).then(mine((s) => { setSum(s); setAccounts(s.accounts || []); setSumError(false); })).catch(mine(() => setSumError(true)));
    fetchQuery(m.transactions, { force }).then(mine((t) => { setTxns(t); setTxnsError(false); })).catch(mine(() => setTxnsError(true)));
    fetchQuery(m.categories, { force }).then(mine(setCategories)).catch(() => {});   // only fills the category filter: nothing to announce
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
  const txnToDelete = (txns || []).find((t) => t.id === deleteTxnId);
  const deletingPlace = accounts.find((a) => a.id === deleteAccountId);

  const { roots: accountRoots, byId: accountById } = useMemo(() => buildAccountTree(accounts), [accounts]);
  const accountName = (id, saved) => accountById[id]?.name || saved || id || "";  // `saved`: the name a deleted place had

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
    const all = txns || [];
    let rows = typeFilter === "all" ? [...all] : all.filter((t) => t.type === typeFilter);
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
      toast.error(errorMessage(err, "Could not delete account"));
    }
  };

  const doTransfer = async (fromId, toId, amount, arrives) => {
    try {
      await api.post("/accounts/transfer", { from_account_id: fromId, to_account_id: toId, amount: parseFloat(amount), ...(arrives ? { to_amount: parseFloat(arrives) } : {}) });
      toast.success("Transfer done");
      setTransferOpen(false);
      refreshAll();
    } catch (err) {
      toast.error(errorMessage(err, "Transfer failed"));
    }
  };

  const openNewSubAccount = (parent) => setAccountDialog({ open: true, account: null, parent, newMain: false });
  const openNewMain = () => setAccountDialog({ open: true, account: null, parent: null, newMain: true });
  // Adding money to a main account lands in its favourite place unless another one is chosen in the dialog.
  const openAddMoney = (main) => setAddMoney({ open: true, defaultId: main ? (accounts.find((a) => a.parent_id === main.id && a.is_favorite)?.id || main.id) : null });
  const openEditAccount = (acc) => setAccountDialog({ open: true, account: acc, parent: null, newMain: false });
  const [openPlaces, setOpenPlaces] = useState({});
  const setFavorite = async (acc) => {
    try {
      await api.post(`/accounts/${acc.id}/favorite`);
      toast.success(`${acc.name} is now your favorite${acc.parent_id ? "" : " account"}`);
      refreshAll();
    } catch (err) { toast.error(errorMessage(err, "Could not change the favorite")); }
  };
  const placeUnplaced = async (acc) => {
    try {
      await api.post(`/accounts/${acc.id}/place-unplaced`);
      toast.success(`Moved into ${acc.favorite_place_name || "Default"}`);
      refreshAll();
    } catch (err) { toast.error(errorMessage(err, "Could not move the money")); }
  };

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
      { label: "vs previous period", value: trendPct == null ? "—" : `${Math.abs(trendPct)}%`, icon: trendPct > 0 ? ArrowUpRight : ArrowDownRight, hint: trendPct == null ? "No prior data" : (trendPct > 0 ? "Spending more" : "Spending less"), accent: trendPct > 0 ? "text-red-600 dark:text-red-400" : trendPct < 0 ? "text-emerald-700 dark:text-emerald-400" : "" },
      { label: "Top category", value: top ? top.name : "—", icon: Target, hint: top ? eur(top.value) : "" },
    ];
  }, [sum, trendPct]);

  // One account as a tile: badge, name (with its star), balance; a line of facts and the three small actions underneath.
  const AccountRow = ({ icon: Icon, label, amount, meta, children, onEdit, onAddSub, onTransferIn, onAddMoney, testid, account }) => (
    <div className="mx-asset flex flex-col gap-2.5" data-testid={testid}>
      <div className="flex items-center gap-3">
        <span className="mny-badge"><Icon className="h-5 w-5" aria-hidden="true" /></span>
        <p className="mny-title flex min-w-0 flex-1 items-center gap-1 text-sm font-medium"><span className="truncate">{label}</span>{account && <FavoriteStar on={!!account.is_favorite} name={account.name} onSet={() => setFavorite(account)} />}</p>
        <p className="mny-num mny-title shrink-0 text-lg font-semibold">{eur(amount || 0, account?.currency)}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="mny-muted min-w-0 space-y-0.5 text-xs">{meta}</div>
        <div className="flex gap-0.5">
          {onAddMoney && (
            <Hint label="Add money"><button type="button" className="mny-icon-btn" onClick={onAddMoney} aria-label={`Add money to ${label}`} data-testid={`add-money-${testid}`}>
              <Banknote className="h-4 w-4" />
            </button></Hint>
          )}
          {onAddSub && (
            <Hint label="Add sub-place"><button type="button" className="mny-icon-btn" onClick={onAddSub} aria-label="Add sub-place">
              <Plus className="h-4 w-4" />
            </button></Hint>
          )}
          {onEdit && (
            <Hint label="Edit"><button type="button" className="mny-icon-btn" onClick={onEdit} aria-label="Edit">
              <Pencil className="h-4 w-4" />
            </button></Hint>
          )}
          {onTransferIn && (
            <Hint label="Transfer in"><button type="button" className="mny-icon-btn" onClick={onTransferIn} aria-label="Transfer in">
              <ArrowRightLeft className="h-4 w-4" />
            </button></Hint>
          )}
        </div>
      </div>
      {children}
    </div>
  );

  // How a main account's money is divided: the total and which place is the favourite.
  const AllocationSummary = ({ account }) => {
    if (!account || !(account.place_count > 0)) return null;
    const total = account.total_balance || 0;
    return (
      <p data-testid={`allocation-${account.type}`}>
        Total {eur(total, account.currency)} · {account.place_count} {account.place_count === 1 ? "place" : "places"}{account.favorite_place_name ? ` · favorite ${account.favorite_place_name}` : ""}
      </p>
    );
  };

  const SubPlaces = ({ account }) => {
    // The open state lives in the page: this component is re-created on every refresh, which would close the list after each click.
    const open = !!openPlaces[account?.id];
    const setOpen = (value) => setOpenPlaces((m) => ({ ...m, [account.id]: value }));
    if (!account || account.children.length === 0) return null;
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="mny-muted flex items-center gap-1 rounded-full text-xs hover:text-[var(--mny-text)]">
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {open ? "Hide details" : `Show ${account.children.length} ${account.children.length === 1 ? "place" : "places"}`}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-1.5">
            {Math.abs(account.unplaced_balance || 0) > 0.005 && (
              <div className="mny-amber flex flex-wrap items-center justify-between gap-2 rounded-xl border border-dashed border-current bg-[var(--mny-amber-tint)] px-2.5 py-1.5 text-sm" data-testid={`unplaced-${account.type}`}>
                <span className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{eur(account.unplaced_balance, account.currency)} is outside every place</span>
                <button type="button" className="mny-pill sm" onClick={() => placeUnplaced(account)} data-testid={`place-unplaced-${account.type}`}>
                  Move to {account.favorite_place_name || "Default"}
                </button>
              </div>
            )}
            {account.children.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)).map((child) => (
              <div key={child.id} data-testid={`place-${child.name.toLowerCase().replace(/\s+/g, "-")}`} className={cn("flex items-center justify-between gap-2 rounded-xl border border-[var(--mny-line)] px-2.5 py-1.5 text-sm", child.is_locked ? "bg-[var(--mny-amber-tint)]" : "bg-[var(--mny-surface)]")}>
                <span className="mny-title flex min-w-0 items-center gap-1.5">
                  <FavoriteStar on={!!child.is_favorite} name={child.name} onSet={() => setFavorite(child)} />
                  <span className="truncate">{child.name}</span>
                  {child.is_locked && <Hint label="Locked / not available"><span className="inline-flex"><Lock className="mny-amber h-3 w-3" aria-label="Locked" /></span></Hint>}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <span className={cn("mny-num font-medium", child.is_locked && "mny-amber")}>{eur(child.balance || 0, child.currency || account.currency)}</span>
                  <button type="button" className="mny-icon-btn !h-7 !w-7" onClick={() => openEditAccount(child)} aria-label={`Edit ${child.name}`}>
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {account.children.length > 1 && (   /* a main account always keeps one place */
                    <button type="button" className="mny-icon-btn danger !h-7 !w-7" onClick={() => setDeleteAccountId(child.id)} aria-label={`Delete ${child.name}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  const sumWait = !sum && !sumError;
  const sumWaited = useRef(false);
  if (sumWait) sumWaited.current = true;
  const revealSum = !sumWait && sumWaited.current;   // fade in only what replaced placeholders
  // The summary's figures are in the main currency. An account in another currency reads its own block of figures instead.
  const inCurrency = (account, key, fallback) => {
    if (!sum?.by_currency || !account || account.currency === sum.main_currency) return fallback;
    return sum.by_currency.find((r) => r.currency === account.currency)?.[key] ?? fallback;
  };
  // Every main account, in the order the server uses (position, then when it was made); the first of each kind keeps the familiar test ids.
  const mainList = useMemo(() => accountRoots.filter((a) => a.type !== "owed" && a.type !== "owed_person")
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.created_at || "").localeCompare(String(b.created_at || ""))), [accountRoots]);
  const accountOptions = useMemo(() => orderAccounts(accounts.filter((a) => a.type !== "owed" && a.type !== "owed_person")), [accounts]);

  const openBudgets = () => { setBudgetForm(Object.fromEntries(categories.map((c) => [c.id, c.monthly_budget || ""]))); setBudgetOpen(true); };
  const lockedTotal = (sum?.cash_locked || 0) + (sum?.revolut_locked || 0);
  const catTotal = (sum?.by_category || []).reduce((a, c) => a + c.value, 0);

  return (
    <div className="mny-theme mny-stage space-y-4 sm:space-y-5" onPointerMove={followPointer}>
      <div className="mx-rise flex flex-wrap items-end justify-between gap-x-4 gap-y-4 px-1" style={{ "--i": 0 }}>
        <div className="min-w-0">
          <h2 className="mx-title">Money</h2>
          <p className="mny-muted mt-1 text-sm">Bank, cash, Revolut and actual spending</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="mny-pill" onClick={() => openAddMoney(null)} data-testid="add-money-btn">
            <Banknote className="h-4 w-4" aria-hidden="true" /> Add money
          </button>
          <button type="button" className="mny-pill" onClick={() => { setTransferDefaults({ to: "" }); setTransferOpen(true); }}>
            <ArrowRightLeft className="h-4 w-4" aria-hidden="true" /> Transfer
          </button>
          <button type="button" className="mny-pill" onClick={openBudgets}>
            <Target className="h-4 w-4" aria-hidden="true" /> Budgets
          </button>
          <button type="button" className="mny-pill" onClick={onExport}>
            <Download className="h-4 w-4" aria-hidden="true" /> Export
          </button>
          <button type="button" data-testid="add-expense-btn" className="mny-pill mny-cta" onClick={() => setExpenseOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />Add expense
          </button>
        </div>
      </div>

      {/* Period filter, and the way to ask the assistant about the money */}
      <div className="mx-rise flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4" style={{ "--i": 1 }}>
      <div ref={scrollRef} className="scrollbar-hide -mx-1 flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto px-1 py-1">
        {PERIODS.map((p) => (
          <button key={p.id} type="button" data-testid={`period-${p.id}`} aria-pressed={period === p.id} onClick={() => setPeriod(p.id)} className="mny-pill snap-start">
            {p.label}
          </button>
        ))}
        {months.map((m) => {
          const enabled = m.key <= curYM;
          return (
            <button key={m.key} type="button" data-testid={`period-${m.key}`} disabled={!enabled} aria-pressed={period === m.key} onClick={() => enabled && setPeriod(m.key)} className="mny-pill snap-start">
              {m.label}{!enabled && " · soon"}
            </button>
          );
        })}
      </div>
        <button type="button" data-testid="money-ask-ai" onClick={() => openAI()} className="mx-ask w-full lg:w-[19rem] lg:shrink-0">
          <Sparkles className="h-4 w-4 shrink-0 text-[var(--mx-orchid)]" aria-hidden="true" />Ask about your money
        </button>
      </div>

      {(
        <>
          {sum && accounts.length === 0 && <FirstAccounts />}

          {sumError && !sum ? (
            <ErrorBlock what="the figures" onRetry={() => load({ force: true })} className="min-h-[16rem]" />
          ) : (
          <div data-skeleton={sumWait ? "" : undefined} {...(sumWait ? { inert: "true" } : {})} aria-busy={sumWait || undefined} className={cn("space-y-4 sm:space-y-5", revealSum && "sk-reveal")}>
            {sumWait && <span role="status" className="sr-only">Loading your money</span>}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
            {/* The total, and where money left the bank */}
              <div className="flex flex-col gap-4 lg:col-span-4">
              <section className="mny-card mny-hero mx-bloom mx-rise overflow-hidden p-5 sm:p-6" style={{ "--i": 2 }} aria-labelledby="mny-total-h">
                <h3 id="mny-total-h" className="mx-h">Total available now</h3>
                <p data-testid="money-total" className="mny-num mx-fig mt-5 break-words text-[2.5rem] sm:text-[3rem]">{eur(sum?.total_available)}</p>
                {(sumWait || lockedTotal > 0) && <p className="mny-amber sk-ph mt-2 text-xs font-medium">+ {eur(lockedTotal)} locked</p>}
                {sum?.by_currency && (
                  <ul className="mt-2 space-y-0.5" data-testid="money-by-currency" aria-label="Totals in other currencies">
                    {sum.by_currency.filter((r) => r.currency !== sum.main_currency).map((r) => (
                      <li key={r.currency} className="mny-num mny-title text-sm font-medium">{eur(r.total_available, r.currency)} <span className="mny-muted text-xs font-normal">in {r.currency}</span></li>
                    ))}
                  </ul>
                )}
                <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                  {[["Bank", sum?.bank], ["Hand", sum?.cash_available], ["Revolut", sum?.revolut]].map(([l, v]) => (
                    <div key={l} className="mny-tile px-1.5 py-2">
                      <p className="mny-muted text-[11px]">{l}</p>
                      <p className="mny-num mny-title truncate text-[13px] font-semibold tracking-tight" title={eur(v)}>{moneyCompact(v)}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section className="mny-card mx-glow mx-rise flex-1 overflow-hidden p-5 sm:p-6" style={{ "--i": 3 }} aria-labelledby="mny-flow-h">
                <h3 id="mny-flow-h" className="mx-h">Where it went</h3>
                <div className="mt-3 space-y-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="mny-title">Left the bank</p><p className="mny-muted sk-ph text-xs">Started {eur(sum?.bank_initial)} → now {eur(sum?.bank)}</p></div>
                    <p className="mny-num mny-title shrink-0 text-lg font-semibold">{eur(sum?.money_left_bank)}</p>
                  </div>
                  <div className="mny-hair border-t" />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="mny-title">Still in hand</p><p className="mny-muted text-xs">Cash + Revolut, locked money excluded</p></div>
                    <p className="mny-num mny-green shrink-0 text-lg font-semibold">{eur(sum?.in_hand)}</p>
                  </div>
                  <div className="mny-hair border-t" />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="mny-title">Actual spending</p><p className="mny-muted text-xs">Left the bank − still in hand</p></div>
                    <p className="mny-num mny-title shrink-0 text-lg font-semibold">{eur(sum?.actual_spent)}</p>
                  </div>
                </div>
              </section>

              </div>

            {/* The three accounts */}
            <section className="mny-card mx-rise p-5 sm:p-6 lg:col-span-4" style={{ "--i": 4 }} aria-labelledby="mny-accounts-h">
              <h3 id="mny-accounts-h" className="mx-h mb-4">Accounts</h3>
              <div>
                {sumWait ? (<>
                <AccountRow
                  icon={Building2} label="Bank account" amount={mainAccounts.bank?.balance} testid="money-bank" account={mainAccounts.bank}
                  meta={<><p className="sk-ph">Started €0,000.00 · left bank €0.00</p><p className="sk-ph">Total €000.00 · 1 place · favorite Default</p></>}
                  onEdit={() => mainAccounts.bank && openEditAccount(mainAccounts.bank)}
                  onTransferIn={() => mainAccounts.bank && openTransferTo(mainAccounts.bank.id)}
                >
                  <p className="mny-muted text-xs"><span className="sk-ph">Show 1 place</span></p>
                </AccountRow>
                <AccountRow
                  icon={Wallet} label="Money in hand" amount={inCurrency(mainAccounts.cash, "cash_available", sum?.cash_available)} testid="money-cash" account={mainAccounts.cash}
                  meta={sumWait ? <><p className="sk-ph">€000.00 locked</p><p className="sk-ph">Total €000.00 · 3 places · favorite Default</p></> : <>{(sum?.cash_locked || 0) > 0 && <p className="mny-amber">{eur(sum.cash_locked)} locked</p>}<AllocationSummary account={mainAccounts.cash} /></>}
                  onEdit={() => mainAccounts.cash && openEditAccount(mainAccounts.cash)}
                  onAddSub={() => mainAccounts.cash && openNewSubAccount(mainAccounts.cash)}
                  onTransferIn={() => mainAccounts.cash && openTransferTo(mainAccounts.cash.id)}
                >
                  {sumWait ? <p className="mny-muted text-xs"><span className="sk-ph">Show 3 places</span></p> : <SubPlaces account={mainAccounts.cash} />}
                </AccountRow>
                <AccountRow
                  icon={Smartphone} label="Revolut" amount={inCurrency(mainAccounts.revolut, "revolut", sum?.revolut)} testid="money-revolut" account={mainAccounts.revolut}
                  meta={sumWait ? <><p className="sk-ph">€000.00 locked</p><p className="sk-ph">Total €000.00 · 2 places · favorite Default</p></> : <>{(sum?.revolut_locked || 0) > 0 && <p className="mny-amber">{eur(sum.revolut_locked)} locked</p>}<AllocationSummary account={mainAccounts.revolut} /></>}
                  onEdit={() => mainAccounts.revolut && openEditAccount(mainAccounts.revolut)}
                  onAddSub={() => mainAccounts.revolut && openNewSubAccount(mainAccounts.revolut)}
                  onTransferIn={() => mainAccounts.revolut && openTransferTo(mainAccounts.revolut.id)}
                >
                  {sumWait ? <p className="mny-muted text-xs"><span className="sk-ph">Show 2 places</span></p> : <SubPlaces account={mainAccounts.revolut} />}
                </AccountRow>
                  <button type="button" className="mny-pill w-full" disabled tabIndex={-1}><Plus className="h-4 w-4" aria-hidden="true" />New account</button>
                </>) : (<>
                  {mainList.map((m) => {
                    const first = mainList.find((x) => x.type === m.type)?.id === m.id;
                    const Icon = { bank: Building2, cash: Wallet, revolut: Smartphone }[m.type] || Wallet;
                    const lockedHere = (m.children || []).filter((c) => c.is_locked && c.currency === m.currency).reduce((a, c) => a + (c.balance || 0), 0);
                    const amount = m.type === "bank" ? m.balance : m.balance - lockedHere;   // money in hand and wallets show what is free to use
                    return (
                      <AccountRow key={m.id} icon={Icon} label={m.name} amount={amount} account={m} testid={first ? `money-${m.type}` : `money-account-${m.id}`}
                        meta={<>
                          {m.type === "bank" && first && sum?.bank_initial ? <p>Started {eur(sum.bank_initial)} · left bank {eur(sum.money_left_bank)}</p> : null}
                          {lockedHere > 0 && <p className="mny-amber">{eur(lockedHere, m.currency)} locked</p>}
                          {(m.other_balances || []).map((o) => <p key={o.currency} className="mny-title font-medium" data-testid={`other-balance-${o.currency}`}>+ {eur(o.balance, o.currency)} in {o.currency}</p>)}
                          <AllocationSummary account={m} />
                        </>}
                        onEdit={() => openEditAccount(m)} onAddMoney={() => openAddMoney(m)}
                        onAddSub={canHaveSubPlaces(m) ? () => openNewSubAccount(m) : undefined} onTransferIn={() => openTransferTo(m.id)}>
                        <SubPlaces account={m} />
                      </AccountRow>
                    );
                  })}
                  <button type="button" className="mny-pill mt-3 w-full" onClick={openNewMain} data-testid="add-account"><Plus className="h-4 w-4" aria-hidden="true" />New account</button>
                </>)}
              </div>
            </section>

            {/* The period in four tiles, then the pace */}
            <section className="mny-card mx-rise p-5 sm:p-6 md:col-span-2 lg:col-span-4" style={{ "--i": 5 }} aria-labelledby="mny-period-h">
              <h3 id="mny-period-h" className="mx-h">This period</h3>
              <div className="mt-3 grid grid-cols-2 gap-3">
                {[
                  { id: "money-gross", label: "Spent", value: moneyCompact(sum?.gross), hint: `Your share ${eur(sum?.personal)}`, icon: ArrowUpRight },
                  { id: "money-card-spent", label: "Card", value: moneyCompact(sum?.card_spent), hint: "Card spending", icon: CreditCard },
                  { id: "money-cash-spent", label: "Cash", value: moneyCompact(sum?.cash_spent), hint: "Cash spending", icon: Wallet },
                  { id: "money-pending", label: "Pending refunds", value: moneyCompact(sum?.pending), hint: `Refunded ${eur(sum?.refunded)}`, icon: PiggyBank, amber: true },
                ].map((t) => (
                  <div key={t.id} data-testid={t.id} className="mny-tile p-3">
                    <p className="mny-muted flex items-center gap-1.5 text-xs"><t.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{t.label}</span></p>
                    <p className={cn("mny-num mt-1.5 truncate text-lg font-semibold sm:text-xl", t.amber ? "mny-amber" : "mny-title")}>{t.value}</p>
                    <p className="mny-muted sk-ph mt-0.5 truncate text-[11px]">{t.hint}</p>
                  </div>
                ))}
              </div>
              <div className="mny-hair mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4">
                {insightCards.map((i, idx) => (
                  <div key={idx} className="min-w-0">
                    <p className="mny-muted flex items-center gap-1.5 text-xs"><i.icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{i.label}</span></p>
                    <p className={cn("mny-num mt-0.5 truncate text-base font-semibold", i.accent ? (i.label === "vs previous period" && trendPct > 0 ? "mny-neg" : "mny-green") : "mny-title")}>{i.value}</p>
                    {i.hint && <p className="mny-muted sk-ph truncate text-[11px]">{i.hint}</p>}
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Spending over time, and where it went by category */}
          <div className="grid gap-4 lg:grid-cols-12">
            <section className="mny-card mx-rise p-5 sm:p-6 lg:col-span-8" style={{ "--i": 6 }} aria-labelledby="mny-time-h">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="mny-time-h" className="mx-h">Spending over time</h3>
                <div className="flex items-center gap-2">
                  {trendPct != null && (
                    <span className={cn("mny-state", trendPct > 0 ? "neg" : "")}>
                      {trendPct > 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden="true" /> : <ArrowDownRight className="h-3 w-3" aria-hidden="true" />}
                      {Math.abs(trendPct)}% {trendPct > 0 ? "more" : "less"} than before
                    </span>
                  )}
                  <span className="mny-muted sk-ph text-xs">{sum?.by_day?.length || 0} days</span>
                </div>
              </div>
              {sumWait ? <SkChart className="mt-4" height={260} /> : sum?.by_day?.length ? (
                <ResponsiveContainer width="100%" height={260} className="mt-4">
                  <AreaChart data={sum.by_day} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                    <defs><linearGradient id="mny-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-line)" stopOpacity={0.34} /><stop offset="100%" stopColor="var(--chart-line)" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(d) => d.slice(5)} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis width={44} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : v)} />
                    <Tooltip content={<ChartTip />} cursor={{ stroke: "var(--line-strong)", strokeDasharray: "3 5" }} />
                    <Area type="monotone" dataKey="value" stroke="var(--chart-line)" strokeWidth={2.5} fill="url(#mny-g)" animationDuration={1100} animationEasing="ease-out" activeDot={{ r: 7, fill: "var(--tip-bg)", stroke: "var(--chart-line)", strokeWidth: 4 }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <p className="mny-muted mt-12 text-center text-sm">No spending in this period.</p>}
            </section>

            <section className="mny-card mx-rise p-5 sm:p-6 lg:col-span-4" style={{ "--i": 7 }} aria-labelledby="mny-cat-h">
              <h3 id="mny-cat-h" className="mx-h">By category</h3>
              {sumWait ? (
                <>
                  <div className="mt-2 grid place-items-center" style={{ height: 170 }}><Sk className="h-[152px] w-[152px] !rounded-full" /></div>
                  <ul className="mt-2 space-y-1.5" aria-hidden="true">
                    {[0, 1, 2].map((i) => <li key={i} className="flex items-center justify-between gap-2 text-sm"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--mny-line)]" /><span className="sk-ph">Groceries</span></span><span className="mny-num">€000.00 · 00%</span></li>)}
                  </ul>
                </>
              ) : sum?.by_category?.length ? (
                <>
                  <ResponsiveContainer width="100%" height={170} className="mt-2">
                    <PieChart>
                      <Pie data={sum.by_category} dataKey="value" nameKey="name" innerRadius={48} outerRadius={76} paddingAngle={3} stroke="none">
                        {sum.by_category.map((e, i) => <Cell key={i} fill={CATEGORY_COLORS[e.name] || "#94A3B8"} />)}
                      </Pie>
                      <Tooltip formatter={(v, n) => [eur(v), n]} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <ul className="mt-2 space-y-1.5">
                    {sum.by_category.slice(0, 5).map((c) => (
                      <li key={c.name} className="flex items-center justify-between gap-2 text-sm">
                        <span className="mny-title flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_COLORS[c.name] || "#94A3B8" }} aria-hidden="true" /><span className="truncate">{c.name}</span></span>
                        <span className="mny-num mny-muted shrink-0">{eur(c.value)}{catTotal > 0 && ` · ${Math.round((c.value / catTotal) * 100)}%`}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : <p className="mny-muted mt-10 text-center text-sm">No data.</p>}
            </section>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="mny-card mx-rise p-5 sm:p-6" style={{ "--i": 8 }} aria-labelledby="mny-merch-h">
              <h3 id="mny-merch-h" className="mx-h flex items-center gap-2"><Store className="h-4 w-4 text-[var(--mx-orchid)]" aria-hidden="true" /> Top merchants</h3>
              {sumWait ? (
                <ul className="mt-3 space-y-2.5" aria-hidden="true">
                  {["Merchant name", "Another place", "Short", "A longer merchant"].map((n) => <li key={n} className="flex items-center justify-between gap-3 text-sm"><span className="sk-ph">{n}</span><span className="mny-num font-medium">€00.00</span></li>)}
                </ul>
              ) : sum?.top_merchants?.length ? (
                <ul className="mt-3 space-y-2.5">
                  {sum.top_merchants.map((m) => (
                    <li key={m.name} className="flex items-center justify-between gap-3 text-sm">
                      <span className="mny-title truncate">{m.name}</span>
                      <span className="mny-num mny-title shrink-0 font-medium">{eur(m.value)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mny-muted mt-6 text-center text-sm">No data.</p>}
            </section>

            <section className="mny-card mx-rise p-5 sm:p-6" style={{ "--i": 9 }} aria-labelledby="mny-inex-h">
              <h3 id="mny-inex-h" className="mx-h">Income vs expense</h3>
              <div className="mt-3 grid grid-cols-3 gap-3 text-center">
                <div className="mny-tile p-2.5"><p className="mny-muted text-xs">Income</p><p className="mny-num mny-green truncate text-base font-semibold">{eur(sum?.income)}</p></div>
                <div className="mny-tile p-2.5"><p className="mny-muted text-xs">Expense</p><p className="mny-num mny-title truncate text-base font-semibold">{eur(sum?.gross)}</p></div>
                <div className="mny-tile p-2.5"><p className="mny-muted text-xs">Net</p><p className={cn("mny-num truncate text-base font-semibold", (sum?.net || 0) >= 0 ? "mny-green" : "mny-neg")}>{eur(sum?.net)}</p></div>
              </div>
              {sumWait ? <div className="mt-4" style={{ height: 90 }} aria-hidden="true"><Sk className="mt-6 h-3.5 w-full !rounded-full" /><Sk className="mt-3 h-3.5 w-4/5 !rounded-full" /></div> : (
              <ResponsiveContainer width="100%" height={90} className="mt-4">
                <BarChart data={[{ name: "Period", income: sum?.income || 0, expense: sum?.gross || 0 }]} layout="vertical" margin={{ left: 0, right: 12, top: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" hide />
                  <Tooltip formatter={(v) => eur(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} cursor={false} />
                  <Bar dataKey="income" fill="var(--mny-green)" radius={[7, 7, 7, 7]} barSize={14} animationDuration={900} />
                  <Bar dataKey="expense" fill="var(--chart-line-soft)" radius={[7, 7, 7, 7]} barSize={14} animationDuration={900} />
                </BarChart>
              </ResponsiveContainer>
              )}
            </section>
          </div>

          {/* Budget progress */}
          {sum?.by_category?.some((c) => c.budget) && (
            <section className="mny-card sk-reveal p-5 sm:p-6" aria-labelledby="mny-budget-h">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h3 id="mny-budget-h" className="mx-h flex items-center gap-2"><Target className="h-4 w-4 text-[var(--mx-orchid)]" aria-hidden="true" /> Category budgets</h3>
                <button type="button" className="mny-pill sm" onClick={openBudgets}>Edit</button>
              </div>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {sum.by_category.filter((c) => c.budget).map((c) => {
                  const pct = Math.min(100, Math.round((c.value / c.budget) * 100));
                  const over = c.value > c.budget;
                  return (
                    <div key={c.name} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="mny-title flex min-w-0 items-center gap-2"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLORS[c.name] || "#94A3B8" }} aria-hidden="true" /><span className="truncate">{c.name}</span></span>
                        <span className={cn("mny-num shrink-0 font-medium", over ? "mny-neg" : "mny-title")}>{eur(c.value)} <span className="mny-muted">/ {eur(c.budget)}</span></span>
                      </div>
                      <div className="mny-bar" role="progressbar" aria-label={`${c.name} budget used`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                        <span className={over ? "over" : pct >= 80 ? "warn" : ""} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mny-muted text-xs">{pct}% used{over && " · over budget"}</p>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          </div>
          )}

          <Recurring accounts={accountOptions} categories={categories} />

          {/* Transactions */}
          <section className="mny-card mx-rise overflow-hidden" style={{ "--i": 10 }} aria-labelledby="mny-txn-h">
            <div className="flex flex-col justify-between gap-3 p-5 pb-3 xl:flex-row xl:items-center">
              <h3 id="mny-txn-h" className="mx-h">Transactions</h3>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <div className="relative">
                  <Search className="mny-muted absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" aria-hidden="true" />
                  <Input placeholder="Search..." aria-label="Search transactions" value={search} onChange={(e) => setSearch(e.target.value)} className="mny-field h-9 w-full pl-9 sm:w-48" />
                  {search && <button onClick={() => setSearch("")} aria-label="Clear search" className="mny-muted absolute right-2.5 top-1/2 -translate-y-1/2 hover:text-[var(--mny-text)]"><X className="h-3.5 w-3.5" /></button>}
                </div>
                <Select value={catFilter} onValueChange={setCatFilter}>
                  <SelectTrigger className="mny-field h-9 w-full sm:w-40" aria-label="Filter by category"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent className="mx-pop">
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="mny-field h-9 w-full sm:w-40" aria-label="Sort transactions"><SelectValue placeholder="Sort" /></SelectTrigger>
                  <SelectContent className="mx-pop">
                    {SORTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="scrollbar-hide flex gap-1.5 overflow-x-auto" role="group" aria-label="Type">
                  {[["all", "All"], ["expense", "Expenses"], ["income", "Income"], ["transfer", "Transfers"]].map(([k, l]) => (
                    <button key={k} type="button" data-testid={`type-${k}`} aria-pressed={typeFilter === k} onClick={() => setTypeFilter(k)} className="mny-pill sm">{l}</button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5" role="group" aria-label="Paid with">
                  <span className="mny-muted text-xs">Paid with</span>
                  {["all", "card", "cash"].map((m) => (
                    <button key={m} type="button" data-testid={`pm-${m}`} aria-pressed={pm === m} onClick={() => setPm(m)} className="mny-pill sm capitalize">{m}</button>
                  ))}
                </div>
              </div>
            </div>

            <Resolve loading={txns === null && !txnsError} error={txnsError && txns === null} onRetry={() => load({ force: true })} label="Loading transactions" what="the transactions"
              skeleton={<TxnListSk />} errorClassName="m-5">
            {groupedExpenses.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
                <span className="mny-badge !h-14 !w-14"><Wallet className="h-6 w-6" aria-hidden="true" /></span>
                <p className="mny-title mt-4 font-semibold">No transactions here</p>
                <p className="mny-muted mt-1 max-w-sm text-sm">Add an expense or change the filters above.</p>
                <button type="button" className="mny-pill mny-cta mt-5" onClick={() => setExpenseOpen(true)}><Plus className="h-4 w-4" aria-hidden="true" />Add expense</button>
              </div>
            ) : (
              <div>
                {groupedExpenses.map(([date, group]) => (
                  <div key={date}>
                    <div className="mny-muted mny-hair sticky top-0 z-10 flex items-center justify-between border-y bg-[var(--mny-surface-2)] px-5 py-1.5 text-xs font-semibold">
                      <span>{new Date(date).toLocaleDateString("default", { weekday: "short", month: "short", day: "numeric" })}</span>
                      {new Set(group.map((t) => t.currency)).size === 1 && <span className="mny-num">{eur(group.reduce((a, t) => a + signedAmount(t), 0), group[0].currency)}</span>}
                    </div>
                    {group.map((t) => {
                      const isExpense = t.type === "expense";
                      const isIncome = t.type === "income";
                      const isTransfer = t.type === "transfer";
                      const badge = isExpense ? REFUND_BADGE[t.refund_status] : null;
                      const color = isIncome ? "#34d399" : isTransfer ? "#60a5fa" : (CATEGORY_COLORS[t.category] || "#94A3B8");
                      const title = isTransfer
                        ? `${accountName(t.from_account, t.from_account_name)} → ${accountName(t.to_account, t.to_account_name)}`
                        : (t.merchant || t.description || t.category);
                      return (
                        <div key={t.id} data-testid={`txn-${t.id}`} className="mny-row group flex items-center gap-3 px-5 py-3">
                          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: color + "26" }}>
                            {isIncome ? <ArrowDownRight className="h-4 w-4" style={{ color }} aria-hidden="true" />
                              : isTransfer ? <ArrowRightLeft className="h-4 w-4" style={{ color }} aria-hidden="true" />
                                : <span className="h-3 w-3 rounded-full" style={{ background: color }} aria-hidden="true" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="mny-title truncate text-sm font-medium">{title}</p>
                              <span className="mny-muted flex items-center gap-1 text-[11px] font-medium">
                                {t.payment_method === "cash" ? <Wallet className="h-3 w-3" aria-hidden="true" /> : <CreditCard className="h-3 w-3" aria-hidden="true" />}{isExpense ? t.payment_method : accountName(t.account, t.account_name)}
                              </span>
                              {badge && t.reimbursable_amount > 0.005 && <span data-testid={`confidence-${badge.type}`} className={cn("mny-state", badge.type === "exact" ? "" : "amber")}>{badge.label}</span>}
                            </div>
                            <p className="mny-muted text-xs">
                              {isIncome ? "Income" : isTransfer ? "Transfer" : t.category}
                              {isIncome && t.description && t.description !== title ? ` · ${t.description}` : ""}
                              {isTransfer && t.description ? ` · ${t.description}` : ""}
                              {t.responsible?.length ? ` · with ${t.responsible.join(", ")}` : ""}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className={cn("mny-num text-sm font-semibold", isIncome ? "mny-green" : "mny-title")}>{isIncome ? "+" : ""}{eur(t.gross_amount, t.currency)}{isTransfer && t.to_amount != null && <span className="mny-muted font-normal"> → {eur(t.to_amount, t.to_currency)}</span>}</p>
                            {isExpense && t.reimbursable_amount > 0.005 && <p className="mny-amber text-xs">{eur(t.remaining_refund, t.currency)} owed</p>}
                          </div>
                          <div className="flex items-center gap-0.5 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                            {isExpense && <button type="button" data-testid={`edit-txn-${t.id}`} aria-label={`Edit ${t.merchant || t.description || "transaction"}`} onClick={() => setEditTxn(t)} className="mny-icon-btn"><Pencil className="h-4 w-4" /></button>}
                            <button type="button" data-testid={`del-txn-${t.id}`} aria-label={`Delete ${t.merchant || t.description || "transaction"}`} onClick={() => { setDeleteTxnId(t.id); setDeleteTxnOpen(true); }} className="mny-icon-btn danger"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
            </Resolve>
          </section>
        </>
      )}

      <ExpenseDialog open={expenseOpen} setOpen={setExpenseOpen} />
      <EditExpenseDialog txn={editTxn} open={!!editTxn} setOpen={(v) => !v && setEditTxn(null)} />

      <AddMoneyDialog open={addMoney.open} setOpen={(o) => setAddMoney((d) => ({ ...d, open: o }))} options={accountOptions} defaultId={addMoney.defaultId} />

      <AccountDialog open={accountDialog.open} setOpen={(o) => setAccountDialog((d) => ({ ...d, open: o }))} newMain={!!accountDialog.newMain}
        account={accountDialog.account} parent={accountDialog.parent} parents={accountRoots.filter(canHaveSubPlaces)} />

      {/* Transfer dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent className="mny-theme mny-dialog max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer money</DialogTitle>
            <DialogDescription>Move money from one location to another.</DialogDescription>
          </DialogHeader>
          <TransferForm accounts={accountOptions} defaultTo={transferDefaults.to} onSubmit={doTransfer} onCancel={() => setTransferOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Budget dialog */}
      <Dialog open={budgetOpen} onOpenChange={setBudgetOpen}>
        <DialogContent className="mny-theme mny-dialog max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Category budgets</DialogTitle>
            <DialogDescription>Set a monthly spending target for each category. Leave empty to disable.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color || CATEGORY_COLORS[c.name] || "#94A3B8" }} aria-hidden="true" />
                <span className="mny-title flex-1 text-sm">{c.name}</span>
                <Input type="number" min={0} step="0.01" placeholder={currencySymbol()} aria-label={`${c.name} monthly budget`}
                  value={budgetForm[c.id] || ""}
                  onChange={(e) => setBudgetForm((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  className="mny-field h-9 w-28 text-right" />
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <button type="button" className="mny-pill" onClick={() => setBudgetOpen(false)}>Cancel</button>
            <button type="button" className="mny-pill mny-cta" onClick={saveBudgets}>Save budgets</button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteAccountId}
        onOpenChange={(v) => !v && setDeleteAccountId(null)}
        title="Delete money place?"
        description={deletingPlace
          ? `The ${eur(deletingPlace.balance, deletingPlace.currency)} in "${deletingPlace.name}" goes back to its main account, so nothing is lost. Its past transactions stay in your history.`
          : "The money in it goes back to the main account, so nothing is lost. Its past transactions stay in your history."}
        onConfirm={() => deleteAccountId && deleteAccount(deleteAccountId)}
        confirmText="Delete"
        variant="danger"
      />

      <ConfirmDialog
        open={deleteTxnOpen}
        onOpenChange={setDeleteTxnOpen}
        title="Delete transaction?"
        description={txnToDelete ? `This will permanently delete "${txnToDelete.merchant || txnToDelete.description || "this transaction"}" (${eur(txnToDelete.gross_amount, txnToDelete.currency)}).` : "This will permanently delete the transaction."}
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
  const [arrives, setArrives] = useState("");
  useEffect(() => { if (defaultTo) setTo(defaultTo); }, [defaultTo]);
  const source = accounts.find((a) => a.id === from);
  const target = accounts.find((a) => a.id === to);
  // Two currencies: nothing is converted for the person. They say what arrived, and the rate that implies is shown back to them.
  const crossing = !!source && !!target && (source.currency || "EUR") !== (target.currency || "EUR");
  const rate = crossing && Number(amount) > 0 && Number(arrives) > 0 ? Number(arrives) / Number(amount) : null;
  // The last rate you used for this pair pre-fills what arrives (never fetched from anywhere); typing in the field is always the last word.
  const touched = useRef(false);
  const rateKey = crossing ? `lr-rate:${source.currency}>${target.currency}` : null;
  useEffect(() => { touched.current = false; setArrives(""); }, [from, to]);
  useEffect(() => {
    if (!crossing || touched.current || !(Number(amount) > 0)) return;
    let remembered = 0;
    try { remembered = Number(localStorage.getItem(rateKey)); } catch { /* no memory of a rate */ }
    if (remembered > 0) { const d = 10 ** currencyDigits(target.currency); setArrives(String(Math.round(Number(amount) * remembered * d) / d)); }
  }, [amount, crossing, rateKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  // The server refuses to take more than a place, or a main account's unassigned part, holds: say so before it has to.
  const tooMuch = checkSpend(source, amount, { everyAccount: true });
  const option = (a, withAmount) => (
    <SelectItem key={a.id} value={a.id}>{a.label}{withAmount ? ` · ${eur(a.available, a.currency)}${(a.place_count || 0) > 0 ? " not in a place" : ""}` : ""}</SelectItem>
  );
  return (
    <div className="space-y-3 mt-2">
      <div>
        <Label className="mny-muted text-xs">From</Label>
        <Select value={from} onValueChange={setFrom}>
          <SelectTrigger className="mny-field" aria-label="Move money from"><SelectValue placeholder="Select source" /></SelectTrigger>
          <SelectContent>
            {accounts.map((a) => option(a, true))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="mny-muted text-xs">To</Label>
        <Select value={to} onValueChange={setTo}>
          <SelectTrigger className="mny-field" aria-label="Move money to"><SelectValue placeholder="Select destination" /></SelectTrigger>
          <SelectContent>
            {accounts.filter((a) => a.id !== from).map((a) => option(a, false))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="mny-muted text-xs" htmlFor="transfer-amount">Amount ({currencySymbol(source?.currency)})</Label>
        <Input id="transfer-amount" type="number" min={0.01} step={currencyStep(source?.currency)} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" aria-describedby="transfer-note" data-testid="transfer-amount" className="mny-field" />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p id="transfer-note" data-testid="transfer-note" role={tooMuch ? "alert" : undefined} className={cn("text-xs", tooMuch ? "mny-neg" : "mny-muted")}>
            {tooMuch || (source ? `Available to move from ${source.name}: ${eur(spendable(source), source.currency)}.` : "")}
          </p>
          {source && spendable(source) > 0 && (
            <button type="button" className="mny-pill sm" onClick={() => setAmount(String(spendable(source)))}>All of it</button>
          )}
        </div>
      </div>
      {crossing && (
        <div>
          <Label className="mny-muted text-xs" htmlFor="transfer-arrives">Amount arriving in {target.name} ({currencySymbol(target.currency)})</Label>
          <Input id="transfer-arrives" type="number" min={0.01} step={currencyStep(target.currency)} value={arrives} onChange={(e) => { touched.current = true; setArrives(e.target.value); }} placeholder="0.00" aria-describedby="transfer-rate" data-testid="transfer-arrives" className="mny-field" />
          <p id="transfer-rate" data-testid="transfer-rate" className="mny-muted mt-1.5 text-xs">
            {rate ? `1 ${source.currency} = ${rate.toFixed(4)} ${target.currency}. Nothing is converted for you: this is the rate you are giving.` : `These places use different currencies. Enter how much arrives in ${target.currency}.`}
          </p>
        </div>
      )}
      {source && target && Number(amount) > 0 && (
        <div className="mny-tile space-y-1 p-3 text-sm" data-testid="transfer-summary" aria-live="polite">
          <p><span className="mny-num font-semibold">{eur(Number(amount), source.currency)}</span> <span className="mny-muted">leaves {source.label}</span></p>
          <p><span className="mny-num mny-green font-semibold">{eur(crossing ? (Number(arrives) || 0) : Number(amount), target.currency)}</span> <span className="mny-muted">arrives in {target.label}</span></p>
        </div>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" className="mny-pill" onClick={onCancel}>Cancel</button>
        <button type="button" className="mny-pill mny-cta" onClick={() => { if (rate && rateKey) { try { localStorage.setItem(rateKey, String(rate)); } catch { /* not remembered */ } } onSubmit(from, to, amount, crossing ? arrives : null); }} disabled={!from || !to || !amount || from === to || !!tooMuch || (crossing && !(Number(arrives) > 0))}>Transfer</button>
      </div>
    </div>
  );
}


/** The hover card of the spending chart: the day and what was spent. */
function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const day = new Date(`${p.date}T00:00:00`).toLocaleDateString("default", { weekday: "short", day: "numeric", month: "short" });
  return (
    <div className="mny-tip">
      <p className="mny-muted text-xs">{day}</p>
      <p className="mny-num mt-0.5 text-base font-semibold">{eur(p.value)}</p>
    </div>
  );
}

/** The transaction list: two day groups with their header bars and rows (round lead, title and category, figure). */
function TxnListSk() {
  return (
    <div aria-hidden="true">
      {[3, 2].map((rows, g) => (
        <div key={g}>
          <div className="mny-hair flex items-center justify-between border-y bg-[var(--mny-surface-2)] px-5 py-2"><Sk className="h-3 w-24" /><Sk className="h-3 w-12" /></div>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3">
              <Sk className="h-10 w-10 shrink-0 !rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5"><Sk className={i % 2 ? "h-3.5 w-1/4" : "h-3.5 w-1/3"} /><Sk className="h-3 w-1/5" /></div>
              <Sk className="h-4 w-16 shrink-0" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
