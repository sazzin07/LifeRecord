import { useState, useMemo, useEffect } from "react";
import {
  ArrowUpRight, ArrowDownRight, HandCoins, Receipt, Wallet, CreditCard,
  CalendarDays, CheckCircle2, AlertCircle, Trash2, Pencil, X,
} from "lucide-react";
import { api, eur, CATEGORY_COLORS } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { Card, Avatar, Label, EmptyState, SkeletonCard } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const TYPE_META = {
  debt: { label: "You paid", icon: Receipt, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-500/10", sign: "+" },
  credit: { label: "They paid", icon: Receipt, color: "text-red-500", bg: "bg-red-50 dark:bg-red-500/10", sign: "-" },
  repayment: { label: "Repayment received", icon: HandCoins, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-500/10", sign: "-" },
  payment_out: { label: "Payment sent", icon: HandCoins, color: "text-red-500", bg: "bg-red-50 dark:bg-red-500/10", sign: "+" },
};

export default function PersonDetailModal({ personId, open, onClose, onEdit, onArchive }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Revolut");
  const [account, setAccount] = useState("revolut");
  const [archiveConfirm, setArchiveConfirm] = useState(false);

  useEffect(() => {
    if (!open || !personId) {
      setData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const r = await api.get(`/people/${personId}`);
        if (!cancelled) setData(r.data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, personId]);

  const recordPayment = async () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    await api.post("/settlements", {
      person: data.person.name,
      amount: val,
      method,
      account,
      direction: "in",
    });
    toast.success("Payment recorded");
    setPayOpen(false);
    setAmount("");
    refreshAll();
    load();
  };

  const net = data?.person?.net || 0;
  const theyOwe = net > 0.005;
  const iOwe = net < -0.005;
  const settled = !theyOwe && !iOwe;

  const runningBalance = useMemo(() => {
    if (!data?.ledger) return [];
    let bal = 0;
    return [...data.ledger].reverse().map((item) => {
      bal += item.balance_effect;
      return { ...item, running: round2(bal) };
    }).reverse();
  }, [data?.ledger]);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0">
          {loading || !data ? (
            <div className="p-6 space-y-4">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : (
            <>
              <div className="p-6 border-b border-border">
                <div className="flex items-start gap-4">
                  <Avatar name={data.person.name} photo={data.person.photo} size="h-16 w-16" />
                  <div className="flex-1 min-w-0">
                    <DialogHeader className="text-left">
                      <DialogTitle className="text-2xl">{data.person.name}</DialogTitle>
                      <DialogDescription>
                        {data.person.payment_preference && (
                          <span className="inline-flex items-center gap-1 text-xs">Preferred: {data.person.payment_preference}</span>
                        )}
                      </DialogDescription>
                    </DialogHeader>
                    {data.person.notes && <p className="text-sm text-slate-500 mt-2">{data.person.notes}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className={cn("text-3xl font-extrabold", theyOwe ? "text-emerald-600" : iOwe ? "text-red-500" : "text-slate-400")}>
                      {theyOwe ? "+" : ""}{eur(net)}
                    </div>
                    <p className={cn("text-sm font-medium", theyOwe ? "text-emerald-600" : iOwe ? "text-red-500" : "text-slate-400")}>
                      {theyOwe ? "Owes you" : iOwe ? "You owe" : "Settled up"}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mt-6">
                  <Card className="p-3 text-center">
                    <p className="text-xs text-slate-500">Original debt</p>
                    <p className="text-lg font-bold">{eur(data.summary.total_original_debt)}</p>
                  </Card>
                  <Card className="p-3 text-center">
                    <p className="text-xs text-slate-500">Repaid</p>
                    <p className="text-lg font-bold text-emerald-600">{eur(data.summary.total_repaid)}</p>
                  </Card>
                  <Card className="p-3 text-center">
                    <p className="text-xs text-slate-500">Outstanding</p>
                    <p className={cn("text-lg font-bold", theyOwe ? "text-emerald-600" : iOwe ? "text-red-500" : "")}>{eur(data.summary.current_balance)}</p>
                  </Card>
                </div>

                <div className="flex flex-wrap gap-2 mt-5">
                  {theyOwe && (
                    <Button onClick={() => setPayOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                      <HandCoins className="h-4 w-4 mr-1" /> Record payment
                    </Button>
                  )}
                  <Button variant="outline" onClick={onEdit}><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
                  <Button variant="outline" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => setArchiveConfirm(true)}>
                    <Trash2 className="h-4 w-4 mr-1" /> Archive
                  </Button>
                </div>
              </div>

              <div className="p-6 pt-2">
                <Label className="mb-3 block">Balance history</Label>
                {data.ledger.length === 0 ? (
                  <EmptyState title="No activity" sub="Shared expenses and repayments will appear here." />
                ) : (
                  <div className="space-y-2">
                    {runningBalance.map((item) => {
                      const meta = TYPE_META[item.type];
                      const Icon = meta.icon;
                      return (
                        <div key={`${item.type}-${item.id}`} className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <div className={cn("h-10 w-10 rounded-lg grid place-items-center shrink-0", meta.bg)}>
                            <Icon className={cn("h-5 w-5", meta.color)} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-medium text-sm">{item.merchant}</p>
                              {item.category && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: (CATEGORY_COLORS[item.category] || "#94A3B8") + "22", color: CATEGORY_COLORS[item.category] || "#94A3B8" }}>
                                  {item.category}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500">{item.date} · {item.description}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={cn("font-semibold text-sm", meta.color)}>{meta.sign}{eur(item.amount)}</p>
                            <p className="text-xs text-slate-400">bal {eur(item.running)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Record payment dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Record payment from {data?.person?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Select value={method} onValueChange={setMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Revolut">Revolut</SelectItem><SelectItem value="MB WAY">MB WAY</SelectItem><SelectItem value="Cash">Cash</SelectItem></SelectContent></Select>
              <Select value={account} onValueChange={setAccount}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="revolut">Into Revolut</SelectItem><SelectItem value="cash">Into Cash</SelectItem></SelectContent></Select>
            </div>
            <Button onClick={recordPayment} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">Record {amount ? eur(parseFloat(amount)) : ""}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={archiveConfirm} onOpenChange={setArchiveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive {data?.person?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This person has transaction history, so they will be archived instead of deleted. Their debts and payments remain visible and the balances stay accurate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { onArchive(data.person.id); setArchiveConfirm(false); }} className="bg-red-500 hover:bg-red-600 text-white">Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
