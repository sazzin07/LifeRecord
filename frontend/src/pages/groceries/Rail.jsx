import { useEffect, useLayoutEffect, useRef } from "react";
import { BookMarked, Menu } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/* The page's sections as a vertical tab list down the left side. The highlight glides to the chosen section; like the old pill it is measured, not
   React state, so a re-render never makes it jump. Arrow keys (up, down, left, right), Home and End move between sections. */
function place(el) {
  const on = el && el.querySelector('[aria-selected="true"]');
  if (!on) return;
  el.style.setProperty("--y", `${on.offsetTop}px`);
  el.style.setProperty("--h", `${on.offsetHeight}px`);
  if (!el.dataset.ready) requestAnimationFrame(() => requestAnimationFrame(() => { el.dataset.ready = "1"; }));
}

export function RailTabs({ tabs, value, onChange, label, iconOnly = false }) {
  const ref = useRef(null);
  useLayoutEffect(() => { place(ref.current); });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => place(el));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const move = (e, i) => {
    const next = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length];
    onChange(t.id);
    requestAnimationFrame(() => document.getElementById(`gtab-${t.id}`)?.focus());
  };
  return (
    <div ref={ref} className="gt-vtabs" role="tablist" aria-orientation="vertical" aria-label={label}>
      {tabs.map((t, i) => (
        <button key={t.id} id={`gtab-${t.id}`} type="button" role="tab" className="gt-rail-b" aria-selected={value === t.id} aria-controls="gpanel"
          tabIndex={value === t.id ? 0 : -1} title={iconOnly ? t.label : undefined} onClick={() => onChange(t.id)} onKeyDown={(e) => move(e, i)}>
          <t.icon aria-hidden="true" /><span className="gt-rail-l">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/* Tablet and desktop: a rail beside the page that stays on screen, centred vertically, while the page scrolls. The three-bar button folds it to icons (and back); the choice is remembered by the page. */
export function Rail({ tabs, value, onChange, open, onToggle, onCatalog }) {
  return (
    <div className="gt-rail-slot" data-open={open || undefined} style={{ animation: "none" }}>
    <nav className="gt-rail" data-open={open || undefined} data-testid="gt-rail" aria-label="Groceries">
      <button type="button" className="gt-rail-b gt-rail-burger" aria-expanded={open} aria-controls="gt-rail-body" onClick={onToggle} data-testid="gt-rail-toggle"
        title={open ? undefined : "Show the section names"}>
        <Menu aria-hidden="true" /><span className="gt-rail-l">Menu</span>
      </button>
      <div id="gt-rail-body" className="gt-rail-body">
        <RailTabs tabs={tabs} value={value} onChange={onChange} label="Groceries sections" iconOnly={!open} />
        <hr className="gt-rail-sep" />
        <button type="button" className="gt-rail-b" onClick={onCatalog} aria-haspopup="dialog" title={open ? undefined : "Catalog"}>
          <BookMarked aria-hidden="true" /><span className="gt-rail-l">Catalog</span>
        </button>
      </div>
    </nav>
    </div>
  );
}

/* Phone: the same sections in a drawer that slides in from the left; choosing one closes it. The three-bar button that opens it lives in the page heading. */
export function RailDrawer({ open, onOpenChange, tabs, value, onChange, onCatalog }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="gt gt-drawer bottom-auto left-3 top-24 h-auto w-[min(80vw,300px)] rounded-[28px] border" aria-describedby={undefined} data-testid="gt-drawer"
        onCloseAutoFocus={(e) => { e.preventDefault(); document.querySelector('[data-testid="gt-drawer-open"]')?.focus(); }}>   {/* back to the three-bar button that opened it */}
        <SheetHeader className="gt-drawer-h"><SheetTitle>Groceries</SheetTitle></SheetHeader>
        <RailTabs tabs={tabs} value={value} onChange={(id) => { onChange(id); onOpenChange(false); }} label="Groceries sections" />
        <hr className="gt-rail-sep" />
        <button type="button" className="gt-rail-b" onClick={() => { onOpenChange(false); onCatalog(); }} aria-haspopup="dialog">
          <BookMarked aria-hidden="true" /><span className="gt-rail-l">Catalog</span>
        </button>
      </SheetContent>
    </Sheet>
  );
}
