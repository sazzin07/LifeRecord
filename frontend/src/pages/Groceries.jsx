import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ShoppingCart, Package, Plus, Trash2, Pencil, Sparkles, Check, Store,
  AlertTriangle, Search, X, ChevronDown, ChevronUp, ListChecks, ArrowRight,
  RotateCcw, TrendingDown, Archive, Loader2, Receipt, Filter, Beef, Fish,
  Egg, Milk, Wheat, Apple, Carrot, Snowflake, Cookie, Wine, MoreHorizontal,
  History, Repeat, Lightbulb, TrendingUp, Minus
} from "lucide-react";
import { api, eur } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { Card, SectionHeading, EmptyState, Label, ConfidenceBadge } from "@/components/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const CATS = ["Meat", "Fish", "Eggs", "Dairy", "Carbohydrates", "Fruit", "Vegetables", "Frozen", "Pantry", "Snacks", "Drinks", "Other"];
const UNITS = ["unit", "kg", "g", "L", "ml", "pack", "bottle", "can", "box", "bag", "bunch", "jar"];

const CAT_META = {
  Meat: { icon: Beef, color: "#EF4444" },
  Fish: { icon: Fish, color: "#0EA5E9" },
  Eggs: { icon: Egg, color: "#F59E0B" },
  Dairy: { icon: Milk, color: "#3B82F6" },
  Carbohydrates: { icon: Wheat, color: "#F97316" },
  Fruit: { icon: Apple, color: "#EC4899" },
  Vegetables: { icon: Carrot, color: "#10B981" },
  Frozen: { icon: Snowflake, color: "#06B6D4" },
  Pantry: { icon: Package, color: "#8B5CF6" },
  Snacks: { icon: Cookie, color: "#D946EF" },
  Drinks: { icon: Wine, color: "#14B8A6" },
  Other: { icon: MoreHorizontal, color: "#64748B" },
};

const PRICE_CONF = {
  known: { type: "exact", label: "Known price" },
  estimated: { type: "estimated", label: "Estimated" },
  unknown: { type: "unknown", label: "Unknown" },
};

function CatIcon({ category, className }) {
  const meta = CAT_META[category] || CAT_META.Other;
  const Icon = meta.icon;
  return (
    <div className={cn("h-9 w-9 rounded-xl grid place-items-center shrink-0", className)} style={{ background: `${meta.color}22` }}>
      <Icon className="h-4 w-4" style={{ color: meta.color }} />
    </div>
  );
}

function quantityText(q, unit) {
  const val = Number(q || 0);
  if (val === 0) return "—";
  if (val === Math.floor(val)) return `${Math.floor(val)} ${unit || ""}`.trim();
  return `${val.toFixed(2)} ${unit || ""}`.trim();
}

function LowStockAlert({ items }) {
  if (!items?.length) return null;
  return (
    <Card className="p-4 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            {items.length} item{items.length !== 1 ? "s" : ""} running low or out of stock
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {items.map((g) => (
              <span key={g.id} className={cn("text-xs px-2 py-1 rounded-full border bg-white dark:bg-slate-800",
                g.status === "out" ? "border-red-200 dark:border-red-800 text-red-700 dark:text-red-300" : "border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200")}>
                {g.name} · {quantityText(g.quantity, g.unit)} {g.status === "out" ? "(out)" : "(low)"}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function GroceryDialog({ item, open, setOpen, onSave }) {
  const [f, setF] = useState({});
  useEffect(() => {
    setF(item || { name: "", quantity: "", unit: "unit", category: "", price: "", store: "", low_threshold: "", notes: "", is_favorite: false });
  }, [item, open]);
  const submit = (e) => {
    e.preventDefault();
    onSave({
      ...f,
      quantity: f.quantity === "" ? 0 : parseFloat(f.quantity),
      price: f.price === "" ? null : parseFloat(f.price),
      low_threshold: f.low_threshold === "" ? 0 : parseFloat(f.low_threshold),
    });
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? "Edit inventory item" : "Add to inventory"}</DialogTitle>
          <DialogDescription>{item ? "Update stock, price or reorder threshold." : "Track something you already have."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 mt-2">
          <Input placeholder="Item name" value={f.name || ""} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} required />
          <div className="grid grid-cols-2 gap-3">
            <Input type="number" min={0} step="0.01" placeholder="Quantity" value={f.quantity} onChange={(e) => setF((x) => ({ ...x, quantity: e.target.value }))} />
            <Select value={f.unit} onValueChange={(v) => setF((x) => ({ ...x, unit: v }))}>
              <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input type="number" min={0} step="0.01" placeholder="Price (€)" value={f.price} onChange={(e) => setF((x) => ({ ...x, price: e.target.value }))} />
            <Input placeholder="Store" value={f.store || ""} onChange={(e) => setF((x) => ({ ...x, store: e.target.value }))} />
          </div>
          <Select value={f.category || "Other"} onValueChange={(v) => setF((x) => ({ ...x, category: v }))}>
            <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              {CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input type="number" min={0} step="0.01" placeholder="Low-stock threshold" value={f.low_threshold} onChange={(e) => setF((x) => ({ ...x, low_threshold: e.target.value }))} />
          <Input placeholder="Notes" value={f.notes || ""} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} />
          <div className="flex items-center gap-2">
            <input id="fav" type="checkbox" checked={!!f.is_favorite} onChange={(e) => setF((x) => ({ ...x, is_favorite: e.target.checked }))} />
            <Label htmlFor="fav">Favorite / staple item</Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShoppingItemDialog({ item, listId, open, setOpen, onSave }) {
  const [f, setF] = useState({});
  useEffect(() => {
    setF(item || { name: "", quantity: "1", unit: "unit", category: "", estimated_price: "", store: "", note: "" });
  }, [item, open, listId]);
  const submit = (e) => {
    e.preventDefault();
    onSave({
      ...f,
      list_id: listId,
      quantity: f.quantity === "" ? 1 : parseFloat(f.quantity),
      estimated_price: f.estimated_price === "" ? null : parseFloat(f.estimated_price),
    });
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? "Edit list item" : "Add to list"}</DialogTitle>
          <DialogDescription>{item ? "Update quantity, price estimate or store." : "Add something you need to buy."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 mt-2">
          <Input placeholder="Item name" value={f.name || ""} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} required />
          <div className="grid grid-cols-2 gap-3">
            <Input type="number" min={0} step="0.01" placeholder="Quantity" value={f.quantity} onChange={(e) => setF((x) => ({ ...x, quantity: e.target.value }))} />
            <Select value={f.unit} onValueChange={(v) => setF((x) => ({ ...x, unit: v }))}>
              <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input type="number" min={0} step="0.01" placeholder="Estimated price (€)" value={f.estimated_price} onChange={(e) => setF((x) => ({ ...x, estimated_price: e.target.value }))} />
            <Input placeholder="Store" value={f.store || ""} onChange={(e) => setF((x) => ({ ...x, store: e.target.value }))} />
          </div>
          <Select value={f.category || "Other"} onValueChange={(v) => setF((x) => ({ ...x, category: v }))}>
            <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              {CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Note" value={f.note || ""} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ListDialog({ open, setOpen, onSave }) {
  const [name, setName] = useState("");
  useEffect(() => { if (open) setName(""); }, [open]);
  const submit = (e) => { e.preventDefault(); onSave(name); };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New shopping list</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3 mt-2">
          <Input placeholder="List name" value={name} onChange={(e) => setName(e.target.value)} required />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white">Create</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SubmitReviewDialog({ open, setOpen, items, onSubmit }) {
  const total = useMemo(() => items.reduce((s, it) => s + (it.actual_price || it.estimated_price || 0) * it.quantity, 0), [items]);
  const [recordExpense, setRecordExpense] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review purchase</DialogTitle>
          <DialogDescription>{items.length} item{items.length !== 1 ? "s" : ""} will be added to inventory. Unselected items stay on the list.</DialogDescription>
        </DialogHeader>
        <div className="mt-3 space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center justify-between text-sm py-2 border-b border-border last:border-0">
              <span>{quantityText(it.quantity, it.unit)} {it.name}</span>
              <span className="font-medium">{eur((it.actual_price || it.estimated_price || 0) * it.quantity)}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 flex items-center justify-between">
          <span className="text-sm text-slate-500">Estimated total</span>
          <span className="text-lg font-bold">{eur(total)}</span>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <input id="record-expense" type="checkbox" checked={recordExpense} onChange={(e) => setRecordExpense(e.target.checked)} />
          <Label htmlFor="record-expense">Record as expense in Money</Label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => onSubmit(recordExpense)} className="bg-emerald-600 hover:bg-emerald-700 text-white">Confirm purchase</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PriceHistoryDialog({ item, open, setOpen }) {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !item) return;
    setLoading(true);
    api.get(`/prices/${encodeURIComponent(item.name)}`).then((r) => setHistory(r.data)).finally(() => setLoading(false));
  }, [open, item]);

  const chartData = useMemo(() => {
    if (!history?.history) return [];
    return [...history.history].reverse().map((h) => ({ date: h.date, price: parseFloat(h.price), store: h.store }));
  }, [history]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Price history: {item?.name}</DialogTitle>
        </DialogHeader>
        {loading ? <p className="text-sm text-slate-500 py-8 text-center">Loading...</p> : (
          <div className="mt-2">
            {history?.cheapest ? (
              <p className="text-sm text-slate-500 mb-3">Cheapest recently: <span className="font-semibold text-slate-700 dark:text-slate-200">{history.cheapest.store}</span> at {eur(history.cheapest.price)}</p>
            ) : null}
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#94A3B8" />
                  <YAxis tickFormatter={(v) => `€${v}`} tick={{ fontSize: 10 }} stroke="#94A3B8" />
                  <Tooltip formatter={(v) => eur(v)} />
                  <Line type="monotone" dataKey="price" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-slate-500 py-8 text-center">Not enough price history to chart.</p>
            )}
            {history?.history?.length > 0 && (
              <div className="mt-3 max-h-32 overflow-y-auto space-y-1">
                {history.history.slice(0, 10).map((h, i) => (
                  <div key={i} className="flex justify-between text-xs py-1 border-b border-border last:border-0">
                    <span className="text-slate-500">{h.date} · {h.store || "—"}</span>
                    <span className="font-medium">{eur(h.price)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecurringDialog({ open, setOpen, onSave, editing }) {
  const [f, setF] = useState({ name: "", schedule: "weekly", items: [] });
  useEffect(() => {
    if (open) setF(editing || { name: "", schedule: "weekly", items: [] });
  }, [open, editing]);
  const addItem = () => setF((x) => ({ ...x, items: [...x.items, { name: "", quantity: 1, unit: "unit", category: "", estimated_price: "" }] }));
  const updateItem = (i, k, v) => setF((x) => ({ ...x, items: x.items.map((it, idx) => idx === i ? { ...it, [k]: v } : it) }));
  const removeItem = (i) => setF((x) => ({ ...x, items: x.items.filter((_, idx) => idx !== i) }));
  const submit = (e) => {
    e.preventDefault();
    const clean = f.items.filter((it) => it.name.trim()).map((it) => ({
      ...it,
      quantity: parseFloat(it.quantity) || 1,
      estimated_price: it.estimated_price === "" ? null : parseFloat(it.estimated_price),
    }));
    onSave({ ...f, items: clean });
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Repeat className="h-5 w-5" /> {editing ? "Edit recurring list" : "New recurring list"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 mt-2">
          <Input placeholder="Template name" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} required />
          <Select value={f.schedule} onValueChange={(v) => setF((x) => ({ ...x, schedule: v }))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="biweekly">Bi-weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectContent>
          </Select>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Items</Label>
              <Button type="button" variant="outline" size="sm" onClick={addItem}><Plus className="h-4 w-4 mr-1" /> Add item</Button>
            </div>
            {f.items.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <Input className="col-span-4 h-9" placeholder="Name" value={it.name} onChange={(e) => updateItem(i, "name", e.target.value)} />
                <Input className="col-span-2 h-9" type="number" min={0} placeholder="Qty" value={it.quantity} onChange={(e) => updateItem(i, "quantity", e.target.value)} />
                <Select value={it.unit} onValueChange={(v) => updateItem(i, "unit", v)}>
                  <SelectTrigger className="col-span-2 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input className="col-span-3 h-9" type="number" min={0} step="0.01" placeholder="€" value={it.estimated_price} onChange={(e) => updateItem(i, "estimated_price", e.target.value)} />
                <Button type="button" variant="ghost" size="icon" className="col-span-1 h-9 w-9 text-red-500" onClick={() => removeItem(i)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white">Save template</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Groceries() {
  const [tab, setTab] = useState("shopping");
  const [inventory, setInventory] = useState([]);
  const [shopping, setShopping] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedListId, setSelectedListId] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [lowStock, setLowStock] = useState([]);

  const [searchInv, setSearchInv] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");

  const [searchShop, setSearchShop] = useState("");
  const [catShopFilter, setCatShopFilter] = useState("all");

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [groceryDialogOpen, setGroceryDialogOpen] = useState(false);
  const [editingGrocery, setEditingGrocery] = useState(null);
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [deleteItemId, setDeleteItemId] = useState(null);
  const [deleteListId, setDeleteListId] = useState(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [priceItem, setPriceItem] = useState(null);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [editingRecurring, setEditingRecurring] = useState(null);
  const [deleteRecurringId, setDeleteRecurringId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [inv, shop, low, sugg, rec] = await Promise.all([
        api.get("/groceries"),
        api.get("/shopping", { params: selectedListId ? { list_id: selectedListId } : {} }),
        api.get("/groceries/low-stock"),
        api.get("/groceries/suggestions"),
        api.get("/shopping/recurring"),
      ]);
      setInventory(inv.data);
      setShopping(shop.data);
      setLowStock(low.data);
      setSuggestions(sugg.data);
      setRecurring(rec.data);
      if (shop.data?.lists?.length && !selectedListId) {
        const active = shop.data.lists.find((l) => !l.archived);
        setSelectedListId(active?.id || shop.data.lists[0].id);
      }
      setSelectedIds(new Set((shop.data?.items || []).filter((i) => i.selected).map((i) => i.id)));
    } finally { setLoading(false); }
  }, [selectedListId]);

  useEffect(() => {
    setLoading(true);
    load();
    const h = () => load();
    window.addEventListener("lm:refresh", h);
    return () => window.removeEventListener("lm:refresh", h);
  }, [load]);

  const currentList = useMemo(() => (shopping?.lists || []).find((l) => l.id === selectedListId), [shopping, selectedListId]);
  const listItems = useMemo(() => (shopping?.items || []).filter((it) => it.list_id === selectedListId), [shopping, selectedListId]);

  const filteredInventory = useMemo(() => {
    let rows = [...inventory];
    const q = searchInv.trim().toLowerCase();
    if (q) rows = rows.filter((g) => g.name.toLowerCase().includes(q) || (g.category || "").toLowerCase().includes(q));
    if (catFilter !== "all") rows = rows.filter((g) => g.category === catFilter);
    if (stockFilter === "low") rows = rows.filter((g) => g.low_threshold > 0 && Number(g.quantity) <= Number(g.low_threshold));
    if (stockFilter === "out") rows = rows.filter((g) => Number(g.quantity) <= 0);
    return rows.sort((a, b) => {
      const aLow = a.low_threshold > 0 && Number(a.quantity) <= Number(a.low_threshold);
      const bLow = b.low_threshold > 0 && Number(b.quantity) <= Number(b.low_threshold);
      if (aLow !== bLow) return aLow ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [inventory, searchInv, catFilter, stockFilter]);

  const filteredShopItems = useMemo(() => {
    let rows = [...listItems];
    const q = searchShop.trim().toLowerCase();
    if (q) rows = rows.filter((it) => it.name.toLowerCase().includes(q) || (it.category || "").toLowerCase().includes(q));
    if (catShopFilter !== "all") rows = rows.filter((it) => it.category === catShopFilter);
    return rows.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
  }, [listItems, searchShop, catShopFilter]);

  const toggleSelect = async (id) => {
    try {
      await api.post(`/shopping/${id}/toggle`);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not update selection"); }
  };

  const selectAll = () => setSelectedIds(new Set(filteredShopItems.map((i) => i.id)));
  const deselectAll = () => setSelectedIds(new Set());

  const saveGrocery = async (payload) => {
    try {
      if (editingGrocery) {
        await api.put(`/groceries/${editingGrocery.id}`, payload);
        toast.success("Updated");
      } else {
        await api.post("/groceries", payload);
        toast.success("Added to inventory");
      }
      setGroceryDialogOpen(false);
      setEditingGrocery(null);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not save"); }
  };

  const deleteGrocery = async (id) => {
    try {
      await api.delete(`/groceries/${id}`);
      toast.success("Deleted");
      setDeleteItemId(null);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not delete"); }
  };

  const saveShoppingItem = async (payload) => {
    try {
      if (editingItem) {
        await api.put(`/shopping/${editingItem.id}`, payload);
        toast.success("Updated");
      } else {
        await api.post("/shopping", payload);
        toast.success("Added");
      }
      setItemDialogOpen(false);
      setEditingItem(null);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not save"); }
  };

  const deleteShoppingItem = async (id) => {
    try {
      await api.delete(`/shopping/${id}`);
      toast.success("Deleted");
      setDeleteItemId(null);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not delete"); }
  };

  const createList = async (name) => {
    try {
      const { data } = await api.post("/shopping/lists", { name });
      toast.success("List created");
      setListDialogOpen(false);
      setSelectedListId(data.id);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not create list"); }
  };

  const deleteList = async (id) => {
    try {
      await api.delete(`/shopping/lists/${id}`);
      toast.success("List deleted");
      setDeleteListId(null);
      setSelectedListId("");
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not delete list"); }
  };

  const generateList = async () => {
    setGenerating(true);
    try {
      await api.post("/shopping/generate", null, { params: { days: 7, list_id: selectedListId || undefined } });
      toast.success("List generated from inventory");
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not generate"); }
    finally { setGenerating(false); }
  };

  const updateBudget = async (budget) => {
    if (!selectedListId) return;
    try {
      await api.put(`/shopping/lists/${selectedListId}`, { budget: budget === "" ? null : parseFloat(budget) });
      toast.success("Budget updated");
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not update budget"); }
  };

  const bulkDelete = async () => {
    try {
      await api.post("/shopping/bulk-delete", { ids: Array.from(selectedIds) });
      toast.success(`Deleted ${selectedIds.size} items`);
      setBulkDeleteOpen(false);
      setSelectedIds(new Set());
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Bulk delete failed"); }
  };

  const submitPurchase = async (recordExpense) => {
    const selected = listItems.filter((it) => selectedIds.has(it.id));
    if (!selected.length) { toast.error("Select at least one item"); return; }
    try {
      const { data } = await api.post(`/shopping/lists/${selectedListId}/submit`, {
        items: selected.map((it) => ({
          item_id: it.id,
          quantity: Number(it.quantity),
          actual_price: it.estimated_price ? Number(it.estimated_price) : null,
          store: it.store || null,
        })),
        store: selected[0]?.store || null,
        record_expense: recordExpense,
      });
      toast.success(`Purchased ${data.purchased.length} item${data.purchased.length !== 1 ? "s" : ""}`);
      setSubmitOpen(false);
      setSelectedIds(new Set());
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Purchase failed"); }
  };

  const addSuggestion = async (s) => {
    if (!selectedListId) { toast.error("Select a list first"); return; }
    try {
      await api.post("/shopping", {
        name: s.name, quantity: s.default_quantity || 1, unit: s.unit || "unit",
        category: s.category, estimated_price: s.price, list_id: selectedListId,
      });
      toast.success(`Added ${s.name}`);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not add"); }
  };

  const saveRecurring = async (payload) => {
    try {
      if (editingRecurring) {
        await api.put(`/shopping/recurring/${editingRecurring.id}`, payload);
        toast.success("Template updated");
      } else {
        await api.post("/shopping/recurring", payload);
        toast.success("Template created");
      }
      setRecurringOpen(false);
      setEditingRecurring(null);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not save template"); }
  };

  const deleteRecurring = async (id) => {
    try {
      await api.delete(`/shopping/recurring/${id}`);
      toast.success("Template deleted");
      setDeleteRecurringId(null);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not delete template"); }
  };

  const spawnRecurring = async (id) => {
    try {
      const { data } = await api.post(`/shopping/recurring/${id}/spawn`);
      toast.success(`Spawned ${data.spawned} items`);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not spawn list"); }
  };

  const selectedForSubmit = useMemo(() => listItems.filter((it) => selectedIds.has(it.id)), [listItems, selectedIds]);
  const estimatedTotal = useMemo(() => selectedForSubmit.reduce((s, it) => s + (it.estimated_price || 0) * Number(it.quantity), 0), [selectedForSubmit]);
  const selectedCount = selectedIds.size;
  const allSelected = filteredShopItems.length > 0 && filteredShopItems.every((i) => selectedIds.has(i.id));

  const groupedInventory = useMemo(() => {
    const map = {};
    filteredInventory.forEach((g) => {
      const cat = g.category || "Other";
      if (!map[cat]) map[cat] = [];
      map[cat].push(g);
    });
    return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredInventory]);

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Groceries"
        sub="Inventory, shopping lists and smart restocking"
        action={
          <div className="flex items-center gap-2">
            <Button variant={tab === "shopping" ? "default" : "outline"} size="sm" onClick={() => setTab("shopping")} className={cn(tab === "shopping" && "bg-emerald-600 hover:bg-emerald-700 text-white")}>
              <ShoppingCart className="h-4 w-4 mr-1" /> Shopping
            </Button>
            <Button variant={tab === "inventory" ? "default" : "outline"} size="sm" onClick={() => setTab("inventory")} className={cn(tab === "inventory" && "bg-emerald-600 hover:bg-emerald-700 text-white")}>
              <Package className="h-4 w-4 mr-1" /> Inventory
            </Button>
          </div>
        }
      />

      <LowStockAlert items={lowStock} />

      {tab === "inventory" ? (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input placeholder="Search inventory..." value={searchInv} onChange={(e) => setSearchInv(e.target.value)} className="pl-9" />
              {searchInv && <button onClick={() => setSearchInv("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-3.5 w-3.5" /></button>}
            </div>
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={stockFilter} onValueChange={setStockFilter}>
              <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Stock" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stock</SelectItem>
                <SelectItem value="low">Low stock</SelectItem>
                <SelectItem value="out">Out of stock</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => { setEditingGrocery(null); setGroceryDialogOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              <Plus className="h-4 w-4 mr-1" /> Add item
            </Button>
          </div>

          {groupedInventory.length === 0 && !loading ? (
            <EmptyState icon={Package} title="No inventory items" sub={searchInv || catFilter !== "all" ? "Try adjusting filters." : "Add items you already have at home."}
              action={<Button onClick={() => { setEditingGrocery(null); setGroceryDialogOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="h-4 w-4 mr-1" /> Add item</Button>} />
          ) : (
            <div className="space-y-6">
              {groupedInventory.map(([cat, items]) => (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-3">
                    <CatIcon category={cat} />
                    <h3 className="font-semibold text-sm">{cat}</h3>
                    <span className="text-xs text-slate-400">{items.length}</span>
                  </div>
                  <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map((g) => {
                      const qty = Number(g.quantity);
                      const low = g.low_threshold > 0 && qty <= Number(g.low_threshold);
                      const out = qty <= 0;
                      return (
                        <Card key={g.id} className={cn("p-4 transition-colors hover:shadow-sm", out ? "border-red-200 dark:border-red-800" : low ? "border-amber-200 dark:border-amber-800" : "")}>
                          <div className="flex items-start justify-between">
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate">{g.name}</p>
                              <p className="text-xs text-slate-500">{g.store || "No store"}</p>
                            </div>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingGrocery(g); setGroceryDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600" onClick={() => setDeleteItemId(g.id)}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                          </div>
                          <div className="mt-3 flex items-end justify-between">
                            <div>
                              <p className={cn("text-2xl font-bold", out ? "text-red-600" : low ? "text-amber-600" : "text-slate-900 dark:text-slate-100")}>{quantityText(g.quantity, g.unit)}</p>
                              {g.low_threshold > 0 && <p className="text-xs text-slate-400">Low at {quantityText(g.low_threshold, g.unit)}</p>}
                            </div>
                            <div className="text-right">
                              {g.price ? <p className="text-sm font-medium">{eur(g.price)}</p> : <p className="text-xs text-slate-400">No price</p>}
                              {g.is_favorite && <p className="text-[10px] text-emerald-600 font-medium">Favorite</p>}
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-col lg:flex-row gap-5">
            {/* Left sidebar */}
            <div className="lg:w-64 space-y-4">
              <Card className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <Label>Lists</Label>
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => setListDialogOpen(true)}><Plus className="h-4 w-4" /></Button>
                </div>
                <div className="space-y-1">
                  {shopping?.lists?.map((lst) => (
                    <button key={lst.id} onClick={() => setSelectedListId(lst.id)}
                      className={cn("w-full text-left px-3 py-2 rounded-xl text-sm font-medium border transition-colors flex items-center justify-between",
                        selectedListId === lst.id
                          ? "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                          : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-600 dark:text-slate-300")}>
                      <span className="truncate">{lst.name}</span>
                      {selectedListId === lst.id && <ChevronDown className="h-4 w-4" />}
                    </button>
                  ))}
                  {!shopping?.lists?.length && <p className="text-sm text-slate-400 px-2">No lists yet.</p>}
                </div>
              </Card>

              {currentList && (
                <Card className="p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>List budget</Label>
                    <Button variant="ghost" size="sm" className="h-8 text-red-500 hover:text-red-600" onClick={() => setDeleteListId(currentList.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                  <Input
                    type="number" min={0} step="0.01" placeholder="No budget"
                    value={shopping?.budget_summary?.budget ?? ""}
                    onChange={(e) => updateBudget(e.target.value)}
                  />
                  {shopping?.budget_summary?.budget != null && (
                    <>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Estimated</span>
                        <span className={cn("font-medium", (shopping.budget_summary.remaining || 0) < 0 ? "text-red-500" : "text-slate-700 dark:text-slate-200")}>{eur(shopping.budget_summary.estimated_total)}</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all", (shopping.budget_summary.remaining || 0) < 0 ? "bg-red-500" : shopping.budget_summary.estimated_total / shopping.budget_summary.budget >= 0.8 ? "bg-amber-500" : "bg-emerald-500")}
                          style={{ width: `${Math.min(100, Math.round((shopping.budget_summary.estimated_total / shopping.budget_summary.budget) * 100))}%` }} />
                      </div>
                      <p className="text-xs text-slate-500">
                        {(shopping.budget_summary.remaining || 0) < 0
                          ? `${eur(Math.abs(shopping.budget_summary.remaining))} over budget`
                          : `${eur(shopping.budget_summary.remaining)} remaining`}
                      </p>
                    </>
                  )}
                </Card>
              )}

              <Card className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <Label className="flex items-center gap-1"><Repeat className="h-3.5 w-3.5" /> Recurring</Label>
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => { setEditingRecurring(null); setRecurringOpen(true); }}><Plus className="h-4 w-4" /></Button>
                </div>
                <div className="space-y-1.5">
                  {recurring.map((rl) => (
                    <div key={rl.id} className="group flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <span className="text-sm truncate">{rl.name}</span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Spawn now" onClick={() => spawnRecurring(rl.id)}><RotateCcw className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditingRecurring(rl); setRecurringOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => setDeleteRecurringId(rl.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </div>
                  ))}
                  {!recurring.length && <p className="text-xs text-slate-400 px-1">No recurring templates.</p>}
                </div>
              </Card>
            </div>

            {/* Main shopping area */}
            <div className="flex-1 space-y-4">
              <div className="flex flex-col sm:flex-row gap-3 justify-between">
                <div className="flex gap-2 flex-1">
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input placeholder="Search list..." value={searchShop} onChange={(e) => setSearchShop(e.target.value)} className="pl-9" />
                    {searchShop && <button onClick={() => setSearchShop("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-3.5 w-3.5" /></button>}
                  </div>
                  <Select value={catShopFilter} onValueChange={setCatShopFilter}>
                    <SelectTrigger className="w-36"><SelectValue placeholder="Category" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={generateList} disabled={generating || !selectedListId}>
                    {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />} Generate
                  </Button>
                  <Button size="sm" onClick={() => { setEditingItem(null); setItemDialogOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    <Plus className="h-4 w-4 mr-1" /> Add item
                  </Button>
                </div>
              </div>

              {filteredShopItems.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <div className="flex items-center gap-3">
                    <input id="select-all" type="checkbox" checked={allSelected} onChange={() => allSelected ? deselectAll() : selectAll()} className="h-4 w-4" />
                    <Label htmlFor="select-all">{allSelected ? "Deselect all" : "Select all"}</Label>
                    <span className="text-xs text-slate-400">{selectedCount} selected</span>
                  </div>
                  {selectedCount > 0 && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setBulkDeleteOpen(true)}><Trash2 className="h-4 w-4 mr-1" /> Delete</Button>
                      <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => setSubmitOpen(true)}>
                        <Receipt className="h-4 w-4 mr-1" /> Submit {selectedCount}
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {filteredShopItems.length === 0 && !loading ? (
                <EmptyState icon={ShoppingCart} title="Your list is empty"
                  sub={currentList ? "Add items, generate from inventory, or pick from suggestions." : "Create a list to get started."}
                  action={currentList ? (
                    <div className="flex gap-2 flex-wrap justify-center">
                      <Button variant="outline" onClick={generateList} disabled={generating}>
                        {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />} Generate
                      </Button>
                      <Button onClick={() => { setEditingItem(null); setItemDialogOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="h-4 w-4 mr-1" /> Add item</Button>
                    </div>
                  ) : <Button onClick={() => setListDialogOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="h-4 w-4 mr-1" /> Create list</Button>} />
              ) : (
                <div className="space-y-2">
                  {filteredShopItems.map((it) => {
                    const selected = selectedIds.has(it.id);
                    const conf = it.known ? PRICE_CONF.known : it.estimated_price ? PRICE_CONF.estimated : PRICE_CONF.unknown;
                    return (
                      <div key={it.id} className={cn("group flex items-center gap-3 p-3 rounded-xl border transition-all",
                        selected ? "bg-emerald-50/60 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800" : "bg-card border-border hover:border-slate-300 dark:hover:border-slate-600")}>
                        <input type="checkbox" checked={selected} onChange={() => toggleSelect(it.id)} className="h-4 w-4 shrink-0 accent-emerald-600" />
                        <CatIcon category={it.category || "Other"} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn("font-medium text-sm", selected && "line-through text-slate-400")}>{it.name}</span>
                            <ConfidenceBadge type={conf.type}>{conf.label}</ConfidenceBadge>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                            <span>{quantityText(it.quantity, it.unit)}</span>
                            {it.best ? <span className="flex items-center gap-1"><Store className="h-3 w-3" />{it.best.store} {eur(it.best.price)}</span> : null}
                            {it.note && <span className="truncate max-w-[200px]">{it.note}</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold">{eur((it.estimated_price || 0) * Number(it.quantity))}</p>
                          {it.estimated_price && <p className="text-xs text-slate-400">{eur(it.estimated_price)} / {it.unit || "unit"}</p>}
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="Price history" onClick={() => setPriceItem(it)}><History className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingItem(it); setItemDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600" onClick={() => setDeleteItemId(it.id)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {shopping?.recommendation && (
                <Card className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800">
                  <div className="flex items-start gap-3">
                    <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-300 shrink-0 mt-0.5" />
                    <p className="text-sm text-indigo-800 dark:text-indigo-300">{shopping.recommendation}</p>
                  </div>
                </Card>
              )}

              {suggestions.length > 0 && (
                <Card className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb className="h-4 w-4 text-amber-500" />
                    <Label>Suggestions</Label>
                    <span className="text-xs text-slate-400">Frequently bought or favorite</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {suggestions.map((s) => (
                      <button key={s.id} onClick={() => addSuggestion(s)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-slate-50 dark:bg-slate-800/50 px-3 py-1.5 text-xs font-medium hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:border-emerald-200 dark:hover:border-emerald-800 transition-colors">
                        <Plus className="h-3 w-3 text-emerald-600" /> {s.name}
                        <span className="text-slate-400">· {s.reason}</span>
                      </button>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      <GroceryDialog item={editingGrocery} open={groceryDialogOpen} setOpen={setGroceryDialogOpen} onSave={saveGrocery} />
      <ShoppingItemDialog item={editingItem} listId={selectedListId} open={itemDialogOpen} setOpen={setItemDialogOpen} onSave={saveShoppingItem} />
      <ListDialog open={listDialogOpen} setOpen={setListDialogOpen} onSave={createList} />
      <SubmitReviewDialog open={submitOpen} setOpen={setSubmitOpen} items={selectedForSubmit} onSubmit={submitPurchase} />
      <PriceHistoryDialog item={priceItem} open={!!priceItem} setOpen={() => setPriceItem(null)} />
      <RecurringDialog open={recurringOpen} setOpen={setRecurringOpen} onSave={saveRecurring} editing={editingRecurring} />

      <ConfirmDialog
        open={!!deleteItemId}
        onOpenChange={(v) => !v && setDeleteItemId(null)}
        title="Delete item?"
        description="This will permanently remove the item."
        onConfirm={() => deleteItemId && (tab === "inventory" ? deleteGrocery(deleteItemId) : deleteShoppingItem(deleteItemId))}
        confirmText="Delete"
        variant="danger"
      />
      <ConfirmDialog
        open={!!deleteListId}
        onOpenChange={(v) => !v && setDeleteListId(null)}
        title="Delete list?"
        description="This will delete the list and all its items."
        onConfirm={() => deleteListId && deleteList(deleteListId)}
        confirmText="Delete"
        variant="danger"
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Delete selected items?"
        description={`This will remove ${selectedCount} selected item${selectedCount !== 1 ? "s" : ""} from the list.`}
        onConfirm={bulkDelete}
        confirmText="Delete"
        variant="danger"
      />
      <ConfirmDialog
        open={!!deleteRecurringId}
        onOpenChange={(v) => !v && setDeleteRecurringId(null)}
        title="Delete recurring template?"
        description="This will permanently remove the recurring list template."
        onConfirm={() => deleteRecurringId && deleteRecurring(deleteRecurringId)}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
