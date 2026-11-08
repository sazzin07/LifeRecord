import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Receipt, ShoppingCart } from "lucide-react";
import { eur } from "@/lib/api";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Sticker } from "./todayParts";
import { AISLES, ShopRow, aisleName } from "./ShoppingTab";
import { CAT_META, catOf } from "./shared";

/* How many things are still to get on the current list (what the cart button counts). */
export const cartCount = (items, selectedIds) => items.filter((it) => !selectedIds.has(it.id)).length;

/* The cart: a panel with the current list by aisle, with the same rows, steppers and Done shopping as the Shopping tab. On a tablet or a wider
   screen its button is a round icon that stays on screen beside the app's quick-add "+" (it is put into the corner through the shell's
   #shell-fab-slot); on a phone the page heading holds the button, and this only draws the panel. The page owns `open`. */
export function CartDock({ items, listName, selectedIds, onToggle, onQty, onDelete, onSubmit, open, onOpenChange, showButton }) {
  const [slot, setSlot] = useState(null);
  useEffect(() => { setSlot(showButton ? document.getElementById("shell-fab-slot") : null); }, [showButton]);
  const setOpen = onOpenChange;
  const todo = items.filter((it) => !selectedIds.has(it.id)), done = items.filter((it) => selectedIds.has(it.id));
  const sum = (l) => l.reduce((s, it) => s + (Number(it.estimated_price) || 0) * (Number(it.quantity) || 0), 0);
  const groups = AISLES.map((a) => [a, todo.filter((it) => { const c = catOf({ category: it.category }); return (AISLES.includes(c) ? c : "Other") === a; })]).filter(([, l]) => l.length);
  return (
    <>
      {slot && createPortal(
        <button type="button" className="gt-cart-fab" onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="cart-fab" title={`Cart · ${eur(sum(items))}`}>
          <ShoppingCart aria-hidden="true" /><span className="sr-only">Cart{todo.length > 0 ? `, ${todo.length} to get` : ""}</span>
          {todo.length > 0 && <b aria-hidden="true">{todo.length}</b>}
        </button>, slot)}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="gt gt-cart" aria-describedby="gt-cart-d">
          <SheetHeader className="gt-cart-h">
            <SheetTitle>Your cart</SheetTitle>
            <SheetDescription id="gt-cart-d">{listName ? `${listName}: ` : ""}{todo.length} to get · {eur(sum(items))}{done.length ? ` · ${done.length} in the basket` : ""}</SheetDescription>
          </SheetHeader>
          <div className="gt-cart-body">
            {groups.length ? groups.map(([a, l]) => (
              <section key={a} className="gt-cart-a" style={{ "--lc": CAT_META[a]?.color }} aria-label={aisleName(a)}>
                <h3><span className="gt-dotc" aria-hidden="true" />{aisleName(a)}<span>{l.length}</span></h3>
                <ul className="gt-list">{l.map((it) => <ShopRow key={it.id} it={it} variant="cart" onToggle={onToggle} onQty={onQty} onDelete={onDelete} />)}</ul>
              </section>
            )) : (
              <div className="gt-cart-empty">
                <span className="gt-floats" aria-hidden="true"><span style={{ "--d": 0 }}><Sticker name="Whole milk" category="Dairy" size={52} /></span><span style={{ "--d": 1 }}><Sticker name="Apples" category="Fruit" size={52} /></span></span>
                <b>{done.length ? "Everything is in the basket" : "Your cart is empty"}</b>
                <span className="gt-note">{done.length ? "Press Done shopping below." : "Add something on the Shopping tab or from the catalog."}</span>
              </div>
            )}
            {done.length > 0 && (
              <section className="gt-cart-a" aria-label="In the basket">
                <h3><span className="gt-dotc" aria-hidden="true" style={{ "--lc": "var(--gt-green)" }} />In the basket<span>{done.length}</span></h3>
                <ul className="gt-list">{done.map((it) => <ShopRow key={it.id} it={it} variant="cart" done onToggle={onToggle} onDelete={onDelete} />)}</ul>
              </section>
            )}
          </div>
          <div className="gt-cart-f">
            {done.length > 0
              ? <button type="button" className="gt-btn cta lg" onClick={() => { setOpen(false); onSubmit(); }}><Receipt aria-hidden="true" />Done shopping</button>
              : <span className="gt-note">Tick things as you put them in the basket.</span>}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
