import { useMemo, useState } from "react";
import { AlertTriangle, ChefHat, Clock, History, Loader2, Pencil, Plus, Receipt, Repeat, RotateCcw, Search, ShoppingCart, SlidersHorizontal, Sparkles, Store, Trash2, X } from "lucide-react";
import { eur } from "@/lib/api";
import { ConfidenceBadge } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { BudgetField } from "./BudgetField";
import { Pill } from "./pills";
import { CAT_META, CATS, catOf, isLow, quantityText } from "./shared";
import { stepFor } from "./inventoryActions";
import { Sticker, cap1, plural } from "./todayParts";

/* The Shopping tab: a trip card (what the list costs against its budget, how much is in the basket), then either Plan (the list itself,
   shelves of things worth adding, recurring lists) or In the shop (the list by aisle, big rows to tick, the basket and Done shopping).
   Every action calls back into the page, which owns the data and the dialogs. */
export const AISLES = ["Fruit", "Vegetables", "Dairy", "Eggs", "Meat", "Fish", "Carbohydrates", "Pantry", "Drinks", "Frozen", "Snacks", "Other"];
export const aisleName = (a) => (a === "Carbohydrates" ? "Bread and grains" : a);
const PRICE_CONF = { known: { type: "exact", label: "Known price" }, estimated: { type: "estimated", label: "Estimated" }, unknown: { type: "unknown", label: "Unknown" } };
const aisleOf = (it) => { const c = catOf({ category: it.category }); return AISLES.includes(c) ? c : "Other"; };
const total = (items) => items.reduce((s, it) => s + (Number(it.estimated_price) || 0) * (Number(it.quantity) || 0), 0);

/** One list item. plan: everything you can do to it; store: big, tap to tick; cart: compact, with a stepper. */
export function ShopRow({ it, variant = "plan", done, onToggle, onQty, onEdit, onDelete, onHistory }) {
  const conf = it.known ? PRICE_CONF.known : it.estimated_price ? PRICE_CONF.estimated : PRICE_CONF.unknown;
  const qty = Number(it.quantity) || 0, step = stepFor(it.unit);
  const store = variant === "store";
  return (
    <li className={cn("gt-srow", variant, done && "is-done")} data-testid="shop-row" onClick={store ? (e) => { if (e.target.tagName !== "INPUT") onToggle(it.id); } : undefined}>
      {store
        ? <input type="checkbox" className="gt-check" checked={!!done} onChange={() => onToggle(it.id)} aria-label={`${it.name} in the basket`} />
        : <label className="gt-tick"><input type="checkbox" className="gt-check" checked={!!done} onChange={() => onToggle(it.id)} aria-label={`${it.name} in the basket`} /></label>}
      <Sticker name={it.name} category={catOf({ category: it.category })} size={store ? 56 : variant === "cart" ? 34 : 40} />
      <span className="grow">
        <span className="name">{it.name}{variant === "plan" && conf.type !== "estimated" && <ConfidenceBadge type={conf.type}>{conf.label}</ConfidenceBadge>}</span>
        <span className="gt-note">
          {quantityText(it.quantity, it.unit)}
          {variant === "plan" && it.best ? <> · <Store className="gt-inl" aria-hidden="true" />{it.best.store} {eur(it.best.price)}</> : null}
          {variant === "plan" && it.note ? <> · {it.note}</> : null}
        </span>
      </span>
      {!store && onQty && (
        <span className="gt-qs" role="group" aria-label={`Quantity of ${it.name}`}>
          <button type="button" className="gt-btn icon quiet" onClick={() => onQty(it, -1)} disabled={qty <= step} aria-label={`Less ${it.name}`}>−</button>
          <b>{Number.isInteger(qty) ? qty : +qty.toFixed(2)}</b>
          <button type="button" className="gt-btn icon quiet" onClick={() => onQty(it, 1)} aria-label={`More ${it.name}`}>+</button>
        </span>
      )}
      <span className="gt-price">{it.estimated_price ? eur((Number(it.estimated_price) || 0) * qty) : "—"}{variant === "plan" && it.estimated_price ? <small>{eur(it.estimated_price)} / {it.unit || "unit"}</small> : null}</span>
      {variant === "plan" && (
        <span className="gt-acts">
          <button type="button" className="gt-btn icon quiet" onClick={() => onHistory(it)} aria-label="Price history"><History aria-hidden="true" /></button>
          <button type="button" className="gt-btn icon quiet" onClick={() => onEdit(it)} aria-label={`Edit ${it.name}`}><Pencil aria-hidden="true" /></button>
          <button type="button" className="gt-btn icon quiet bad" onClick={() => onDelete(it.id)} aria-label={`Delete ${it.name}`}><Trash2 aria-hidden="true" /></button>
        </span>
      )}
      {variant === "cart" && <button type="button" className="gt-btn icon quiet bad" onClick={() => onDelete(it.id)} aria-label={`Remove ${it.name} from the list`}><X aria-hidden="true" /></button>}
    </li>
  );
}

function Ring({ summary }) {
  const budget = summary?.budget ?? null, est = Number(summary?.estimated_total) || 0;
  const pct = budget > 0 ? Math.min(1, est / budget) : 0, over = budget > 0 && est > budget, warn = budget > 0 && est / budget > 0.8, C = 339.3;
  return (
    <div className={cn("gt-tring", over ? "over" : warn ? "warn" : "ok")}>
      <svg viewBox="0 0 128 128" role="img" aria-label={budget > 0 ? `${eur(est)} of a ${eur(budget)} budget` : `${eur(est)} estimated, no budget set`}>
        <circle className="gt-tring-track" cx="64" cy="64" r="54" />
        <circle className="gt-tring-arc" cx="64" cy="64" r="54" style={{ strokeDasharray: C, strokeDashoffset: (C * (1 - pct)).toFixed(1) }} />
      </svg>
      <div className="gt-tring-mid"><span>{eur(est)}</span></div>
    </div>
  );
}

function Shelf({ title, Icon, list, onPick }) {
  if (!list.length) return null;
  return (
    <section className="gt-card gt-shelf" aria-label={title}>
      <h3><Icon aria-hidden="true" />{title}</h3>
      <div className="gt-sugs">
        {list.slice(0, 6).map((s) => (
          <button key={s.key} type="button" className="gt-sug" onClick={() => onPick(s)}>
            <Sticker name={s.name} category={s.category} size={34} />
            <span className="gt-sug-t"><b>{s.name}</b><small>{s.why}</small></span>
            <span className="gt-sug-add" aria-hidden="true"><Plus /></span>
            <span className="sr-only">Add {s.name} to the list</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function ShoppingTab({
  shopping, items, selectedListId, setSelectedListId, currentList, selectedIds, inventory, lowStock, suggestions, recipeIdeas, recurring, loading,
  generating, onToggle, onQty, onNewList, onDeleteList, onBudget, onGenerate, onAddItem, onEditItem, onDeleteItem, onHistory, onSuggest,
  onSpawn, onEditRecurring, onDeleteRecurring, onBulkDelete, onSubmit, onSelectAll, onDeselectAll,
}) {
  const [mode, setMode] = useState("plan");
  const [basketOpen, setBasketOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const lists = shopping?.lists || [];
  const summary = shopping?.budget_summary;

  const rows = useMemo(() => {
    let r = [...items];
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((it) => it.name.toLowerCase().includes(q) || (it.category || "").toLowerCase().includes(q));
    if (cat !== "all") r = r.filter((it) => it.category === cat);
    return r.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
  }, [items, search, cat]);
  const todo = items.filter((it) => !selectedIds.has(it.id)), done = items.filter((it) => selectedIds.has(it.id));
  const onList = useMemo(() => new Set(items.map((it) => it.name.toLowerCase())), [items]);
  const allSelected = rows.length > 0 && rows.every((it) => selectedIds.has(it.id));
  const bTotal = total(done);

  // Things worth adding: what is running low, what a recipe is missing, what is usually bought.
  const shelves = useMemo(() => {
    const seen = new Set(), keep = (s) => { const k = s.name.toLowerCase(); if (seen.has(k) || onList.has(k)) return false; seen.add(k); return true; };
    const low = (lowStock || []).map((g) => ({ key: `l${g.id}`, name: g.name, category: catOf(g), unit: g.unit, default_quantity: 1, price: g.price, why: `${quantityText(g.quantity, g.unit)} left` })).filter(keep);
    const inv = (inventory || []).filter((g) => isLow(g)).map((g) => ({ key: `i${g.id}`, name: g.name, category: catOf(g), unit: g.unit, default_quantity: 1, price: g.price, why: `${quantityText(g.quantity, g.unit)} left` })).filter(keep);
    const cook = [];
    (recipeIdeas || []).forEach((e) => { if (e.can_cook_now || !e.missing?.length || e.missing.length > 2) return; e.missing.forEach((m) => { const s = { key: `c${e.recipe.id}${m.name}`, name: cap1(m.name), category: "", unit: m.unit, default_quantity: m.quantity || 1, why: `for ${e.recipe.name}` }; if (keep(s)) cook.push(s); }); });
    const past = (suggestions || []).map((s) => ({ key: `p${s.id}`, name: s.name, category: s.category || "", unit: s.unit, default_quantity: s.default_quantity || 1, price: s.price, why: s.reason })).filter(keep);
    return { low: [...low, ...inv], cook, past };
  }, [lowStock, inventory, recipeIdeas, suggestions, onList]);
  const anyShelf = shelves.low.length + shelves.cook.length + shelves.past.length > 0;

  const lanes = AISLES.map((a) => [a, rows.filter((it) => aisleOf(it) === a)]).filter(([, l]) => l.length);
  const goAisle = (a) => { const t = document.getElementById(`aisle-${a}`); if (t) t.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); };
  const budget = summary?.budget ?? null, remaining = summary?.remaining ?? 0;

  return (
    <div className="gt gt-shop" data-mode={mode}>
      <section className="gt-card gt-trip" aria-label="Your shopping trip">
        <Ring summary={summary} />
        <div className="gt-trip-main">
          <h2>Your shopping trip</h2>
          <p className="gt-trip-sub">
            {plural(todo.length, "item", "items")} to get{done.length > 0 && <> · {done.length} in the basket</>}
            {budget > 0 && <> · <b className={cn("gt-left", remaining < 0 && "over")}>{remaining < 0 ? `${eur(Math.abs(remaining))} over` : `${eur(remaining)} left`}</b></>}
          </p>
          <div className="gt-bar" role="progressbar" aria-valuenow={done.length} aria-valuemin={0} aria-valuemax={items.length} aria-valuetext={`${done.length} of ${items.length} in the basket`} aria-label="Items in the basket"><span style={{ width: `${items.length ? (done.length / items.length) * 100 : 0}%` }} /></div>
          <Pill className="gt-mode" role="group" aria-label="Mode">
            <button type="button" className="gt-pill-b" aria-pressed={mode === "plan"} onClick={() => setMode("plan")}><SlidersHorizontal aria-hidden="true" />Plan</button>
            <button type="button" className="gt-pill-b" aria-pressed={mode === "store"} onClick={() => setMode("store")}><ShoppingCart aria-hidden="true" />In the shop</button>
          </Pill>
        </div>
        {currentList && <div className="gt-trip-aside"><p className="gt-eyebrow">List budget</p><BudgetField summary={summary} listId={selectedListId} onCommit={onBudget} /></div>}
      </section>

      <div className="gt-listbar">
        <Pill role="group" aria-label="Lists">
          {lists.map((l) => <button key={l.id} type="button" className="gt-pill-b" aria-pressed={selectedListId === l.id} onClick={() => setSelectedListId(l.id)}>{l.name}</button>)}
        </Pill>
        <button type="button" className="gt-btn" onClick={onNewList} aria-label="New list"><Plus aria-hidden="true" />New list</button>
        {currentList && <button type="button" className="gt-btn icon quiet bad" onClick={() => onDeleteList(currentList.id)} aria-label={`Delete list ${currentList.name}`}><Trash2 aria-hidden="true" /></button>}
      </div>

      {mode === "plan" ? (
        <>
          <div className="gt-shopbar">
            <div className="gt-search">
              <Search aria-hidden="true" />
              <Input placeholder="Search list..." aria-label="Search the list" value={search} onChange={(e) => setSearch(e.target.value)} />
              {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><X aria-hidden="true" /></button>}
            </div>
            <Select value={cat} onValueChange={setCat}>
              <SelectTrigger className="w-36" aria-label="Filter by category"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All</SelectItem>{CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
            <button type="button" className="gt-btn" onClick={onGenerate} disabled={generating || !selectedListId}>
              {generating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}Generate
            </button>
            <button type="button" className="gt-btn cta" onClick={onAddItem} disabled={!selectedListId}><Plus aria-hidden="true" />Add item</button>
          </div>

          {rows.length > 0 && (
            <div className="gt-bulk">
              <label><input type="checkbox" className="gt-check" checked={allSelected} onChange={() => (allSelected ? onDeselectAll() : onSelectAll(rows))} />{allSelected ? "Deselect all" : "Select all"}</label>
              <span className="gt-note">{selectedIds.size} selected</span>
              {selectedIds.size > 0 && (
                <span className="gt-bulk-r">
                  <button type="button" className="gt-btn" onClick={onBulkDelete}><Trash2 aria-hidden="true" />Delete</button>
                  <button type="button" className="gt-btn cta" onClick={onSubmit}><Receipt aria-hidden="true" />Submit {selectedIds.size}</button>
                </span>
              )}
            </div>
          )}

          {rows.length === 0 && !loading ? (
            <section className="gt-card gt-shop-empty">
              <div className="gt-floats" aria-hidden="true">{[["Whole milk", "Dairy"], ["Sourdough loaf", "Carbohydrates"], ["Apples", "Fruit"]].map(([n, c], i) => <span key={n} style={{ "--d": i }}><Sticker name={n} category={c} size={56} /></span>)}</div>
              <h3>{currentList ? (items.length ? "No matches" : "Your list is empty") : "No list yet"}</h3>
              <p className="gt-note">{currentList ? (items.length ? "Try a different search or category." : "Add items, generate from inventory, or pick from the shelves below.") : "Create a list to get started."}</p>
              <div className="gt-cta">
                {currentList ? (<><button type="button" className="gt-btn" onClick={onGenerate} disabled={generating}>{generating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}Generate</button>
                  <button type="button" className="gt-btn cta" onClick={onAddItem}><Plus aria-hidden="true" />Add item</button></>)
                  : <button type="button" className="gt-btn cta" onClick={onNewList}><Plus aria-hidden="true" />Create list</button>}
              </div>
            </section>
          ) : (
            <section className="gt-card gt-slist" aria-label="Shopping list">
              {rows.some((it) => !it.known && it.estimated_price) && <p className="gt-note gt-est">Prices are estimates until you buy them; a badge marks the ones that are known or missing.</p>}
              <ul className="gt-list">
                {rows.map((it) => <ShopRow key={it.id} it={it} done={selectedIds.has(it.id)} onToggle={onToggle} onQty={onQty} onEdit={onEditItem} onDelete={onDeleteItem} onHistory={onHistory} />)}
              </ul>
            </section>
          )}

          {shopping?.recommendation && (
            <section className="gt-card gt-reco"><Sparkles aria-hidden="true" /><p>{shopping.recommendation}</p></section>
          )}

          <div className="gt-shelves">
            <Shelf title="Running low" Icon={AlertTriangle} list={shelves.low} onPick={onSuggest} />
            <Shelf title="For your recipes" Icon={ChefHat} list={shelves.cook} onPick={onSuggest} />
            <Shelf title="Bought before" Icon={Clock} list={shelves.past} onPick={onSuggest} />
            {!anyShelf && <section className="gt-card gt-shelf"><h3>You are covered</h3><p className="gt-note">Nothing is running low and every recipe idea is in stock.</p></section>}
            <section className="gt-card gt-shelf" aria-label="Recurring lists">
              <h3><Repeat aria-hidden="true" />Recurring</h3>
              <ul className="gt-list">
                {recurring.map((rl) => (
                  <li key={rl.id} className="gt-rec">
                    <span className="name">{rl.name}</span>
                    <button type="button" className="gt-btn icon quiet" onClick={() => onSpawn(rl.id)} aria-label="Spawn now"><RotateCcw aria-hidden="true" /></button>
                    <button type="button" className="gt-btn icon quiet" onClick={() => onEditRecurring(rl)} aria-label={`Edit ${rl.name}`}><Pencil aria-hidden="true" /></button>
                    <button type="button" className="gt-btn icon quiet bad" onClick={() => onDeleteRecurring(rl.id)} aria-label={`Delete ${rl.name}`}><Trash2 aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
              {!recurring.length && <p className="gt-note">No recurring templates.</p>}
              <button type="button" className="gt-btn" onClick={() => onEditRecurring(null)} aria-label="New recurring list"><Plus aria-hidden="true" />New recurring list</button>
            </section>
          </div>
        </>
      ) : (
        <>
          {lanes.length > 0 && (
            <nav className="gt-route" aria-label="Aisles on this trip">
              {lanes.map(([a, l]) => {
                const left = l.filter((it) => !selectedIds.has(it.id)).length;
                return (
                  <button key={a} type="button" className={cn("gt-rchip", !left && "is-done")} style={{ "--lc": CAT_META[a]?.color }} onClick={() => goAisle(a)}>
                    <span className="gt-dotc" aria-hidden="true" />{aisleName(a)}<b>{left || "✓"}</b>{!left && <span className="sr-only">, finished</span>}
                  </button>
                );
              })}
            </nav>
          )}
          <div className="gt-lanes">
            {lanes.length > 0 && <div className="gt-card gt-lane-all">{lanes.map(([a, l]) => (
              <section key={a} id={`aisle-${a}`} className="gt-lane" style={{ "--lc": CAT_META[a]?.color }} aria-label={aisleName(a)}>
                <header><span className="gt-dotc" aria-hidden="true" /><h3>{aisleName(a)}</h3><span className="gt-note">{l.filter((it) => !selectedIds.has(it.id)).length} to get</span></header>
                <ul className="gt-list">
                  {l.map((it) => <ShopRow key={it.id} it={it} variant="store" done={selectedIds.has(it.id)} onToggle={onToggle} />)}
                </ul>
              </section>
            ))}</div>}
            {!items.length && (
              <section className="gt-card gt-shop-empty">
                <h3>Nothing to find yet</h3><p className="gt-note">Switch to Plan to fill your list first.</p>
                <button type="button" className="gt-btn cta" onClick={() => setMode("plan")}><SlidersHorizontal aria-hidden="true" />Go to Plan</button>
              </section>
            )}
            {items.length > 0 && !todo.length && <section className="gt-card gt-shop-empty"><h3>Everything is in the basket</h3><p className="gt-note">Press Done shopping and it all goes to your kitchen.</p></section>}
          </div>
          {done.length > 0 && (
            <aside className="gt-basket" aria-label="In the basket">
              <div className={cn("gt-basket-sheet", basketOpen && "open")}><div><ul className="gt-list">
                {done.map((it) => <ShopRow key={it.id} it={it} variant="cart" done onToggle={onToggle} onDelete={onDeleteItem} />)}
              </ul></div></div>
              <div className="gt-basket-bar">
                <button type="button" className="gt-basket-main" aria-expanded={basketOpen} onClick={() => setBasketOpen((v) => !v)}>
                  <span className="gt-basket-stack">{done.slice(-5).map((it) => <Sticker key={it.id} name={it.name} category={catOf({ category: it.category })} size={38} />)}</span>
                  <span className="gt-bk-t"><b>{done.length} in the basket</b><small>{eur(bTotal)}</small></span>
                </button>
                <button type="button" className="gt-btn cta lg" onClick={onSubmit}><Receipt aria-hidden="true" />Done shopping</button>
              </div>
            </aside>
          )}
        </>
      )}
    </div>
  );
}
