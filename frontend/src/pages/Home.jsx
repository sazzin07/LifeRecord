import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Wallet, TrendingDown, Users, Utensils, Dumbbell, Scale, ShoppingCart,
  CheckSquare, Sparkles, ArrowUpRight, ArrowRight, Lightbulb, Receipt,
  ArrowDownLeft, ArrowUpRight as ArrowUpRightIcon, ArrowLeftRight,
} from "lucide-react";
import { useFetch } from "@/lib/useFetch";
import { eur } from "@/lib/api";
import { moneyCompact } from "@/lib/money";
import { Card, StatCard, Label } from "@/components/common";
import { Resolve, Sk, SkRows } from "@/components/skeletons";
import { openAI } from "@/components/AppShell";
import { ReminderBanner } from "@/pages/nutrition/Reminders";
import { cn } from "@/lib/utils";

function Ring({ value, max, color = "#10B981", label, unit }) {
  const pct = Math.min(100, max ? (value / max) * 100 : 0);
  const r = 30, c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[76px] w-[76px]">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 76 76">
          <circle cx="38" cy="38" r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-slate-100 dark:text-slate-800" />
          <circle cx="38" cy="38" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={c} strokeDashoffset={c - (pct / 100) * c} />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="stat-num sk-ph text-sm font-bold">{Math.round(value)}</span>
        </div>
      </div>
      <span className="mt-1.5 text-xs font-medium text-slate-500">{label}</span>
    </div>
  );
}

/** A figure in the dark hero that is still on its way: a pale block of the figure's own size (it would not show on the dark card as a grey one). */
function HeroFigure({ className, label }) {
  if (label) return <span>{label}</span>;
  return <span aria-hidden="true" className={`skeleton block !bg-white/15 ${className}`} />;
}

/** The four rings of "Nutrition today" as they will be: the REAL rings (same size, same labels) with nothing in them yet, and the figures held as placeholders. */
function RingsSkeleton() {
  return (
    <div data-skeleton="" inert="true" aria-hidden="true">
      <div className="grid grid-cols-4 gap-1">
        <Ring value={0} max={0} color="#10B981" label="kcal" />
        <Ring value={0} max={0} color="#6366F1" label="Protein" />
        <Ring value={0} max={0} color="#F59E0B" label="Carbs" />
        <Ring value={0} max={0} color="#EF4444" label="Fat" />
      </div>
      <p className="mt-3 text-xs text-slate-500"><span className="sk-ph">Reference 0000 kcal</span> · grams for the macros</p>
    </div>
  );
}

export default function Home() {
  const nav = useNavigate();
  const today = new Date().toISOString().slice(0, 10);
  // Seven requests, seven independent sections: each one draws as soon as ITS data is here, and none waits for the slowest.
  const { data: sum, error: sumError, reload: reloadSum } = useFetch("/analytics/summary");
  const { data: tasks, error: tasksError, reload: reloadTasks } = useFetch("/tasks");
  const { data: people, error: peopleError, reload: reloadPeople } = useFetch("/people");
  const { data: weight } = useFetch("/weight");
  const { data: day, error: dayError, reload: reloadDay } = useFetch("/nutrition/day"); // the same day, targets and time zone the Nutrition page uses
  const { data: groceries, error: groceriesError, reload: reloadGroceries } = useFetch("/groceries");
  const { data: transactions, error: txnsError, reload: reloadTxns } = useFetch(`/transactions?start=${today}&end=${today}`);

  const nutri = useMemo(() => {
    const t = day?.totals || {};
    const pr = day?.progress || {};
    // rings fill towards the reference: a target where there is one, otherwise the top of the recommended range
    return {
      cal: t.energy_kcal || 0, p: t.protein_g || 0, c: t.carbs_available_g || 0, f: t.fat_g || 0,
      calMax: day?.energy_target || 0, pMax: pr.protein_g?.target ?? pr.protein_g?.max ?? 0,
      cMax: pr.carbs_available_g?.target ?? pr.carbs_available_g?.max ?? 0, fMax: pr.fat_g?.target ?? pr.fat_g?.max ?? 0,
    };
  }, [day]);

  const sumWait = !sum && !sumError, dayWait = !day && !dayError, peopleWait = !people && !peopleError;
  const tasksWait = !tasks && !tasksError, groceriesWait = !groceries && !groceriesError, txnsWait = !transactions && !txnsError;
  const lowStock = (groceries || []).filter((g) => g.low_threshold && g.quantity <= g.low_threshold);
  const openTasks = (tasks || []).filter((t) => !t.done);
  const todaysTxns = useMemo(() => {
    const list = transactions || [];
    return list.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }, [transactions]);
  const todayTotals = useMemo(() => todaysTxns.reduce((acc, t) => {
    const amt = Math.abs(parseFloat(t.gross_amount || t.amount || 0));
    if (t.type === "income") acc.income += amt;
    else if (t.type === "expense") acc.expense += amt;
    else if (t.type === "transfer") acc.transfer += amt;
    return acc;
  }, { income: 0, expense: 0, transfer: 0 }), [todaysTxns]);
  const lastW = weight?.length ? weight[weight.length - 1] : null;
  const prevW = weight?.length > 1 ? weight[weight.length - 2] : null;
  const wDelta = lastW && prevW ? (lastW.weight - prevW.weight).toFixed(1) : null;

  const insights = useMemo(() => {
    const out = [];
    if (sum) {
      if (sum.cash_spent > 0) out.push(`${eur(sum.cash_spent)} was spent in cash; ${eur(sum.card_spent)} on card.`);
      if (sum.pending > 0) out.push(`You are currently owed ${eur(sum.pending)} in pending refunds.`);
      if (sum.grocery?.out_of_stock?.length) out.push(`Out of stock: ${sum.grocery.out_of_stock.slice(0, 3).join(", ")}.`);
      if (sum.grocery?.low_stock?.length) out.push(`${sum.grocery.low_stock.length} grocery item${sum.grocery.low_stock.length > 1 ? "s are" : " is"} running low.`);
    }
    const topDebt = (people || []).filter((p) => p.owes_me > 0).sort((a, b) => b.owes_me - a.owes_me)[0];
    if (topDebt) out.push(`${topDebt.name} still owes you ${eur(topDebt.owes_me)}.`);
    if (nutri.p) out.push(`You've logged ${Math.round(nutri.p)}g protein today.`);
    if (!weight?.length) out.push("You haven't completed a weight check-in yet.");
    return out.slice(0, 4);
  }, [sum, people, nutri, weight]);

  return (
    <div className="space-y-6">
      {/* Hero */}
      {sumError && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300" data-testid="home-summary-error">The balances could not be loaded. <button type="button" onClick={reloadSum} className="font-medium underline underline-offset-2">Try again</button></p>}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
        className="rounded-3xl bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 text-white p-6 md:p-8 relative overflow-hidden">
        <div className="absolute -top-20 -right-16 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="relative">
          <p className="text-slate-300 text-sm">Total available</p>
          <div className="stat-num text-4xl md:text-5xl font-extrabold tracking-tight mt-1">{sum ? eur(sum.total_available) : <HeroFigure className="h-10 w-56 md:h-12" label={sumError ? "—" : null} />}</div>
          {sum?.by_currency && <p className="mt-1 text-sm text-slate-300" data-testid="home-by-currency">{sum.by_currency.filter((r) => r.currency !== sum.main_currency).map((r) => `+ ${eur(r.total_available, r.currency)} in ${r.currency}`).join("  ·  ")}</p>}
          <div className="flex flex-wrap gap-6 mt-5">
            <div><Label><span className="text-slate-400">Cash</span></Label><div className="stat-num font-bold text-lg">{sum ? eur(sum.cash_available) : <HeroFigure className="h-6 w-20" label={sumError ? "—" : null} />}</div></div>
            <div><Label><span className="text-slate-400">Revolut</span></Label><div className="stat-num font-bold text-lg">{sum ? eur(sum.revolut) : <HeroFigure className="h-6 w-20" label={sumError ? "—" : null} />}</div></div>
            <div><Label><span className="text-slate-400">Owed to you</span></Label><div className="stat-num font-bold text-lg text-emerald-400">{sum ? eur(sum.owed_to_me) : <HeroFigure className="h-6 w-20" label={sumError ? "—" : null} />}</div></div>
          </div>
          <button data-testid="hero-ask-ai" onClick={() => openAI()}
            className="mt-6 inline-flex items-center gap-2 rounded-full glass border border-white/20 px-4 py-2 text-sm font-medium hover:bg-white/10 transition-colors">
            <Sparkles className="h-4 w-4 text-emerald-400" /> Ask what's happening today
          </button>
        </div>
      </motion.div>

      {/* Insights */}
      {(sumWait || peopleWait || dayWait || !weight) && !sumError && (
        <Card className="p-5" aria-hidden="true"><div className="mb-3 flex h-6 items-center gap-2"><Sk className="h-4 w-4 !rounded" /><Sk className="h-4 w-44" /></div><div className="grid gap-2 sm:grid-cols-2">{[0, 1, 2, 3].map((i) => <Sk key={i} className="h-10 !rounded-xl" />)}</div></Card>
      )}
      {!sumWait && !peopleWait && !dayWait && weight && insights.length > 0 && (
        <Card className="p-5 lm-in">
          <div className="flex items-center gap-2 mb-3">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">Things you should know</h3>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {insights.map((t, i) => (
              <div key={i} className="flex items-start gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/50 px-3 py-2.5 text-sm text-slate-700 dark:text-slate-300">
                <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />{t}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => nav("/groceries")} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
          <ShoppingCart className="h-3.5 w-3.5" /> Go shopping
        </button>
        <button onClick={() => nav("/tasks")} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
          <CheckSquare className="h-3.5 w-3.5" /> Add task
        </button>
        <button onClick={() => nav("/money")} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
          <Wallet className="h-3.5 w-3.5" /> Add expense
        </button>
      </div>

      <ReminderBanner onLogMeal={() => nav("/nutrition")} />

      {/* Stat grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard testid="stat-spent" label="Spent (all)" loading={sumWait} value={sum ? moneyCompact(sum.gross) : "—"} hint={sum ? `Your share ${eur(sum.personal)}` : ""} icon={TrendingDown} />
        <StatCard testid="stat-owed" label="You are owed" loading={sumWait} value={sum ? moneyCompact(sum.owed_to_me) : "—"} hint={sum ? `You owe ${eur(sum.i_owe)}` : ""} icon={Users} accent="text-emerald-600 dark:text-emerald-400" />
        <StatCard testid="stat-weight" label="Current weight" loading={!weight} value={lastW ? `${lastW.weight} kg` : "—"} hint={wDelta ? `${wDelta > 0 ? "+" : ""}${wDelta} kg vs last` : "No data"} icon={Scale} />
        <StatCard testid="stat-tasks" label="Open tasks" loading={tasksWait} value={openTasks.length} hint={`${(tasks || []).length} total today`} icon={CheckSquare} />
      </div>

      {/* Widgets */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5 lm-in" data-fid="home-nutrition">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2"><Utensils className="h-4 w-4 text-emerald-600" /><h3 className="font-semibold">Nutrition today</h3></div>
            <button onClick={() => nav("/nutrition")} aria-label="Open Nutrition" className="text-slate-400 hover:text-emerald-600"><ArrowRight className="h-4 w-4" /></button>
          </div>
          <Resolve loading={dayWait} error={dayError} onRetry={reloadDay} label="Loading nutrition" what="today's nutrition" skeleton={<RingsSkeleton />}>
            <div className="grid grid-cols-4 gap-1">
              <Ring value={nutri.cal} max={nutri.calMax} color="#10B981" label="kcal" />
              <Ring value={nutri.p} max={nutri.pMax} color="#6366F1" label="Protein" />
              <Ring value={nutri.c} max={nutri.cMax} color="#F59E0B" label="Carbs" />
              <Ring value={nutri.f} max={nutri.fMax} color="#EF4444" label="Fat" />
            </div>
            <p className="mt-3 text-xs text-slate-500">{day?.energy_target ? `Reference ${Math.round(day.energy_target)} kcal` : "No energy reference yet"} · grams for the macros</p>
          </Resolve>
        </Card>

        <Card className="p-5 lm-in" data-fid="home-people">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2"><Users className="h-4 w-4 text-emerald-600" /><h3 className="font-semibold">People</h3></div>
            <button onClick={() => nav("/people")} aria-label="Open People" className="text-slate-400 hover:text-emerald-600"><ArrowRight className="h-4 w-4" /></button>
          </div>
          <Resolve loading={peopleWait} error={peopleError} onRetry={reloadPeople} label="Loading people" what="people" skeleton={<SkRows n={3} lead={null} rowClass="py-2" />}>
          <div className="space-y-2">
            {(people || []).filter((p) => p.owes_me > 0 || p.i_owe > 0).slice(0, 4).map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-slate-700 dark:text-slate-300">{p.name}</span>
                <span className="shrink-0 text-right">
                  {p.owes_me > 0 && <span className="stat-num block font-semibold text-emerald-700 dark:text-emerald-400">owes you {eur(p.owes_me)}</span>}
                  {p.i_owe > 0 && <span className="stat-num block font-semibold text-amber-700 dark:text-amber-400">you owe {eur(p.i_owe)}</span>}
                </span>
              </div>
            ))}
            {(people || []).filter((p) => p.owes_me > 0 || p.i_owe > 0).length === 0 && <p className="text-sm text-slate-500">No outstanding balances.</p>}
          </div>
          </Resolve>
        </Card>

        <Card className="p-5 lm-in" data-fid="home-groceries">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-emerald-600" /><h3 className="font-semibold">Groceries</h3></div>
            <button onClick={() => nav("/groceries")} aria-label="Open Groceries" className="text-slate-400 hover:text-emerald-600"><ArrowRight className="h-4 w-4" /></button>
          </div>
          <Resolve loading={groceriesWait} error={groceriesError} onRetry={reloadGroceries} label="Loading groceries" what="groceries" skeleton={<div className="flex gap-6">{[0, 1, 2].map((i) => <div key={i} className="space-y-1.5"><Sk className="h-7 w-10" /><Sk className="h-3 w-16" /></div>)}</div>}>
          <div className="flex gap-6">
            <div><div className="stat-num text-2xl font-extrabold">{(groceries || []).length}</div><Label>In inventory</Label></div>
            <div><div className="stat-num text-2xl font-extrabold text-amber-500">{lowStock.length}</div><Label>Low stock</Label></div>
            <div><div className="stat-num text-2xl font-extrabold text-emerald-600">{sum?.grocery?.pending_total || 0}</div><Label>To buy</Label></div>
          </div>
          {lowStock.length > 0 && <p className="mt-3 text-xs text-slate-500">Low: {lowStock.map((g) => g.name).join(", ")}</p>}
          {(sum?.grocery?.active_lists || []).length > 0 && (
            <div className="mt-3 space-y-1.5">
              {(sum.grocery.active_lists || []).slice(0, 3).map((lst) => (
                <div key={lst.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700 dark:text-slate-300 truncate max-w-[60%]">{lst.name}</span>
                  <span className="text-xs text-slate-500">{lst.pending_count} pending{lst.budget != null ? ` · ${eur(lst.estimated_total)} / ${eur(lst.budget)}` : ""}</span>
                </div>
              ))}
            </div>
          )}
          </Resolve>
        </Card>
      </div>

      {/* Tasks preview */}
      <Card className="p-5 lm-in" data-fid="home-tasks">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><CheckSquare className="h-4 w-4 text-emerald-600" /><h3 className="font-semibold">Today's tasks</h3></div>
          <button onClick={() => nav("/tasks")} className="text-sm text-emerald-600 font-medium inline-flex items-center gap-1">Open <ArrowUpRight className="h-3.5 w-3.5" /></button>
        </div>
        <Resolve loading={tasksWait} error={tasksError} onRetry={reloadTasks} label="Loading tasks" what="tasks" skeleton={<div className="space-y-2.5">{[0, 1, 2].map((i) => <div key={i} className="flex items-center gap-3"><Sk className="h-2 w-2 rounded-full" /><Sk className={i === 1 ? "h-3.5 w-2/5" : "h-3.5 w-3/5"} /></div>)}</div>}>
        <div className="space-y-1.5">
          {openTasks.slice(0, 5).map((t) => (
            <div key={t.id} className="flex items-center gap-3 text-sm">
              <div className={cn("h-2 w-2 rounded-full", t.priority === "high" ? "bg-red-500" : t.priority === "low" ? "bg-slate-300" : "bg-emerald-500")} />
              <span className="text-slate-700 dark:text-slate-300">{t.title}</span>
            </div>
          ))}
          {openTasks.length === 0 && <p className="text-sm text-slate-500">All done for today. Nice.</p>}
        </div>
        </Resolve>
      </Card>

      {/* Today's transactions */}
      <Card className="p-5 lm-in" data-fid="home-txns">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><Receipt className="h-4 w-4 text-emerald-600" /><h3 className="font-semibold">Today's transactions</h3></div>
          <button onClick={() => nav("/money")} className="text-sm text-emerald-600 font-medium inline-flex items-center gap-1">Money <ArrowUpRight className="h-3.5 w-3.5" /></button>
        </div>
        <Resolve loading={txnsWait} error={txnsError} onRetry={reloadTxns} label="Loading today's transactions" what="today's transactions" skeleton={<SkRows n={3} lead="square" rowClass="py-1.5" />}>
        {todaysTxns.length === 0 ? (
          <p className="text-sm text-slate-500">No transactions yet today.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-3 mb-4">
              {todayTotals.income > 0 && <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">+{eur(todayTotals.income)} income</span>}
              {todayTotals.expense > 0 && <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300">-{eur(todayTotals.expense)} expense</span>}
              {todayTotals.transfer > 0 && <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{eur(todayTotals.transfer)} transfer</span>}
            </div>
            <div className="space-y-2">
              {todaysTxns.slice(0, 8).map((t) => {
                const isIncome = t.type === "income";
                const isExpense = t.type === "expense";
                const isTransfer = t.type === "transfer";
                const amount = parseFloat(t.gross_amount || t.amount || 0);
                return (
                  <div key={t.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <div className={cn("h-9 w-9 rounded-lg grid place-items-center shrink-0",
                      isIncome ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10" :
                      isExpense ? "bg-red-50 text-red-500 dark:bg-red-500/10" :
                      "bg-slate-100 text-slate-600 dark:bg-slate-800")}>
                      {isIncome ? <ArrowDownLeft className="h-4 w-4" /> : isExpense ? <ArrowUpRightIcon className="h-4 w-4" /> : <ArrowLeftRight className="h-4 w-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.merchant || t.description || t.category || (isTransfer ? "Transfer" : "Transaction")}</p>
                      <p className="text-xs text-slate-500">{t.category}{t.account_name ? ` · ${t.account_name}` : ""}</p>
                    </div>
                    <div className={cn("text-sm font-semibold shrink-0",
                      isIncome ? "text-emerald-600" : isExpense ? "text-red-500" : "text-slate-700 dark:text-slate-200")}>
                      {isIncome ? "+" : isExpense ? "-" : ""}{eur(amount)}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
        </Resolve>
      </Card>
    </div>
  );
}
