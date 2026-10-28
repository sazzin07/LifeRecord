import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LayoutGrid, List, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { CATS, CAT_META, CatIcon, NUTRI_FILTERS, catOf } from "./shared";
import { ProductCard, ProductDialog, ProductRow, ROW_GRID } from "./catalogParts";
import { ActiveFilters, Chip, EMPTY_FILTERS, FiltersPopover, Pager, activeFilterList, filtersEqual, usePresets } from "./catalogFilters";

const PAGE_SIZE = 50;
const VIEW_KEY = "lr.catalog.view";
const readView = () => {
  try { return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "cards"; } catch { return "cards"; }
};
const saveView = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ } };

const SORTS = [
  { id: "smart", label: "Favourites first" },
  { id: "name", label: "Name A to Z" },
  { id: "name_desc", label: "Name Z to A" },
  { id: "protein", label: "Most protein" },
  { id: "kcal_asc", label: "Fewest calories" },
  { id: "kcal_desc", label: "Most calories" },
];

const byName = (a, b) => a.name.localeCompare(b.name);
const nutri = (p, k) => (p.nutrition ? Number(k === "kcal" ? p.nutrition.calories_per_100g : p.nutrition[k]) : null);
const sortFns = {
  smart: (a, b) => Number(!!b.is_favorite) - Number(!!a.is_favorite) || byName(a, b),
  name: byName,
  name_desc: (a, b) => byName(b, a),
  protein: (a, b) => (nutri(b, "protein") ?? -1) - (nutri(a, "protein") ?? -1) || byName(a, b),
  kcal_asc: (a, b) => (nutri(a, "kcal") ?? Infinity) - (nutri(b, "kcal") ?? Infinity) || byName(a, b),
  kcal_desc: (a, b) => (nutri(b, "kcal") ?? -1) - (nutri(a, "kcal") ?? -1) || byName(a, b),
};

function SectionHeader({ group, open, onToggle }) {
  const meta = group.category ? CAT_META[group.category] : null;
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${group.title}`}
      className="flex w-full items-center gap-2.5 rounded-xl px-1 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {group.category && <CatIcon category={group.category} className="h-8 w-8" />}
      <h3 className="text-base font-semibold" style={meta ? { color: meta.color } : undefined}>{group.title}</h3>
      <span className="text-sm text-muted-foreground tabular-nums">{group.items.length}</span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !open && "-rotate-90")} aria-hidden="true" />
    </button>
  );
}

function ListHeader({ sort, setSort }) {
  const SortBtn = ({ label, asc, desc, className }) => (
    <button type="button" onClick={() => setSort(sort === asc ? desc : asc)}
      className={cn("flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground", className)}>
      {label}{(sort === asc || sort === desc) && <span aria-hidden="true">{sort === asc ? "▲" : "▼"}</span>}
    </button>
  );
  return (
    <div className={cn(ROW_GRID, "hidden border-b border-border px-3 py-2 lg:grid")}>
      <SortBtn label="Product" asc="name" desc="name_desc" />
      <span className="text-xs font-medium text-muted-foreground">Category</span>
      <span className="text-xs font-medium text-muted-foreground">Usual buy</span>
      <SortBtn label="kcal" asc="kcal_asc" desc="kcal_desc" className="justify-end" />
      <SortBtn label="Prot." asc="protein" desc="protein" className="justify-end" />
      <span className="text-right text-xs font-medium text-muted-foreground">Carbs</span>
      <span className="text-right text-xs font-medium text-muted-foreground">Fat</span>
      <span className="text-xs font-medium text-muted-foreground">Status</span>
      <span className="w-32" aria-hidden="true" />
    </div>
  );
}

export function CatalogTab({ products, inventory = [], listItems = [], selectedListName, onAddToInventory, onAddToList }) {
  const [view, setViewState] = useState(readView);
  const [q, setQ] = useState("");
  const [filters, setFiltersState] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState("smart");
  const [page, setPage] = useState(1);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [dialog, setDialog] = useState({ open: false, product: null });
  const [del, setDel] = useState(null);
  const listTop = useRef(null);
  const presets = usePresets();

  const { cat, sub, diet, nutri: nutriSel, stock: stockFilter, fav: favOnly } = filters;
  const setFilters = (patch) => setFiltersState((f) => ({ ...f, ...patch }));
  const setView = (v) => { setViewState(v); saveView(v); };

  const stockByName = useMemo(() => {
    const m = new Map();
    inventory.forEach((g) => {
      if (!(Number(g.quantity) > 0)) return;
      const k = g.name.toLowerCase();
      const cur = m.get(k);
      m.set(k, { quantity: (cur?.quantity || 0) + Number(g.quantity), unit: cur?.unit || g.unit });
    });
    return m;
  }, [inventory]);
  const listed = useMemo(() => new Set(listItems.filter((i) => !i.bought).map((i) => i.name.toLowerCase())), [listItems]);
  const stockOf = (p) => stockByName.get(p.name.toLowerCase()) || (p.synonyms || []).map((s) => stockByName.get(String(s).toLowerCase())).find(Boolean) || null;
  const isListed = (p) => listed.has(p.name.toLowerCase());

  // Everything except the category and subcategory choice, so the counts in the filters show what each would give.
  const base = useMemo(() => {
    const term = q.trim().toLowerCase();
    return products.filter((p) => {
      if (favOnly && !p.is_favorite) return false;
      if (term && !(p.name.toLowerCase().includes(term) || (p.subcategory || "").toLowerCase().includes(term)
        || (p.synonyms || []).some((s) => String(s).toLowerCase().includes(term)))) return false;
      if (diet.some((t) => !(p.tags || []).includes(t))) return false;
      if (nutriSel.some((k) => !NUTRI_FILTERS.find((f) => f.key === k).test(p.nutrition))) return false;
      if (stockFilter === "in" && !stockOf(p)) return false;
      if (stockFilter === "out" && stockOf(p)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, q, diet, nutriSel, stockFilter, favOnly, stockByName]);

  const counts = useMemo(() => base.reduce((m, p) => ({ ...m, [catOf(p)]: (m[catOf(p)] || 0) + 1 }), {}), [base]);
  const inCat = useMemo(() => (cat === "all" ? base : base.filter((p) => catOf(p) === cat)), [base, cat]);
  const subCounts = useMemo(() => inCat.reduce((m, p) => { const s = p.subcategory || "Other"; return { ...m, [s]: (m[s] || 0) + 1 }; }, {}), [inCat]);
  const rows = useMemo(
    () => (sub === "all" || cat === "all" ? inCat : inCat.filter((p) => (p.subcategory || "Other") === sub)).slice().sort(sortFns[sort]),
    [inCat, sub, cat, sort],
  );

  // The list shows PAGE_SIZE rows at a time; any change to what is shown starts again from page one.
  useEffect(() => { setPage(1); }, [q, filters, sort, view]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const pageRows = rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const goToPage = (n) => { setPage(n); listTop.current?.scrollIntoView({ block: "start" }); };

  const groups = useMemo(() => {
    if (view === "list" || !rows.length) return [{ key: "all", title: null, items: rows }];
    if (cat === "all") {
      return CATS.map((c) => ({ key: c, title: c, category: c, items: rows.filter((p) => catOf(p) === c) })).filter((g) => g.items.length);
    }
    if (sub === "all") {
      const subs = [...new Set(rows.map((p) => p.subcategory || "Other"))].sort((a, b) => a.localeCompare(b));
      return subs.map((s) => ({ key: s, title: s, category: cat, items: rows.filter((p) => (p.subcategory || "Other") === s) }));
    }
    return [{ key: sub, title: null, items: rows }];
  }, [rows, view, cat, sub]);

  const filtersActive = !!q || activeFilterList(filters).length > 0;
  const clearAll = () => { setQ(""); setFiltersState(EMPTY_FILTERS); };
  const applyPreset = (p) => setFiltersState({ ...EMPTY_FILTERS, ...p.filters });
  const isApplied = (p) => filtersEqual(filters, { ...EMPTY_FILTERS, ...p.filters });
  const pinned = presets.presets.filter((p) => p.pinned);

  const save = async (payload) => {
    const editing = dialog.product;
    try {
      if (editing) await api.put(`/products/${editing.id}`, payload); else await api.post("/products", payload);
      toast.success(editing ? "Product updated" : "Product added");
      setDialog({ open: false, product: null });
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not save the product"); }
  };
  const toggleFav = async (p) => {
    try { await api.put(`/products/${p.id}`, { is_favorite: !p.is_favorite }); refreshAll(); }
    catch (err) { toast.error(err.response?.data?.detail || "Could not update the product"); }
  };
  const remove = async () => {
    const p = del;
    setDel(null);
    try { await api.delete(`/products/${p.id}`); toast.success(`${p.name} removed from the catalog`); refreshAll(); }
    catch (err) { toast.error(err.response?.data?.detail || "Could not remove the product"); }
  };

  const itemProps = (p) => ({
    product: p, stock: stockOf(p), onList: isListed(p), selectedListName,
    onToggleFav: toggleFav, onAddToInventory, onAddToList, onEdit: (x) => setDialog({ open: true, product: x }), onRemove: setDel,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input className="pl-9 pr-9" placeholder="Search products, types or alternative names" aria-label="Search the catalog" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-44" aria-label="Sort products"><SelectValue /></SelectTrigger>
            <SelectContent>{SORTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Catalog view">
            {[["cards", "Cards", LayoutGrid], ["list", "List", List]].map(([id, label, Icon]) => (
              <button key={id} type="button" onClick={() => setView(id)} aria-pressed={view === id}
                className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  view === id ? "bg-emerald-600 text-white" : "text-muted-foreground hover:bg-accent/50")}>
                <Icon className="h-4 w-4" aria-hidden="true" />{label}
              </button>
            ))}
          </div>
          <Button className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setDialog({ open: true, product: null })}><Plus className="mr-1.5 h-4 w-4" />Add product</Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <FiltersPopover filters={filters} setFilters={setFilters} counts={counts} subCounts={subCounts}
          presets={presets.presets} onApplyPreset={applyPreset} onTogglePin={presets.togglePin}
          onRemovePreset={(p) => { presets.remove(p.id); toast.success(`Deleted saved filter ${p.name}`); }} />
        {pinned.length > 0 && (
          <div className="-mr-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pr-1 scrollbar-hide" role="group" aria-label="Quick filters">
            {pinned.map((p) => (
              <Chip key={p.id} small active={isApplied(p)} onClick={() => (isApplied(p) ? setFiltersState(EMPTY_FILTERS) : applyPreset(p))}>{p.name}</Chip>
            ))}
          </div>
        )}
      </div>

      <ActiveFilters filters={filters} onClearOne={setFilters} onClearAll={clearAll}
        onSavePreset={(name) => { presets.add(name, filters); toast.success(`Saved "${name}" to quick access`); }} />

      <div ref={listTop} className="flex min-h-8 scroll-mt-4 flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground" aria-live="polite">
        <span>Showing {rows.length} of {products.length} products</span>
        {view === "list" && <Pager page={current} pages={pages} total={rows.length} size={PAGE_SIZE} onPage={goToPage} />}
      </div>

      {rows.length === 0 ? (
        <EmptyState icon={Search} title="No products match"
          sub={products.length ? "Try another word or loosen a filter." : "Add the things you buy often to build your catalog."}
          action={filtersActive ? <Button variant="outline" onClick={clearAll}>Clear filters</Button> : undefined} />
      ) : view === "list" ? (
        <>
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <ListHeader sort={sort} setSort={setSort} />
            <ul className="divide-y divide-border">{pageRows.map((p) => <ProductRow key={p.id} {...itemProps(p)} />)}</ul>
          </div>
          {pages > 1 && <Pager page={current} pages={pages} total={rows.length} size={PAGE_SIZE} onPage={goToPage} className="justify-end" />}
        </>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            const open = !g.title || !collapsed.has(g.key);
            return (
              <section key={g.key} aria-label={g.title || "Products"} className="[content-visibility:auto] [contain-intrinsic-size:auto_480px]">
                {g.title && (
                  <SectionHeader group={g} open={open} onToggle={() => setCollapsed((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })} />
                )}
                {open && (
                  <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5", g.title && "mt-2")}>
                    {g.items.map((p) => <ProductCard key={p.id} {...itemProps(p)} />)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <ProductDialog product={dialog.product} products={products} open={dialog.open} setOpen={(v) => setDialog((d) => ({ ...d, open: v }))} onSave={save} />
      <ConfirmDialog open={!!del} onOpenChange={(v) => !v && setDel(null)} title={`Remove ${del?.name}?`}
        description="It leaves the catalog only. Stock and shopping lists are not affected." onConfirm={remove} confirmText="Remove" variant="danger" />
    </div>
  );
}
