import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, AreaChart, Area, XAxis,
  BarChart, Bar, YAxis, CartesianGrid,
} from "recharts";
import {
  Plus, Trash2, Wallet, CreditCard, Pencil, Search, Download, ArrowUpRight,
  ArrowDownRight, TrendingUp, CalendarDays, SlidersHorizontal, X, ChevronDown,
  Target, Store, Receipt,
} from "lucide-react";
import { api, eur, CATEGORY_COLORS } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import {
  Card, StatCard, SectionHeading, EmptyState, Label, SkeletonCard, ConfidenceBadge,
} from "@/components/common";
import { ExpenseDialog } from "@/components/ExpenseDialog";
import { EditExpenseDialog } from "@/components/EditExpenseDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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

function periodParams(period) {
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (period === "day") return { start: iso(now), end: iso(now) };
  if (period === "week") { const s = new Date(now); s.setDate(s.getDate() - 6); return { start: iso(s), end: iso(now) }; }
  if (period === "all") return {};
  return { month: period }; // yyyy-mm
}

function formatMonthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1).toLocaleString("default", { month: "long", year: "numeric" });
}

function exportCSV(rows) {
  const header = ["Date", "Merchant", "Category", "Account", "Gross", "Personal", "Reimbursable", "Refund Status", "People"];
  const lines = rows.map((t) => [
    t.date,
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

export default function Money() {
  const now = new Date();
  const curYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const PERIODS = [{ id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "all", label: "All Time" }];

  const [period, setPeriod] = useState("week");
  const [pm, setPm] = useState("all");
  const [sum, setSum] = useState(null);
  const [txns, setTxns] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editTxn, setEditTxn] = useState(null);
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [sort, setSort] = useState("date_desc");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [budgetForm, setBudgetForm] = useState({});
  const scrollRef = useRef(null);

  const load = useCallback(async () => {
    const p = periodParams(period);
    const qs = new URLSearchParams(p).toString();
    const tqs = new URLSearchParams({ ...p, ...(pm !== "all" ? { payment_method: pm } : {}) }).toString();
    try {
      const [s, t, c] = await Promise.all([
        api.get(`/analytics/summary${qs ? `?${qs}` : ""}`),
        api.get(`/transactions${tqs ? `?${tqs}` : ""}`),
        api.get("/categories"),
      ]);
      setSum(s.data);
      setTxns(t.data);
      setCategories(c.data);
    } finally { setLoading(false); }
  }, [period, pm]);

  useEffect(() => {
    setLoading(true);
    load();
    const h = () => load();
    window.addEventListener("lm:refresh", h);
    return () => window.removeEventListener("lm:refresh", h);
  }, [load]);

  const del = async (id) => {
    await api.delete(`/transactions/${id}`);
    toast.success("Deleted");
    refreshAll();
  };

  const expenses = useMemo(() => txns.filter((t) => t.type === "expense"), [txns]);

  const months = useMemo(() => {
    const base = (sum?.months || []).map((k) => ({ key: k, label: formatMonthLabel(k) }));
    if (!base.some((m) => m.key === curYM)) base.unshift({ key: curYM, label: formatMonthLabel(curYM) });
    return base.sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [sum, curYM]);

  const filteredExpenses = useMemo(() => {
    let rows = [...expenses];
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
    rows.sort((a, b) => {
      if (sort === "date_desc") return b.date.localeCompare(a.date) || b.created_at?.localeCompare(a.created_at);
      if (sort === "date_asc") return a.date.localeCompare(b.date) || a.created_at?.localeCompare(b.created_at);
      if (sort === "amount_desc") return b.gross_amount - a.gross_amount;
      if (sort === "amount_asc") return a.gross_amount - b.gross_amount;
      return (a.merchant || "").localeCompare(b.merchant || "");
    });
    return rows;
  }, [expenses, search, catFilter, sort]);

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

  return (
    <div className="space-y-6">
      <SectionHeading title="Money" sub="Cash, card, shared expenses and refunds"
        action={
          <div className="flex items-center gap-2">
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

      {/* Period filter — horizontally scrollable on mobile */}
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
                title={enabled ? "" : "Available once this month is reached"}
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
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <StatCard testid="money-cash" label="Cash balance" value={eur(sum?.cash)} icon={Wallet} hint="Wallet" />
            <StatCard testid="money-revolut" label="Card balance" value={eur(sum?.revolut)} accent="text-[#1964FF]" icon={CreditCard} hint="Revolut" />
            <StatCard testid="money-total" label="Total available" value={eur(sum?.total_available)} accent="text-emerald-600 dark:text-emerald-400" hint="Cash + card" />
            <StatCard testid="money-pending" label="Pending refunds" value={eur(sum?.pending)} accent="text-amber-600 dark:text-amber-400" hint={`Refunded ${eur(sum?.refunded)}`} />
          </div>

          {/* Period spending */}
          <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
            <StatCard testid="money-gross" label="Spent (period)" value={eur(sum?.gross)} hint={`Your share ${eur(sum?.personal)}`} />
            <StatCard testid="money-card-spent" label="Card spending" value={eur(sum?.card_spent)} icon={CreditCard} />
            <StatCard testid="money-cash-spent" label="Cash spending" value={eur(sum?.cash_spent)} icon={Wallet} />
            <StatCard testid="money-reimbursable" label="Owed by others" value={eur(sum?.reimbursable)} />
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
                      <span>{eur(group.reduce((a, t) => a + t.gross_amount, 0))}</span>
                    </div>
                    {group.map((t) => {
                      const badge = REFUND_BADGE[t.refund_status];
                      return (
                        <div key={t.id} data-testid={`txn-${t.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 group">
                          <div className="h-9 w-9 rounded-xl grid place-items-center shrink-0" style={{ background: (CATEGORY_COLORS[t.category] || "#94A3B8") + "22" }}>
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLORS[t.category] || "#94A3B8" }} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm truncate">{t.merchant || t.description || t.category}</p>
                              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                                {t.payment_method === "cash" ? <Wallet className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}{t.payment_method}
                              </span>
                              {badge && t.reimbursable_amount > 0.005 && <ConfidenceBadge type={badge.type}>{badge.label}</ConfidenceBadge>}
                            </div>
                            <p className="text-xs text-slate-500">{t.category}{t.responsible?.length ? ` · with ${t.responsible.join(", ")}` : ""}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="stat-num font-semibold text-sm">{eur(t.gross_amount)}</p>
                            {t.reimbursable_amount > 0.005 && <p className="text-xs text-amber-600 dark:text-amber-400">{eur(t.remaining_refund)} owed</p>}
                          </div>
                          <div className="flex items-center gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <button data-testid={`edit-txn-${t.id}`} onClick={() => setEditTxn(t)} className="p-1.5 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800"><Pencil className="h-4 w-4" /></button>
                            <button data-testid={`del-txn-${t.id}`} onClick={() => del(t.id)} className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Trash2 className="h-4 w-4" /></button>
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
    </div>
  );
}
