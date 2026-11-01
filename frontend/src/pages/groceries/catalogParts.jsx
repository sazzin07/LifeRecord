import { useEffect, useMemo, useState } from "react";
import { MoreHorizontal, PackagePlus, Pencil, ShoppingCart, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { CATS, UNITS, CAT_META, CatIcon, DIET_TAGS, catOf } from "./shared";

export const MACRO_COLORS = { protein: "#E11D48", carbs: "#F59E0B", fat: "#6366F1" };

const qtyText = (q) => (q ? `${+Number(q).toFixed(2)} ` : "");

/** Protein / carbs / fat as a thin segmented bar, proportional to grams per 100 g. */
export function MacroBar({ nutrition, className }) {
  const n = nutrition;
  const total = n ? (n.protein || 0) + (n.carbs || 0) + (n.fat || 0) : 0;
  if (!n || total <= 0) return <div className={cn("h-1 bg-border/60", className)} aria-hidden="true" />;
  return (
    <div className={cn("flex h-1 overflow-hidden", className)} role="img"
      aria-label={`Per 100 g: protein ${n.protein} g, carbs ${n.carbs} g, fat ${n.fat} g`}>
      {Object.entries(MACRO_COLORS).map(([k, color]) => (
        <span key={k} style={{ width: `${((n[k] || 0) / total) * 100}%`, background: color }} />
      ))}
    </div>
  );
}

export function MacroNumbers({ nutrition, className }) {
  if (!nutrition) return null;
  return (
    <span className={cn("flex flex-wrap items-center gap-x-2.5 text-xs text-muted-foreground", className)}>
      {[["protein", "P"], ["carbs", "C"], ["fat", "F"]].map(([k, l]) => (
        <span key={k} className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: MACRO_COLORS[k] }} aria-hidden="true" />
          {l} {nutrition[k] ?? 0}
        </span>
      ))}
    </span>
  );
}

/** Dietary marks. Vegan implies vegetarian, so only the stronger one is shown. */
export function DietMarks({ tags, max = 3, nowrap = false, className }) {
  const have = (tags || []).filter((t) => !(t === "vegetarian" && (tags || []).includes("vegan")));
  if (!have.length) return null;
  const shown = have.slice(0, max);
  return (
    <span className={cn("flex gap-1", nowrap ? "flex-nowrap overflow-hidden" : "flex-wrap", className)}>
      {shown.map((t) => (
        <span key={t} className={cn("whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
          t === "vegan" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
          {DIET_TAGS.find((d) => d.key === t)?.label || t}
        </span>
      ))}
      {have.length > shown.length && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">+{have.length - shown.length}</span>}
    </span>
  );
}

function StockNote({ stock, onList, className }) {
  if (stock) {
    return <span className={cn("whitespace-nowrap rounded-full bg-emerald-700 px-2 py-0.5 text-[11px] font-medium text-white", className)}>{+Number(stock.quantity).toFixed(2)} {stock.unit || ""} in stock</span>;
  }
  if (onList) return <span className={cn("whitespace-nowrap rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-white", className)}>On your list</span>;
  return null;
}

function ProductMenu({ product, onEdit, onRemove }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`More actions for ${product.name}`}><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(product)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
        <DropdownMenuItem className="text-red-600 focus:text-red-600" onSelect={() => onRemove(product)}><Trash2 className="mr-2 h-4 w-4" />Remove</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FavButton({ product, onToggle, className }) {
  return (
    <button type="button" aria-label={product.is_favorite ? `Unfavourite ${product.name}` : `Favourite ${product.name}`} aria-pressed={!!product.is_favorite}
      onClick={() => onToggle(product)}
      className={cn("grid h-8 w-8 place-items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
      <Star className={cn("h-4 w-4", product.is_favorite ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
    </button>
  );
}

export function ProductCard({ product: p, stock, onList, selectedListName, onToggleFav, onAddToInventory, onAddToList, onEdit, onRemove }) {
  const cat = catOf(p);
  const color = CAT_META[cat].color;
  const kcal = p.nutrition?.calories_per_100g;
  return (
    <article data-testid="product-card" className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground transition-shadow hover:shadow-md">
      <div className="relative grid h-24 place-items-center" style={{ background: `linear-gradient(135deg, ${color}2e, ${color}0d)` }}>
        {p.icon
          ? <span className="select-none text-5xl leading-none" aria-hidden="true">{p.icon}</span>
          : <CatIcon category={cat} className="h-14 w-14 rounded-2xl" />}
        <StockNote stock={stock} onList={onList} className="absolute left-2 top-2" />
        <FavButton product={p} onToggle={onToggleFav} className="absolute right-1 top-1 bg-background/70 backdrop-blur hover:bg-background" />
      </div>
      <MacroBar nutrition={p.nutrition} />
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold" title={p.name}>{p.name}</h3>
          <p className="truncate text-xs text-muted-foreground">{p.subcategory || cat}, usually {qtyText(p.typical_quantity)}{p.default_unit}</p>
        </div>
        {kcal != null ? (
          <div className="space-y-0.5">
            <p className="text-xs"><span className="font-semibold tabular-nums">{kcal}</span> <span className="text-muted-foreground">kcal per 100 g</span></p>
            <MacroNumbers nutrition={p.nutrition} />
          </div>
        ) : null}
        <DietMarks tags={p.tags} className="mt-auto pt-1" />
      </div>
      <div className="flex items-center border-t border-border px-1.5 py-1">
        <Button variant="ghost" size="sm" className="h-8 flex-1 gap-1 px-2 text-xs" aria-label={`Add ${p.name} to inventory`} onClick={() => onAddToInventory(p)}>
          <PackagePlus className="h-4 w-4" />Inventory
        </Button>
        <Button variant="ghost" size="sm" className="h-8 flex-1 gap-1 px-2 text-xs" aria-label={`Add ${p.name} to ${selectedListName || "the shopping"} list`} onClick={() => onAddToList(p)}>
          <ShoppingCart className="h-4 w-4" />List
        </Button>
        <ProductMenu product={p} onEdit={onEdit} onRemove={onRemove} />
      </div>
    </article>
  );
}

export const ROW_GRID = "grid items-center gap-x-3 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1.1fr)_minmax(0,.7fr)_3.5rem_3rem_3rem_3rem_minmax(0,2fr)_auto]";

export function ProductRow({ product: p, stock, onList, selectedListName, onToggleFav, onAddToInventory, onAddToList, onEdit, onRemove }) {
  const cat = catOf(p);
  const n = p.nutrition;
  const num = (v) => (v == null ? "" : v);
  return (
    <li data-testid="product-card" className={cn(ROW_GRID, "grid-cols-[minmax(0,1fr)_auto] gap-y-1 px-3 py-2 hover:bg-accent/40")}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xl" style={{ background: `${CAT_META[cat].color}22` }} aria-hidden="true">
          {p.icon || <CatIcon category={cat} className="h-9 w-9" />}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{p.name}</p>
          <p className="truncate text-xs text-muted-foreground lg:hidden">{p.subcategory || cat}{n ? `, ${n.calories_per_100g} kcal` : ""}</p>
          <StockNote stock={stock} onList={onList} className="mt-0.5 inline-block lg:hidden" />
        </div>
      </div>
      <div className="hidden min-w-0 lg:block">
        <p className="truncate text-sm">{cat}</p>
        <p className="truncate text-xs text-muted-foreground">{p.subcategory}</p>
      </div>
      <p className="hidden truncate text-sm text-muted-foreground lg:block">{qtyText(p.typical_quantity)}{p.default_unit}</p>
      <p className="hidden text-right text-sm tabular-nums lg:block">{num(n?.calories_per_100g)}</p>
      <p className="hidden text-right text-sm tabular-nums lg:block">{num(n?.protein)}</p>
      <p className="hidden text-right text-sm tabular-nums lg:block">{num(n?.carbs)}</p>
      <p className="hidden text-right text-sm tabular-nums lg:block">{num(n?.fat)}</p>
      <div className="hidden min-w-0 items-center gap-1.5 lg:flex">
        <StockNote stock={stock} onList={onList} />
        <DietMarks tags={p.tags} max={2} nowrap />
      </div>
      <div className="flex shrink-0 items-center justify-end">
        <FavButton product={p} onToggle={onToggleFav} />
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Add ${p.name} to inventory`} title="Add to inventory" onClick={() => onAddToInventory(p)}><PackagePlus className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Add ${p.name} to ${selectedListName || "the shopping list"}`} title="Add to shopping list" onClick={() => onAddToList(p)}><ShoppingCart className="h-4 w-4" /></Button>
        <ProductMenu product={p} onEdit={onEdit} onRemove={onRemove} />
      </div>
    </li>
  );
}

export function ProductDialog({ product, products, open, setOpen, onSave }) {
  const blank = { name: "", category: "Other", subcategory: "", icon: "", default_unit: "unit", typical_quantity: "", is_favorite: false, synonyms: "", tags: [], calories: "", protein: "", carbs: "", fat: "" };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (!open) return;
    const n = product?.nutrition || {};
    setF(product ? {
      name: product.name, category: catOf(product), subcategory: product.subcategory || "", icon: product.icon || "",
      default_unit: product.default_unit || "unit", typical_quantity: product.typical_quantity ?? "", is_favorite: !!product.is_favorite,
      synonyms: (product.synonyms || []).join(", "), tags: product.tags || [],
      calories: n.calories_per_100g ?? "", protein: n.protein ?? "", carbs: n.carbs ?? "", fat: n.fat ?? "",
    } : blank);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, open]);
  const subOptions = useMemo(
    () => [...new Set((products || []).filter((p) => catOf(p) === f.category && p.subcategory).map((p) => p.subcategory))].sort(),
    [products, f.category],
  );
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const num = (v) => (v === "" || v === null ? null : Number(v));
  const toggleTag = (key, on) => setF((x) => {
    const tags = new Set(x.tags);
    if (on) tags.add(key); else tags.delete(key);
    if (key === "vegan" && on) tags.add("vegetarian");
    return { ...x, tags: [...tags] };
  });
  const submit = (e) => {
    e.preventDefault();
    const nutrition = [f.calories, f.protein, f.carbs, f.fat].some((v) => v !== "")
      ? { calories_per_100g: num(f.calories), protein: num(f.protein), carbs: num(f.carbs), fat: num(f.fat) } : null;
    onSave({
      name: f.name.trim(), category: f.category, subcategory: f.subcategory.trim(), icon: f.icon.trim() || null,
      default_unit: f.default_unit, typical_quantity: num(f.typical_quantity), is_favorite: f.is_favorite,
      synonyms: f.synonyms.split(",").map((s) => s.trim()).filter(Boolean), tags: f.tags, nutrition,
    });
  };
  const L = ({ label, children }) => <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{product ? "Edit product" : "Add product"}</DialogTitle>
          <DialogDescription>Products are your reusable shopping basics. Adding one to the catalog does not add stock.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-[1fr_5rem] gap-3">
            <L label="Name"><Input value={f.name} onChange={set("name")} placeholder="e.g. Semi-skimmed milk" required /></L>
            <L label="Emoji"><Input value={f.icon} onChange={set("icon")} maxLength={8} className="text-center text-lg" placeholder="🥛" /></L>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <L label="Category">
              <Select value={f.category} onValueChange={(v) => setF((x) => ({ ...x, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </L>
            <L label="Subcategory">
              <Input list="catalog-subcategories" value={f.subcategory} onChange={set("subcategory")} placeholder="e.g. Cheese" />
              <datalist id="catalog-subcategories">{subOptions.map((s) => <option key={s} value={s} />)}</datalist>
            </L>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <L label="Usual unit">
              <Select value={f.default_unit} onValueChange={(v) => setF((x) => ({ ...x, default_unit: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </L>
            <L label="Usual amount per shop"><Input type="text" inputMode="decimal" value={f.typical_quantity} onChange={(e) => /^[0-9]*[.,]?[0-9]{0,2}$/.test(e.target.value) && setF((x) => ({ ...x, typical_quantity: e.target.value.replace(",", ".") }))} placeholder="Optional" /></L>
          </div>
          <L label="Also known as"><Input value={f.synonyms} onChange={set("synonyms")} placeholder="Comma separated, e.g. courgette, zucchini" /></L>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">Suitable for</legend>
            <div className="grid grid-cols-2 gap-2">
              {DIET_TAGS.map((d) => (
                <label key={d.key} className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={f.tags.includes(d.key)} onCheckedChange={(c) => toggleTag(d.key, c === true)} />{d.label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-1.5">
            <legend className="text-xs font-medium text-muted-foreground">Nutrition per 100 g (optional)</legend>
            <div className="grid grid-cols-4 gap-2">
              {[["calories", "kcal"], ["protein", "Protein"], ["carbs", "Carbs"], ["fat", "Fat"]].map(([k, l]) => (
                <Input key={k} type="text" inputMode="decimal" aria-label={l} placeholder={l} value={f[k]}
                  onChange={(e) => /^[0-9]*[.,]?[0-9]{0,1}$/.test(e.target.value) && setF((x) => ({ ...x, [k]: e.target.value.replace(",", ".") }))} />
              ))}
            </div>
          </fieldset>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm">
            <Checkbox checked={f.is_favorite} onCheckedChange={(c) => setF((x) => ({ ...x, is_favorite: c === true }))} />
            Favourite (shows first and in suggestions)
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="bg-emerald-700 text-white hover:bg-emerald-700">{product ? "Save changes" : "Add product"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
