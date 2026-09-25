import { Trash2, ShoppingCart, AlertTriangle } from "lucide-react";
import { api, eur } from "@/lib/api";
import { useFetch, refreshAll } from "@/lib/useFetch";
import { Card, SectionHeading, EmptyState, ConfidenceBadge } from "@/components/common";
import { cn } from "@/lib/utils";

export default function Groceries() {
  const { data: items, loading } = useFetch("/groceries");
  const del = async (id) => { await api.delete(`/groceries/${id}`); refreshAll(); };
  const arr = items || [];
  const low = arr.filter((g) => g.low_threshold && g.quantity <= g.low_threshold);

  return (
    <div className="space-y-6">
      <SectionHeading title="Groceries" sub="Inventory, prices and stock levels" />
      {low.length > 0 && (
        <Card className="p-4 flex items-center gap-3 border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/10">
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-300"><b>{low.length}</b> item{low.length > 1 ? "s" : ""} running low: {low.map((g) => g.name).join(", ")}</p>
        </Card>
      )}
      {loading ? <div className="skeleton h-64 rounded-2xl" /> : arr.length === 0 ? (
        <Card><EmptyState icon={ShoppingCart} title="Inventory is empty" sub="Add groceries manually or let the assistant log a purchase." /></Card>
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {arr.map((g) => {
              const isLow = g.low_threshold && g.quantity <= g.low_threshold;
              return (
                <div key={g.id} data-testid={`grocery-${g.id}`} className="flex items-center gap-3 px-5 py-3 group">
                  <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 grid place-items-center shrink-0"><ShoppingCart className="h-4 w-4 text-emerald-600" /></div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{g.name}</p>
                    <p className="text-xs text-slate-500">{g.category}{g.store ? ` · ${g.store}` : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className={cn("stat-num text-sm font-semibold", isLow && "text-amber-500")}>{g.quantity} {g.unit}</p>
                    {g.price != null ? <ConfidenceBadge type="historical">{eur(g.price)}</ConfidenceBadge> : <ConfidenceBadge type="unknown">Price unknown</ConfidenceBadge>}
                  </div>
                  <button onClick={() => del(g.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
