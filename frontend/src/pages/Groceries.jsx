import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { ShoppingCart, Plus, Trash2, Store, History, Repeat, LayoutDashboard, Refrigerator, BookMarked, ChefHat, Menu } from "lucide-react";
import { api, eur } from "@/lib/api";
import { currencySymbol } from "@/lib/money";
import { refreshAll } from "@/lib/useFetch";
import { Card, SectionHeading, Label } from "@/components/common";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { CATS, UNITS, quantityText } from "./groceries/shared";
import { StorageTab } from "./groceries/StorageTab";
import { ShoppingTab } from "./groceries/ShoppingTab";
import { CartDock, cartCount } from "./groceries/CartDock";
import { QuickAdd } from "./groceries/QuickAdd";
import { stepFor } from "./groceries/inventoryActions";
import { CatalogTab } from "./groceries/CatalogTab";
import { useAuth } from "@/context/AuthContext";
import { readCache, writeCache } from "@/lib/swrCache";
import { GROCERY_PARTS, GROCERIES_CACHE_KEY, watchGroceries } from "@/lib/groceriesData";
import { Busy, ErrorBlock, Sk, SkChart, SkLines, SkRows } from "@/components/skeletons";
import { KitchenTab } from "./groceries/KitchenTab";
import { TodayTab } from "./groceries/TodayTab";
import { Rail, RailDrawer } from "./groceries/Rail";
import { useMediaQuery } from "@/lib/useMediaQuery";
import "@/styles/groceries.css";
import { toast } from "sonner";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";

const PRICE_CONF = {
  known: { type: "exact", label: "Known price" },
  estimated: { type: "estimated", label: "Estimated" },
  unknown: { type: "unknown", label: "Unknown" },
};

function Field({ label, children, className }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function GroceryDialog({ item, prefill, locations, defaultLocation, open, setOpen, onSave }) {
  const [f, setF] = useState({});
  useEffect(() => {
    setF(item || { name: "", quantity: "", unit: "unit", category: "", price: "", store: "", low_threshold: "", notes: "", is_favorite: false, storage_location: defaultLocation || "", expiration: "", ...(prefill || {}) });
  }, [item, open, defaultLocation, prefill]);
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
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? "Edit inventory item" : "Add to inventory"}</DialogTitle>
          <DialogDescription>{item ? "Update stock, price or reorder threshold." : "Track something you already have."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-2 space-y-4">
          <Field label="Name">
            <Input placeholder="e.g. Semi-skimmed milk" value={f.name || ""} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <Input type="number" inputMode="decimal" min={0} step="0.01" placeholder="0" value={f.quantity ?? ""} onChange={(e) => setF((x) => ({ ...x, quantity: e.target.value }))} />
            </Field>
            <Field label="Unit">
              <Select value={f.unit || "unit"} onValueChange={(v) => setF((x) => ({ ...x, unit: v }))}>
                <SelectTrigger aria-label="Unit"><SelectValue placeholder="Unit" /></SelectTrigger>
                <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stored in">
              <Select value={f.storage_location || "none"} onValueChange={(v) => setF((x) => ({ ...x, storage_location: v === "none" ? "" : v }))}>
                <SelectTrigger aria-label="Storage space"><SelectValue placeholder="Stored in" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Out on the counter</SelectItem>
                  {(locations || []).map((l) => <SelectItem key={l.id} value={l.name}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Expires">
              <DatePicker aria-label="Expiry date" placeholder="No expiry" value={f.expiration || ""} onChange={(v) => setF((x) => ({ ...x, expiration: v }))}
                presets={[{ label: "Tomorrow", days: 1 }, { label: "In a week", days: 7 }, { label: "In a month", days: 30 }]} />
            </Field>
          </div>
          <Field label="Category">
            <Select value={f.category || "Other"} onValueChange={(v) => setF((x) => ({ ...x, category: v }))}>
              <SelectTrigger aria-label="Category"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Price per unit (${currencySymbol()})`}>
              <Input type="number" inputMode="decimal" min={0} step="0.01" placeholder="Optional" value={f.price ?? ""} onChange={(e) => setF((x) => ({ ...x, price: e.target.value }))} />
            </Field>
            <Field label="Store">
              <Input placeholder="Optional" value={f.store || ""} onChange={(e) => setF((x) => ({ ...x, store: e.target.value }))} />
            </Field>
          </div>
          <Field label="Warn me when stock is at or below">
            <Input type="number" inputMode="decimal" min={0} step="0.01" placeholder="0 = never" value={f.low_threshold ?? ""} onChange={(e) => setF((x) => ({ ...x, low_threshold: e.target.value }))} />
          </Field>
          <Field label="Notes">
            <Input placeholder="Optional" value={f.notes || ""} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} />
          </Field>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox checked={!!f.is_favorite} onCheckedChange={(c) => setF((x) => ({ ...x, is_favorite: c === true }))} />
            Staple I always keep in stock
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800 text-white">{item ? "Save changes" : "Add to inventory"}</Button>
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
              <SelectTrigger aria-label="Unit"><SelectValue placeholder="Unit" /></SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input type="number" min={0} step="0.01" placeholder={`Estimated price (${currencySymbol()})`} value={f.estimated_price} onChange={(e) => setF((x) => ({ ...x, estimated_price: e.target.value }))} />
            <Input placeholder="Store" value={f.store || ""} onChange={(e) => setF((x) => ({ ...x, store: e.target.value }))} />
          </div>
          <Select value={f.category || "Other"} onValueChange={(v) => setF((x) => ({ ...x, category: v }))}>
            <SelectTrigger aria-label="Category"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              {CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="Note" value={f.note || ""} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800 text-white">Save</Button>
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
            <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800 text-white">Create</Button>
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
          <Checkbox id="record-expense" checked={recordExpense} onCheckedChange={(c) => setRecordExpense(c === true)} />
          <Label htmlFor="record-expense">Record as expense in Money</Label>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => onSubmit(recordExpense)} className="bg-emerald-700 hover:bg-emerald-800 text-white">Confirm purchase</Button>
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
        {loading ? <Busy label="Loading the price history" className="mt-2 space-y-3"><Sk className="h-4 w-56" /><SkChart height={220} /><SkLines n={3} line="h-3" /></Busy> : (
          <div className="mt-2">
            {history?.cheapest ? (
              <p className="text-sm text-slate-500 mb-3">Cheapest recently: <span className="font-semibold text-slate-700 dark:text-slate-200">{history.cheapest.store}</span> at {eur(history.cheapest.price)}</p>
            ) : null}
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => `€${v}`} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => eur(v)} />
                  <Line type="monotone" dataKey="price" stroke="var(--chart-line)" strokeWidth={2.5} dot={{ r: 3, fill: "var(--chart-line)", stroke: "var(--chart-line)" }} activeDot={{ r: 6, fill: "var(--tip-bg)", stroke: "var(--chart-line)", strokeWidth: 3 }} animationDuration={1000} />
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
            <SelectTrigger aria-label="Repeat"><SelectValue /></SelectTrigger>
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
                  <SelectTrigger className="col-span-2 h-9" aria-label={`Unit for item ${i + 1}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input className="col-span-3 h-9" type="number" min={0} step="0.01" placeholder="€" value={it.estimated_price} onChange={(e) => updateItem(i, "estimated_price", e.target.value)} />
                <Button type="button" variant="ghost" size="icon" className="col-span-1 h-9 w-9 text-red-500" aria-label={`Remove item ${i + 1}`} onClick={() => removeItem(i)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800 text-white">Save template</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** What each tab needs before it can draw: a section shows its placeholder only until ITS requests are back. */
const GROCERY_TABS = [
  { id: "today", label: "Today", icon: LayoutDashboard },
  { id: "storage", label: "Storage", icon: Refrigerator },
  { id: "shopping", label: "Shopping", icon: ShoppingCart },
  { id: "kitchen", label: "Kitchen", icon: ChefHat },
];

const RAIL_KEY = "lr-groceries-rail";
/** The rail starts open on a wide screen and folded to icons on a smaller one; what the person chooses is remembered on this device. */
function readRail() {
  try { const v = localStorage.getItem(RAIL_KEY); if (v === "open" || v === "closed") return v === "open"; } catch { /* none saved */ }
  return typeof window.matchMedia === "function" ? window.matchMedia("(min-width: 1024px)").matches : true;
}

const TAB_NEEDS = {
  storage: ["locations", "inventory"],
  shopping: ["shopping", "suggestions", "recurring"],
  catalog: ["products", "inventory", "shopping"],
  kitchen: ["recipeIdeas", "appliances", "shopping"],
};

/** A tab's placeholder, with the same grid and card sizes as the tab itself. */
function TabSkeleton({ tab }) {
  const tiles = <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Sk key={i} className="h-[68px] !rounded-2xl" />)}</div>;
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label={`Loading ${tab}`}>
      {tab === "shopping" ? (
        <div className="space-y-4">
          <Sk className="h-[132px] !rounded-[28px]" />
          <Sk className="h-11 w-72 max-w-full !rounded-full" />
          <Card className="p-4"><SkRows n={6} lead="square" /></Card>
        </div>
      ) : (
        <>
          {tiles}
          <div className="grid gap-4 lg:grid-cols-2">{[0, 1].map((i) => <Card key={i} className="p-5"><Sk className="mb-4 h-4 w-40" /><SkRows n={4} lead="square" /></Card>)}</div>
        </>
      )}
    </div>
  );
}

export default function Groceries() {
  const [tab, setTab] = useState("today");
  const { user } = useAuth();
  // Last-seen data (per user) renders instantly; the fetch below then replaces it with the real thing.
  const cached = useMemo(() => readCache(user?.id, GROCERIES_CACHE_KEY), [user?.id]);
  const [locations, setLocations] = useState(cached?.locations ?? []);
  const [selectedSpaceId, setSelectedSpaceId] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [defaultLocation, setDefaultLocation] = useState("");
  const [prefill, setPrefill] = useState(null);
  const [products, setProducts] = useState(cached?.products ?? []);
  const [recipeIdeas, setRecipeIdeas] = useState(cached?.recipeIdeas ?? []);
  const [appliances, setAppliances] = useState(cached?.appliances ?? []);
  const [inventory, setInventory] = useState(cached?.inventory ?? []);
  const [shopping, setShopping] = useState(cached?.shopping ?? null);
  const [loading, setLoading] = useState(!cached);
  // Which pieces of the page have arrived (all of them when the last-seen copy is on screen) and which failed to.
  const [have, setHave] = useState(() => (cached ? Object.fromEntries(Object.keys(GROCERY_PARTS).map((k) => [k, true])) : {}));
  const [failed, setFailed] = useState({});
  const [selectedListId, setSelectedListId] = useState(cached?.selectedListId ?? "");
  const [suggestions, setSuggestions] = useState(cached?.suggestions ?? []);
  const [recurring, setRecurring] = useState(cached?.recurring ?? []);
  const [lowStock, setLowStock] = useState(cached?.lowStock ?? []);

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
  const [generated, setGenerated] = useState(null);   // {ids, listId, source, note}: the last batch the assistant added, until it is kept, undone or dismissed
  const [priceItem, setPriceItem] = useState(null);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [editingRecurring, setEditingRecurring] = useState(null);
  const [deleteRecurringId, setDeleteRecurringId] = useState(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const phone = useMediaQuery("(max-width: 639px)");   // the same breakpoint the app shell uses for its phone ball
  const [railOpen, setRailOpen] = useState(readRail);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const toggleRail = () => setRailOpen((v) => { try { localStorage.setItem(RAIL_KEY, v ? "closed" : "open"); } catch { /* the choice just is not remembered */ } return !v; });

  const setters = useMemo(() => ({
    inventory: setInventory, shopping: setShopping, lowStock: setLowStock, suggestions: setSuggestions, recurring: setRecurring,
    locations: setLocations, products: setProducts, recipeIdeas: setRecipeIdeas, appliances: setAppliances,
  }), []);
  // Every piece is its own request: each one lands in the page the moment it is back, so a slow one never holds the others.
  const selVer = useRef(0);   // bumped by every tick: a refresh that started before a tick must not undo it with older data
  const loadSeq = useRef(0);   // a slow answer to an older request (made before a list was chosen) must never overwrite a newer one
  const load = useCallback(async () => {
    const fresh = {};
    let listId = selectedListId;
    const mine = ++loadSeq.current;
    const ver = selVer.current;
    try {
      await Promise.all(Object.keys(GROCERY_PARTS).map(async (k) => {
        try {
          const data = await GROCERY_PARTS[k](selectedListId);
          if (mine !== loadSeq.current) return;
          fresh[k] = data;
          setters[k](data);
          setHave((h) => (h[k] ? h : { ...h, [k]: true }));
          setFailed((f) => (f[k] ? { ...f, [k]: false } : f));
          if (k === "shopping") {
            if (data?.lists?.length && !listId) {
              const active = data.lists.find((l) => !l.archived);
              listId = active?.id || data.lists[0].id;
              setSelectedListId(listId);
            }
            if (ver === selVer.current) setSelectedIds(new Set((data?.items || []).filter((i) => i.selected).map((i) => i.id)));
          }
        } catch { setFailed((f) => ({ ...f, [k]: true })); }
      }));
      if (mine === loadSeq.current && Object.keys(GROCERY_PARTS).every((k) => k in fresh)) writeCache(user?.id, GROCERIES_CACHE_KEY, { ...fresh, selectedListId: listId });
    } finally { setLoading(false); }
  }, [selectedListId, user?.id, setters]);

  useEffect(() => {
    // With cached data on screen the refresh is silent; only a cold start shows the loading state.
    const unwatch = watchGroceries();
    load();
    const h = () => load();
    window.addEventListener("lm:refresh", h);
    return () => { window.removeEventListener("lm:refresh", h); unwatch(); };
  }, [load]);

  const currentList = useMemo(() => (shopping?.lists || []).find((l) => l.id === selectedListId), [shopping, selectedListId]);
  const listItems = useMemo(() => (shopping?.items || []).filter((it) => it.list_id === selectedListId), [shopping, selectedListId]);

  const changeQuantity = async (it, dir) => {
    const step = stepFor(it.unit), next = Math.max(step, Math.round((Number(it.quantity) + dir * step) * 100) / 100);
    try { await api.put(`/shopping/${it.id}`, { quantity: next }); refreshAll(); } catch (err) { toast.error(err.response?.data?.detail || "Could not change the quantity"); }
  };

  const flip = (prev, id) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; };
  // The tick shows at once and is undone if the server says no.
  const toggleSelect = async (id) => {
    selVer.current += 1;
    setSelectedIds((prev) => flip(prev, id));
    try {
      await api.post(`/shopping/${id}/toggle`);
      refreshAll();
    } catch (err) { setSelectedIds((prev) => flip(prev, id)); toast.error(err.response?.data?.detail || "Could not update selection"); }
  };

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
      setPrefill(null);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not save"); }
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

  // The assistant reads the kitchen and proposes the list. What it added is remembered (`generated`) so the whole batch can be taken back.
  const undoGenerate = async (batch) => {
    try {
      await api.post("/shopping/bulk-delete", { ids: batch.ids });
      setGenerated(null);
      toast.success(`Took back ${batch.ids.length === 1 ? "the item" : `the ${batch.ids.length} items`} it added`);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not undo that"); }
  };
  const generateList = async () => {
    setGenerating(true);
    setGenerated(null);
    try {
      const { data } = await api.post("/shopping/generate-ai", null, { params: { days: 7, list_id: selectedListId || undefined }, timeout: 70000 });
      const ids = data.created_ids || [];
      if (!ids.length) {
        toast(data.note || "Your list already covers what you need", { description: "Nothing new to add right now." });
      } else {
        const batch = { ids, listId: selectedListId, source: data.source, note: data.note };
        setGenerated(batch);
        toast.success(`Added ${ids.length === 1 ? "1 item" : `${ids.length} items`} to your list`, {
          description: data.note || undefined, duration: 12000, action: { label: "Undo", onClick: () => undoGenerate(batch) },
        });
      }
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not make a list just now"); }
    finally { setGenerating(false); }
  };

  const updateBudget = async (budget) => {
    if (!selectedListId) return;
    try {
      await api.put(`/shopping/lists/${selectedListId}`, { budget });
      // One fixed id so repeated saves replace the toast instead of stacking up.
      toast.success(budget === null ? "Budget removed" : "Budget updated", { id: "list-budget" });
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not update budget", { id: "list-budget" }); }
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
  const activeTab = GROCERY_TABS.find((t) => t.id === tab) || GROCERY_TABS[0];
  const cartTodo = cartCount(listItems, selectedIds);

  return (
    <div className="gt-shell">
      {!phone && <Rail tabs={GROCERY_TABS} value={tab} onChange={setTab} open={railOpen} onToggle={toggleRail} onCatalog={() => setCatalogOpen(true)} />}
      <div className="gt-main space-y-6">
      <div className="gt-head2">
      <div className="gt-headrow">
        {phone && (
          <button type="button" className="gt-icon-btn" onClick={() => setDrawerOpen(true)} aria-haspopup="dialog" data-testid="gt-drawer-open">
            <Menu aria-hidden="true" /><span className="sr-only">Sections, now {activeTab.label}</span>
          </button>
        )}
        <SectionHeading title="Groceries" sub={phone ? activeTab.label : "Inventory, shopping lists and smart restocking"} />
        {phone && tab !== "shopping" && (
          <button type="button" className="gt-icon-btn" onClick={() => setCartOpen(true)} aria-haspopup="dialog" data-testid="cart-open">
            <ShoppingCart aria-hidden="true" /><span className="sr-only">Cart{cartTodo > 0 ? `, ${cartTodo} to get` : ""}</span>
            {cartTodo > 0 && <b aria-hidden="true">{cartTodo}</b>}
          </button>
        )}
      </div>

      <QuickAdd tab={tab} products={products} inventory={inventory} recipeIdeas={recipeIdeas} listItems={listItems} listId={selectedListId} locations={locations} spaceId={selectedSpaceId} setTab={setTab} />
      </div>

      <div role="tabpanel" id="gpanel" aria-label={activeTab.label} className="gt-tabpanel">
          {tab !== "today" && tab !== "shopping" && !TAB_NEEDS[tab].every((k) => have[k]) ? (
            TAB_NEEDS[tab].some((k) => failed[k] && !have[k]) ? <ErrorBlock what={tab} onRetry={load} /> : <TabSkeleton tab={tab} />
          ) : tab === "shopping" && !TAB_NEEDS.shopping.every((k) => have[k]) ? (
            TAB_NEEDS.shopping.some((k) => failed[k] && !have[k]) ? <ErrorBlock what="the shopping lists" onRetry={load} /> : <TabSkeleton tab="shopping" />
          ) : tab === "today" ? (
            <TodayTab have={have} failed={failed} onRetry={load} inventory={inventory} locations={locations} shopping={shopping} selectedListId={selectedListId} recipeIdeas={recipeIdeas}
              setTab={setTab} onOpenSpace={(id) => { setSelectedSpaceId(id); setTab("storage"); }} onAddToList={(g) => addSuggestion({ name: g.name, default_quantity: g.default_quantity || 1, unit: g.unit, category: g.category, price: g.price })} />
          ) : tab === "kitchen" ? (
            <KitchenTab suggestions={recipeIdeas} appliances={appliances} lists={shopping?.lists || []} selectedListId={selectedListId} />
          ) : tab === "storage" ? (
            <StorageTab locations={locations} inventory={inventory} selectedListId={selectedListId}
              selectedId={selectedSpaceId} setSelectedId={setSelectedSpaceId} detailsOpen={detailsOpen} setDetailsOpen={setDetailsOpen}
              onAddItem={(loc) => { setEditingGrocery(null); setPrefill(null); setDefaultLocation(loc || ""); setGroceryDialogOpen(true); }}
              onEditItem={(g) => { setEditingGrocery(g); setPrefill(null); setGroceryDialogOpen(true); }} />
          ) : (
            <ShoppingTab
              shopping={shopping} items={listItems} selectedListId={selectedListId} setSelectedListId={setSelectedListId} currentList={currentList}
              selectedIds={selectedIds} inventory={inventory} lowStock={lowStock} suggestions={suggestions} recipeIdeas={recipeIdeas} recurring={recurring}
              loading={loading} generating={generating} generated={generated && generated.listId === selectedListId ? generated : null}
              onUndoGenerate={() => generated && undoGenerate(generated)} onKeepGenerated={() => setGenerated(null)}
              onToggle={toggleSelect} onQty={changeQuantity} onNewList={() => setListDialogOpen(true)} onDeleteList={setDeleteListId} onBudget={updateBudget}
              onGenerate={generateList} onAddItem={() => { setEditingItem(null); setItemDialogOpen(true); }}
              onEditItem={(it) => { setEditingItem(it); setItemDialogOpen(true); }} onDeleteItem={setDeleteItemId} onHistory={setPriceItem} onSuggest={addSuggestion}
              onSpawn={spawnRecurring} onEditRecurring={(rl) => { setEditingRecurring(rl); setRecurringOpen(true); }} onDeleteRecurring={setDeleteRecurringId}
              onBulkDelete={() => setBulkDeleteOpen(true)} onSubmit={() => setSubmitOpen(true)}
              onSelectAll={(rows) => setSelectedIds(new Set(rows.map((i) => i.id)))} onDeselectAll={() => setSelectedIds(new Set())}
            />
          )}
      </div>
      </div>
      {phone && <RailDrawer open={drawerOpen} onOpenChange={setDrawerOpen} tabs={GROCERY_TABS} value={tab} onChange={setTab} onCatalog={() => setCatalogOpen(true)} />}
      <Dialog open={catalogOpen} onOpenChange={setCatalogOpen}>
        <DialogContent className="gt gt-catalog max-w-6xl max-h-[92vh] grid-cols-[minmax(0,1fr)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Catalog</DialogTitle>
            <DialogDescription>Every product you know: put it on a list, in your kitchen, or keep your own.</DialogDescription>
          </DialogHeader>
          {TAB_NEEDS.catalog.every((k) => have[k]) ? (
            <CatalogTab products={products} inventory={inventory} listItems={listItems} selectedListName={currentList?.name}
                  onAddToInventory={(p) => { setEditingGrocery(null); setDefaultLocation(""); setPrefill({ name: p.name, unit: p.default_unit || "unit", category: CATS.includes(p.category) ? p.category : "Other", quantity: p.typical_quantity ?? "", is_favorite: !!p.is_favorite }); setGroceryDialogOpen(true); }}
                  onAddToList={(p) => addSuggestion({ name: p.name, default_quantity: p.typical_quantity || 1, unit: p.default_unit, category: p.category })} />
          ) : TAB_NEEDS.catalog.some((k) => failed[k] && !have[k]) ? <ErrorBlock what="the catalog" onRetry={load} /> : <TabSkeleton tab="catalog" />}
        </DialogContent>
      </Dialog>
      {tab !== "shopping" && <CartDock items={listItems} listName={currentList?.name} selectedIds={selectedIds} onToggle={toggleSelect} onQty={changeQuantity} onDelete={setDeleteItemId} onSubmit={() => setSubmitOpen(true)}
        open={cartOpen} onOpenChange={setCartOpen} showButton={!phone} />}

      <GroceryDialog item={editingGrocery} prefill={prefill} locations={locations} defaultLocation={defaultLocation} open={groceryDialogOpen} setOpen={setGroceryDialogOpen} onSave={saveGrocery} />
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
        onConfirm={() => deleteItemId && deleteShoppingItem(deleteItemId)}
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
