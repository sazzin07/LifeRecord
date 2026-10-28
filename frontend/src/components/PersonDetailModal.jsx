import { useState, useMemo, useEffect, useCallback } from "react";
import {
  HandCoins, Receipt, Trash2, Pencil, X, Check, AlertCircle,
} from "lucide-react";
import { api, eur, CATEGORY_COLORS } from "@/lib/api";
import { useFetch, refreshAll } from "@/lib/useFetch";
import { Card, Avatar, Label, EmptyState, SkeletonCard } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Hint } from "@/components/ui/hint";

const TYPE_META = {
  debt: { label: "You paid", icon: Receipt, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-500/10", sign: "+" },
  credit: { label: "They paid", icon: Receipt, color: "text-red-500", bg: "bg-red-50 dark:bg-red-500/10", sign: "-" },
  repayment: { label: "Repayment received", icon: HandCoins, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-500/10", sign: "-" },
  payment_out: { label: "Payment sent", icon: HandCoins, color: "text-red-500", bg: "bg-red-50 dark:bg-red-500/10", sign: "+" },
};

export default function PersonDetailModal({ personId, open, onClose, onEdit, onDelete }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const { data: accounts } = useFetch("/accounts");
  const [payOpen, setPayOpen] = useState(false);
  const [payMode, setPayMode] = useState("in"); // in = received from them, out = sent to them
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Revolut");
  const [accountId, setAccountId] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [deleteItem, setDeleteItem] = useState(null);
  const [deleteItemOpen, setDeleteItemOpen] = useState(false);

  const activeAccounts = useMemo(() => (accounts || []).filter((a) => a.is_active !== false), [accounts]);

  useEffect(() => {
    if (activeAccounts.length && !accountId) {
      const rev = activeAccounts.find((a) => a.type === "revolut" || /revolut/i.test(a.name));
      setAccountId(rev?.id || activeAccounts[0]?.id || "");
    }
  }, [activeAccounts, accountId]);

  const load = useCallback(async () => {
    if (!personId) return;
    setLoading(true);
    try {
      const r = await api.get(`/people/${personId}`);
      setData(r.data);
    } finally {
      setLoading(false);
    }
  }, [personId]);

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
    if (!val || val <= 0) { toast.error("Enter a positive amount"); return; }
    if (!accountId) { toast.error("Select an account"); return; }
    try {
      await api.post("/settlements", {
        person: data.person.name,
        amount: val,
        method,
        account_id: accountId,
        direction: payMode,
      });
      toast.success(payMode === "in" ? "Payment received recorded" : "Payment sent recorded");
      setPayOpen(false);
      setAmount("");
      refreshAll();
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not record payment"); }
  };

  const clearBalance = async () => {
    if (!accountId) { toast.error("Select an account"); return; }
    try {
      await api.post(`/people/${personId}/clear-balance`, {
        person: data.person.name,
        amount: 0,
        method,
        account_id: accountId,
      });
      toast.success("Balance cleared");
      setClearConfirm(false);
      refreshAll();
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not clear balance"); }
  };

  const deleteItemConfirm = async () => {
    if (!deleteItem) return;
    try {
      if (deleteItem.kind === "settlement") {
        await api.delete(`/settlements/${deleteItem.id}`);
      } else {
        await api.delete(`/splits/${deleteItem.id}`);
      }
      toast.success("Record removed");
      setDeleteItemOpen(false);
      setDeleteItem(null);
      refreshAll();
      load();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not remove record"); }
  };

  const net = data?.person?.net || 0;
  const theyOwe = net > 0.005;
  const iOwe = net < -0.005;

  const runningBalance = useMemo(() => {
    if (!data?.ledger) return [];
    let bal = 0;
    return [...data.ledger].reverse().map((item) => {
      bal += item.balance_effect;
      return { ...item, running: round2(bal) };
    }).reverse();
  }, [data?.ledger]);

  const openPay = (mode) => {
    setPayMode(mode);
    setAmount("");
    setPayOpen(true);
  };

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
                    <Button onClick={() => openPay("in")} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="record-payment-btn">
                      <HandCoins className="h-4 w-4 mr-1" /> Record payment
                    </Button>
                  )}
                  {iOwe && (
                    <Button onClick={() => openPay("out")} className="bg-red-500 hover:bg-red-600 text-white" data-testid="send-payment-btn">
                      <HandCoins className="h-4 w-4 mr-1" /> Send payment
                    </Button>
                  )}
                  {(theyOwe || iOwe) && (
                    <Button variant="outline" onClick={() => setClearConfirm(true)} data-testid="clear-balance-btn">
                      <Check className="h-4 w-4 mr-1" /> Clear balance
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => onEdit && onEdit(data?.person)} data-testid="detail-edit-btn"><Pencil className="h-4 w-4 mr-1" /> Edit</Button>
                  <Button variant="outline" className="text-red-500 hover:text-red-600 hover:bg-red-50" onClick={() => setDeleteConfirm(true)} data-testid="detail-delete-btn">
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
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
                      const isSettlement = item.type === "repayment" || item.type === "payment_out";
                      return (
                        <div key={`${item.type}-${item.id}`} className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-slate-50 dark:hover:bg-slate-800/40 group">
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
                          <Hint label={isSettlement ? "Remove payment" : "Remove split / debt record"}><Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500"
                            aria-label={isSettlement ? "Remove payment" : "Remove split / debt record"}
                            onClick={() => { setDeleteItem({ kind: isSettlement ? "settlement" : "split", id: item.id }); setDeleteItemOpen(true); }}
                          >
                            <X className="h-4 w-4" />
                          </Button></Hint>
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
          <DialogHeader>
            <DialogTitle>{payMode === "in" ? `Record payment from ${data?.person?.name}` : `Send payment to ${data?.person?.name}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Amount" type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="payment-amount" />
            <div className="grid grid-cols-2 gap-2">
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger data-testid="payment-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Revolut">Revolut</SelectItem>
                  <SelectItem value="MB WAY">MB WAY</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                  <SelectItem value="Bank transfer">Bank transfer</SelectItem>
                </SelectContent>
              </Select>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger data-testid="payment-account"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {activeAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={recordPayment} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="payment-save">
              Record {amount ? eur(parseFloat(amount)) : ""} {payMode === "in" ? "received" : "sent"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirm} onOpenChange={setDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {data?.person?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the person and remove their splits and payments from your ledger. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="detail-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const id = data?.person?.id; if (id) { onDelete(id); } setDeleteConfirm(false); }} className="bg-red-500 hover:bg-red-600 text-white" data-testid="detail-delete-confirm">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearConfirm} onOpenChange={setClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear balance with {data?.person?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will record a settlement of {eur(Math.abs(net))} into account <b>{activeAccounts.find((a) => a.id === accountId)?.name}</b> and set the balance to zero.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setClearConfirm(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={clearBalance} className="bg-emerald-600 hover:bg-emerald-700 text-white">Clear balance</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteItemOpen} onOpenChange={setDeleteItemOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove record?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteItem?.kind === "settlement"
                ? "This removes the payment record and reverses its effect on the selected account balance."
                : "This removes this person's share from the transaction. The transaction itself remains in your Money tab."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteItemOpen(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteItemConfirm} className="bg-red-500 hover:bg-red-600 text-white">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
