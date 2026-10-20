import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ShoppingCart, Package, Plus, Trash2, Pencil, Sparkles, Check, Store,
  AlertTriangle, Search, X, ChevronDown, ChevronUp, ListChecks, ArrowRight,
  RotateCcw, TrendingDown, Archive, Loader2, Receipt, Filter,
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

const CATS = ["Meat", "Fish", "Eggs", "Dairy", "Carbohydrates", "Fruit", "Vegetables", "Frozen", "Pantry", "Snacks", "Drinks", "Other"];
const UNITS = ["unit", "kg", "g", "L", "ml", "pack", "bottle", "can", "box", "bag", "bunch", "jar"];

const PRICE_CONF = {
  known: { type: "exact", label: "Known price" },
  estimated: { type: "estimated", label: "Estimated" },
  unknown: { type: "unknown", label: "Unknown" },
};

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
              <button key={g.id} onClick={() => window.dispatchEvent(new CustomEvent("lm:refresh"))}
                className="text-xs px-2 py-1 rounded-full bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">
                {g.name} · {quantityText(g.quantity, g.unit)} {g.status === "out" ? "(out)" : "(low)"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function quantityText(q, unit) {
  const val = Number(q || 0);
  if (val === 0) return "—";
  if (val === Math.floor(val)) return `${Math.floor(val)} ${unit || ""}`.trim();
  return `${val.toFixed(2)} ${unit || ""}`.trim();
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

function SubmitReviewDialog({ open, setOpen, items, store, onSubmit }) {
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

export default function Groceries() {
  const [tab, setTab] = useState("shopping");
  const [inventory, setInventory] = useState([]);
  const [shopping, setShopping] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedListId, setSelectedListId] = useState("");

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
  const [lowStock, setLowStock] = useState([]);

  const load = useCallback(async () => {
    try {
      const [inv, shop, low] = await Promise.all([
        api.get("/groceries"),
        api.get("/shopping", { params: selectedListId ? { list_id: selectedListId } : {} }),
        api.get("/groceries/low-stock"),
      ]);
      setInventory(inv.data);
      setShopping(shop.data);
      setLowStock(low.data);
      if (shop.data?.lists?.length && !selectedListId) {
        const active = shop.data.lists.find((l) => !l.archived);
        setSelectedListId(active?.id || shop.data.lists[0].id);
      }
      // sync selected set with backend selected state
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

  const selectedForSubmit = useMemo(() => listItems.filter((it) => selectedIds.has(it.id)), [listItems, selectedIds]);
  const estimatedTotal = useMemo(() => selectedForSubmit.reduce((s, it) => s + (it.estimated_price || 0) * Number(it.quantity), 0), [selectedForSubmit]);

  const selectedCount = selectedIds.size;
  const allSelected = filteredShopItems.length > 0 && filteredShopItems.every((i) => selectedIds.has(i.id));

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

          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {filteredInventory.map((g) => {
              const qty = Number(g.quantity);
              const low = g.low_threshold > 0 && qty <= Number(g.low_threshold);
              const out = qty <= 0;
              return (
                <Card key={g.id} className={cn("p-4 transition-colors", out ? "border-red-200 dark:border-red-800" : low ? "border-amber-200 dark:border-amber-800" : "")}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn("h-10 w-10 rounded-xl grid place-items-center", out ? "bg-red-100 dark:bg-red-900/30" : low ? "bg-amber-100 dark:bg-amber-900/30" : "bg-emerald-100 dark:bg-emerald-900/30")}>
                        {out ? <AlertTriangle className="h-5 w-5 text-red-600" /> : low ? <TrendingDown className="h-5 w-5 text-amber-600" /> : <Package className="h-5 w-5 text-emerald-600" />}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{g.name}</p>
                        <p className="text-xs text-slate-500">{g.category || "Other"}{g.store ? ` · ${g.store}` : ""}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingGrocery(g); setGroceryDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600" onClick={() => setDeleteItemId(g.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div>
                      <p className={cn("text-2xl font-bold", out ? "text-red-600" : low ? "text-amber-600" : "text-slate-900 dark:text-slate-100")}>{quantityText(g.quantity, g.unit)}</p>
                      {g.low_threshold > 0 && <p className="text-xs text-slate-400">Low at {quantityText(g.low_threshold, g.unit)}</p>}
                    </div>
                    <div className="text-right">
                      {g.price ? <p className="text-sm font-medium">{eur(g.price)}</p> : <p className="text-xs text-slate-400">No price</p>}
                      {g.purchase_count > 0 && <p className="text-xs text-slate-400">Bought {g.purchase_count}×</p>}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          {filteredInventory.length === 0 && !loading && (
            <EmptyState icon={Package} title="No inventory items" sub={searchInv || catFilter !== "all" ? "Try adjusting filters." : "Add items you already have at home."}
              action={<Button onClick={() => { setEditingGrocery(null); setGroceryDialogOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="h-4 w-4 mr-1" /> Add item</Button>} />
          )}
        </>
      ) : (
        <>
          <div className="flex flex-col lg:flex-row gap-4">
            {/* Left: list selector + actions */}
            <div className="lg:w-64 space-y-3">
              <div className="flex items-center justify-between">
                <Label>Lists</Label>
                <Button variant="ghost" size="sm" className="h-8" onClick={() => setListDialogOpen(true)}><Plus className="h-4 w-4" /></Button>
              </div>
              <div className="space-y-1.5">
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
              {currentList && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => setDeleteListId(currentList.id)}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete list
                </Button>
              )}
              {currentList && (
                <div className="p-3 rounded-xl border border-border bg-card space-y-2">
                  <Label>List budget</Label>
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
                        <div className={cn("h-full rounded-full transition-all", (shopping.budget_summary.remaining || 0) < 0 ? "bg-red-500" : "bg-emerald-500")}
                          style={{ width: `${Math.min(100, Math.round((shopping.budget_summary.estimated_total / shopping.budget_summary.budget) * 100))}%` }} />
                      </div>
                      <p className="text-xs text-slate-500">
                        {(shopping.budget_summary.remaining || 0) < 0
                          ? `${eur(Math.abs(shopping.budget_summary.remaining))} over budget`
                          : `${eur(shopping.budget_summary.remaining)} remaining`}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Right: items */}
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
                  sub={currentList ? "Add items or generate suggestions from your inventory." : "Create a list to get started."}
                  action={currentList ? (
                    <div className="flex gap-2">
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
                      <div key={it.id} className={cn("flex items-center gap-3 p-3 rounded-xl border transition-colors",
                        selected ? "bg-slate-100 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700" : "bg-card border-border")}>
                        <input type="checkbox" checked={selected} onChange={() => toggleSelect(it.id)} className="h-4 w-4 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={cn("font-medium text-sm", selected && "line-through text-slate-400")}>{it.name}</span>
                            {it.category && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">{it.category}</span>}
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
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditingItem(it); setItemDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600" onClick={() => setDeleteItemId(it.id)}><Trash2 className="h-4 w-4" /></Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Price intelligence */}
              {shopping?.recommendation && (
                <Card className="p-4 bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800">
                  <div className="flex items-start gap-3">
                    <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-300 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">Price tip</p>
                      <p className="text-sm text-indigo-800 dark:text-indigo-300 mt-0.5">{shopping.recommendation}</p>
                    </div>
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
    </div>
  );
}
