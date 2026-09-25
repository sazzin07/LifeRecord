import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, AreaChart, Area } from "recharts";
import { Plus, Trash2, ArrowLeftRight, Wallet } from "lucide-react";
import { api, eur, CATEGORY_COLORS } from "@/lib/api";
import { useFetch, refreshAll } from "@/lib/useFetch";
import { Card, StatCard, SectionHeading, EmptyState, Label, SkeletonCard, ConfidenceBadge } from "@/components/common";
import { ExpenseDialog } from "@/components/ExpenseDialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MONTH_NAMES = { "09": "September", "10": "October", "11": "November", "12": "December", "01": "January", "02": "February", "03": "March", "04": "April", "05": "May", "06": "June", "07": "July", "08": "August" };
const label = (m) => (m ? `${MONTH_NAMES[m.slice(5)]} ${m.slice(0, 4)}` : "All time");

export default function Money() {
  const [month, setMonth] = useState("");
  const [expenseOpen, setExpenseOpen] = useState(false);
  const { data: sum, loading } = useFetch(`/analytics/summary${month ? `?month=${month}` : ""}`);
  const { data: accounts } = useFetch("/accounts");
  const [txns, setTxns] = useState([]);

  const loadTxns = () => api.get(`/transactions${month ? `?month=${month}` : ""}`).then((r) => setTxns(r.data));
  useEffect(() => { loadTxns(); const h = () => loadTxns(); window.addEventListener("lm:refresh", h); return () => window.removeEventListener("lm:refresh", h); }, [month]);

  const del = async (id) => { await api.delete(`/transactions/${id}`); toast.success("Deleted"); refreshAll(); };

  const cash = accounts?.find((a) => a.id === "cash")?.balance || 0;
  const rev = accounts?.find((a) => a.id === "revolut")?.balance || 0;

  return (
    <div className="space-y-6">
      <SectionHeading title="Money" sub="Cash, Revolut, shared expenses and reimbursements"
        action={
          <div className="flex items-center gap-2">
            <Select value={month || "all"} onValueChange={(v) => setMonth(v === "all" ? "" : v)}>
              <SelectTrigger data-testid="month-select" className="w-[150px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                {(sum?.months || []).map((m) => <SelectItem key={m} value={m}>{label(m)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button data-testid="add-expense-btn" onClick={() => setExpenseOpen(true)} className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="h-4 w-4 mr-1" />Add expense</Button>
          </div>
        } />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard testid="money-cash" label="Cash" value={eur(cash)} icon={Wallet} hint="Wallet balance" />
            <StatCard testid="money-revolut" label="Revolut" value={eur(rev)} accent="text-[#1964FF]" hint="Card balance" />
            <StatCard testid="money-gross" label="Gross spending" value={eur(sum?.gross)} hint={`${label(month)}`} />
            <StatCard testid="money-personal" label="Actual personal" value={eur(sum?.personal)} accent="text-emerald-600 dark:text-emerald-400" hint={`${eur(sum?.reimbursable)} shared`} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <Label>Spending over time</Label>
              <ResponsiveContainer width="100%" height={200} className="mt-3">
                <AreaChart data={sum?.by_day || []}>
                  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10B981" stopOpacity={0.35} /><stop offset="100%" stopColor="#10B981" stopOpacity={0} /></linearGradient></defs>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} stroke="#94A3B8" />
                  <Tooltip formatter={(v) => eur(v)} labelStyle={{ color: "#0F172A" }} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  <Area type="monotone" dataKey="value" stroke="#10B981" strokeWidth={2} fill="url(#g)" />
                </AreaChart>
              </ResponsiveContainer>
            </Card>
            <Card className="p-5">
              <Label>By category</Label>
              {sum?.by_category?.length ? (
                <ResponsiveContainer width="100%" height={200} className="mt-3">
                  <PieChart>
                    <Pie data={sum.by_category} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                      {sum.by_category.map((e, i) => <Cell key={i} fill={CATEGORY_COLORS[e.name] || "#94A3B8"} />)}
                    </Pie>
                    <Tooltip formatter={(v) => eur(v)} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-sm text-slate-500 mt-8 text-center">No spending yet.</p>}
            </Card>
          </div>

          <Card>
            <div className="p-5 pb-3"><h3 className="font-semibold">Transactions — {label(month)}</h3></div>
            {txns.length === 0 ? (
              <EmptyState icon={Wallet} title="No transactions yet" sub="Add an expense or ask the assistant to log one for you."
                action={<Button onClick={() => setExpenseOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="h-4 w-4 mr-1" />Add expense</Button>} />
            ) : (
              <div className="divide-y divide-border">
                {txns.map((t) => (
                  <div key={t.id} data-testid={`txn-${t.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 group">
                    <div className="h-9 w-9 rounded-xl grid place-items-center shrink-0" style={{ background: (CATEGORY_COLORS[t.category] || "#94A3B8") + "22" }}>
                      {t.type === "transfer" ? <ArrowLeftRight className="h-4 w-4 text-slate-500" /> : <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY_COLORS[t.category] || "#94A3B8" }} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm truncate">{t.merchant || t.description || t.category}</p>
                        {t.splits?.length > 1 && <ConfidenceBadge type="exact">Shared</ConfidenceBadge>}
                      </div>
                      <p className="text-xs text-slate-500">{t.date} · {t.category} · {t.account}</p>
                    </div>
                    <div className="text-right">
                      <p className="stat-num font-semibold text-sm">{eur(t.gross_amount)}</p>
                      {t.reimbursable_amount > 0.005 && <p className="text-xs text-emerald-600 dark:text-emerald-400">you: {eur(t.personal_amount)}</p>}
                    </div>
                    <button data-testid={`del-txn-${t.id}`} onClick={() => del(t.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-opacity"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
      <ExpenseDialog open={expenseOpen} setOpen={setExpenseOpen} />
    </div>
  );
}
