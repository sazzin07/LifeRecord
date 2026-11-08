import { useEffect, useMemo, useRef } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, Minus, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CAT_META, isLow, daysUntil, expiryLabel, quantityText } from "./shared";
import { adjustQuantity } from "./inventoryActions";

/**
 * Visual identity per storage kind. Each unit has three footprints that the same element animates between:
 *   wall - one of several doors on the kitchen wall
 *   hero - the unit you zoomed into (door open, items visible)
 *   mini - a small preview in the speed-dial rail beside the hero
 * Class strings are written out in full so Tailwind can see them.
 */
const KINDS = {
  fridge: {
    wall: "w-[calc(50%-0.75rem)] md:w-44", wallH: "h-60 md:h-80",
    hero: "w-64 md:w-72", heroH: "h-[26rem] md:h-[27rem]",
    mini: "w-14", miniH: "h-24",
    shelves: 4, hinge: "left", doors: 1,
    body: "from-slate-300 to-slate-400 dark:from-slate-600 dark:to-slate-700",
    door: "from-slate-200 via-slate-100 to-slate-300 dark:from-slate-500 dark:via-slate-400 dark:to-slate-600",
    inside: "from-emerald-50 to-white dark:from-emerald-950 dark:to-slate-800", glow: "rgba(167,243,208,0.55)",
  },
  freezer: {
    wall: "w-[calc(50%-0.75rem)] md:w-44", wallH: "h-44 md:h-52",
    hero: "w-64 md:w-72", heroH: "h-80 md:h-96",
    mini: "w-14", miniH: "h-16",
    shelves: 3, hinge: "right", doors: 1,
    body: "from-cyan-200 to-sky-300 dark:from-cyan-900 dark:to-sky-950",
    door: "from-sky-100 via-white to-cyan-100 dark:from-sky-800 dark:via-sky-700 dark:to-cyan-900",
    inside: "from-cyan-100 to-white dark:from-cyan-950 dark:to-slate-900", glow: "rgba(165,243,252,0.6)",
  },
  pantry: {
    wall: "w-[calc(50%-0.75rem)] md:w-52", wallH: "h-60 md:h-80",
    hero: "w-64 md:w-80", heroH: "h-[26rem] md:h-[27rem]",
    mini: "w-16", miniH: "h-24",
    shelves: 4, hinge: "split", doors: 2,
    body: "from-amber-700 to-amber-900 dark:from-amber-900 dark:to-stone-950",
    door: "from-amber-600 via-amber-500 to-amber-700 dark:from-amber-800 dark:via-amber-700 dark:to-amber-900",
    inside: "from-amber-100 to-orange-50 dark:from-stone-900 dark:to-amber-950", glow: "rgba(253,230,138,0.5)",
  },
  custom: {
    wall: "w-[calc(50%-0.75rem)] md:w-40", wallH: "h-44 md:h-52",
    hero: "w-64 md:w-72", heroH: "h-80 md:h-96",
    mini: "w-14", miniH: "h-16",
    shelves: 3, hinge: "left", doors: 1,
    body: "from-teal-600 to-teal-800 dark:from-teal-900 dark:to-slate-900",
    door: "from-teal-500 via-teal-400 to-teal-600 dark:from-teal-700 dark:via-teal-600 dark:to-teal-800",
    inside: "from-teal-50 to-white dark:from-teal-950 dark:to-slate-900", glow: "rgba(153,246,228,0.5)",
  },
};
const kindOf = (k) => KINDS[k] || KINDS.custom;

const needsAttention = (g) => isLow(g) || (daysUntil(g.expiration) ?? 99) <= 3;

/** Most urgent first: expired / expiring, then low stock, then everything else by name. */
function byUrgency(a, b) {
  const da = daysUntil(a.expiration) ?? 9999;
  const db = daysUntil(b.expiration) ?? 9999;
  if ((da <= 3) !== (db <= 3)) return da <= 3 ? -1 : 1;
  if (isLow(a) !== isLow(b)) return isLow(a) ? -1 : 1;
  return da - db || a.name.localeCompare(b.name);
}

const TONE = { red: "text-red-600 dark:text-red-400", amber: "text-amber-600 dark:text-amber-400", slate: "text-slate-500" };

/** A chip on a shelf in the zoomed unit: tap it to use or add one without leaving the preview. */
function ItemChip({ g, onEdit }) {
  const meta = CAT_META[g.category] || CAT_META.Other;
  const Icon = meta.icon;
  const exp = expiryLabel(g.expiration);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="shelf-item"
          aria-label={`${g.name}, ${quantityText(g.quantity, g.unit)}${exp ? `, ${exp.text}` : ""}. Quick actions`}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1 text-left shadow-sm bg-white/80 dark:bg-slate-900/60",
            "hover:bg-white dark:hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
            needsAttention(g) && "ring-1 ring-red-400/80",
          )}
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md" style={{ background: `${meta.color}2e` }}>
            <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} aria-hidden="true" />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100">{g.name}</span>
            <span className="block truncate text-[10px] text-slate-500 dark:text-slate-300">{quantityText(g.quantity, g.unit)}</span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" side="top">
        <div>
          <p className="font-semibold text-sm">{g.name}</p>
          <p className="text-xs text-slate-500">
            {g.category}{exp && <> · <span className={TONE[exp.tone]}>{exp.text}</span></>}{isLow(g) && <> · <span className={TONE.amber}>Low</span></>}
          </p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => adjustQuantity(g, -1)} disabled={Number(g.quantity) <= 0} aria-label={`Use one ${g.name}`}><Minus className="h-4 w-4" /></Button>
          <span className="text-sm font-semibold tabular-nums" aria-live="polite">{quantityText(g.quantity, g.unit)}</span>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => adjustQuantity(g, 1)} aria-label={`Add one ${g.name}`}><Plus className="h-4 w-4" /></Button>
        </div>
        <Button variant="ghost" size="sm" className="w-full" onClick={() => onEdit(g)}><Pencil className="h-3.5 w-3.5 mr-1.5" />Edit item</Button>
      </PopoverContent>
    </Popover>
  );
}

/** Wall/mini: tiny icon chips behind the door. Hero: named, tappable chips, most urgent first. */
function Shelves({ items, shelves, mode, onEdit, onMore }) {
  const hero = mode === "hero";
  const perShelf = hero ? 2 : 4;
  const sorted = useMemo(() => [...items].sort(byUrgency), [items]);
  const rows = useMemo(() => {
    const r = Array.from({ length: shelves }, () => []);
    sorted.slice(0, shelves * perShelf).forEach((g, i) => r[Math.floor(i / perShelf)].push(g));
    return r;
  }, [sorted, shelves, perShelf]);
  const hidden = Math.max(0, items.length - shelves * perShelf);
  return (
    <div className="absolute inset-[6%] flex flex-col justify-between">
      {rows.map((row, i) => (
        <div key={i} className="relative flex h-[21%] items-end gap-1 border-b-[3px] border-black/15 px-0.5 pb-0.5 dark:border-white/15">
          {row.map((g, j) => {
            if (hero) {
              return (
                <span key={g.id} className="flex min-w-0 flex-1 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none"
                  style={{ animationDelay: `${300 + (i * perShelf + j) * 45}ms`, animationFillMode: "backwards" }}>
                  <ItemChip g={g} onEdit={onEdit} />
                </span>
              );
            }
            const meta = CAT_META[g.category] || CAT_META.Other;
            const Icon = meta.icon;
            return (
              <span key={g.id} aria-hidden="true"
                className={cn("grid aspect-square h-[70%] place-items-center rounded-md shadow-sm", needsAttention(g) && "ring-2 ring-red-400/80")}
                style={{ background: `${meta.color}33` }}>
                <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} aria-hidden="true" />
              </span>
            );
          })}
        </div>
      ))}
      {hero && hidden > 0 && (
        <button type="button" onClick={onMore}
          className="absolute -bottom-1 right-1 rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-semibold text-white shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300">
          +{hidden} more
        </button>
      )}
    </div>
  );
}

function Door({ cfg, side, open, mode, name, count, alerts }) {
  const swing = side === "right" ? "rotateY(105deg)" : "rotateY(-105deg)";
  return (
    <div
      className={cn(
        "absolute bottom-0 top-0 rounded-[10px] border border-black/10 bg-gradient-to-br shadow-md dark:border-white/10",
        "transition-transform duration-700 [transition-timing-function:cubic-bezier(.3,.7,.2,1)] motion-reduce:transition-none",
        cfg.door,
        cfg.doors === 2 ? (side === "right" ? "right-0 w-1/2" : "left-0 w-1/2") : "inset-x-0",
      )}
      style={{ transformOrigin: side === "right" ? "right center" : "left center", transform: open ? swing : "none", backfaceVisibility: "hidden" }}
    >
      <span className={cn("absolute top-[18%] h-[28%] w-1.5 rounded-full bg-black/25 dark:bg-white/40", side === "right" ? "left-2" : "right-2")} />
      {mode === "wall" && (cfg.doors === 1 || side === "left") && (
        <span className={cn("absolute bottom-3 rounded-md bg-white/80 px-2 py-1 text-left shadow-sm dark:bg-slate-900/70", cfg.doors === 2 ? "left-2" : "left-3 right-6")}>
          <span className="block truncate text-xs font-semibold leading-tight text-slate-800 dark:text-slate-100">{name}</span>
          <span className="block text-[10px] text-slate-500 dark:text-slate-300">
            {count} item{count !== 1 ? "s" : ""}{alerts > 0 && <span className="font-semibold text-red-600 dark:text-red-400"> · {alerts} need attention</span>}
          </span>
        </span>
      )}
    </div>
  );
}

function Unit({ unit, mode, onSelect, onEdit, onMore }) {
  const { id, name, kind, items } = unit;
  const cfg = kindOf(kind);
  const hero = mode === "hero";
  const alerts = items.filter(needsAttention).length;
  const testid = `unit-${name.toLowerCase().replace(/\s+/g, "-")}`;
  const ref = useRef(null);
  // The button you pressed turns into the open unit, so hand focus to it without scrolling the page.
  useEffect(() => { if (hero) ref.current?.focus({ preventScroll: true }); }, [hero]);
  const frame = cn(
    "relative w-full rounded-xl bg-gradient-to-b p-[6px] text-left shadow-[0_14px_20px_-10px_rgba(15,23,42,0.45)]",
    "transition-[height,transform] duration-700 [transition-timing-function:cubic-bezier(.3,.7,.2,1)] motion-reduce:transition-none",
    mode === "wall" ? cfg.wallH : hero ? cfg.heroH : cfg.miniH,
    cfg.body,
  );
  const inner = (
    <>
      <div className={cn("absolute inset-[6px] overflow-hidden rounded-lg bg-gradient-to-b", cfg.inside)}>
        <div className={cn("absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none", hero ? "opacity-100" : "opacity-0")}
          style={{ background: `radial-gradient(ellipse at 50% 0%, ${cfg.glow}, transparent 70%)` }} />
        {mode !== "mini" && <Shelves items={items} shelves={cfg.shelves} mode={mode} onEdit={onEdit} onMore={onMore} />}
        {hero && items.length === 0 && <span className="absolute inset-0 grid place-items-center text-xs text-slate-500 dark:text-slate-300">Nothing in here yet</span>}
      </div>
      <div className="pointer-events-none absolute inset-[6px]" style={{ transformStyle: "preserve-3d" }}>
        {cfg.doors === 2 ? (
          <>
            <Door cfg={cfg} side="left" open={hero} mode={mode} name={name} count={items.length} alerts={alerts} />
            <Door cfg={cfg} side="right" open={hero} mode={mode} name={name} count={items.length} alerts={alerts} />
          </>
        ) : (
          <Door cfg={cfg} side={cfg.hinge} open={hero} mode={mode} name={name} count={items.length} alerts={alerts} />
        )}
      </div>
    </>
  );
  // One element for every mode: swapping div <-> button would remount the unit, which restarts its
  // transitions and briefly collapses the page height (the scroll position then jumps to the top).
  return (
    <div
      ref={ref}
      tabIndex={hero ? -1 : undefined}
      className={cn(frame, !hero && "hover:-translate-y-0.5", "outline-none")}
      style={{ perspective: "1100px" }}
      data-testid={testid}
      data-mode={mode}
      role={hero ? "group" : undefined}
      aria-label={hero ? `Inside ${name}` : undefined}
    >
      {inner}
      {!hero && (
        <button
          type="button"
          onClick={() => onSelect(id)}
          aria-label={mode === "wall"
            ? `Open ${name}, ${items.length} item${items.length !== 1 ? "s" : ""}${alerts ? `, ${alerts} need attention` : ""}`
            : `Switch to ${name}, ${items.length} item${items.length !== 1 ? "s" : ""}`}
          className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-2 ring-offset-background"
        />
      )}
    </div>
  );
}

/**
 * The kitchen wall. With nothing selected every storage space stands on the counter line; selecting one
 * zooms in on it (the others shrink into a speed-dial rail) and opens its door to show what is inside.
 */
export function KitchenScene({ units, selectedId, onSelect, onBack, detailsOpen, onToggleDetails, onEditItem, onAddItem }) {
  const selected = units.find((u) => u.id === selectedId) || null;
  const alerts = selected ? selected.items.filter(needsAttention).length : 0;
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border bg-gradient-to-b from-stone-100 to-stone-200 px-4 pb-0 pt-6 dark:from-slate-900 dark:to-slate-950 md:px-8"
      role="group" aria-label="Kitchen storage">
      <div aria-hidden="true" className="absolute inset-0 opacity-[0.07] dark:opacity-[0.12]"
        style={{ backgroundImage: "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)", backgroundSize: "36px 36px" }} />
      <div aria-hidden="true" className="absolute -top-10 right-10 h-40 w-64 rotate-12 rounded-full bg-amber-200/40 blur-3xl dark:bg-sky-300/10" />
      <div className="relative flex flex-wrap items-end justify-center gap-x-4 gap-y-6 pb-5 md:gap-x-6">
        {units.map((u) => {
          const mode = !selected ? "wall" : u.id === selected.id ? "hero" : "mini";
          const cfg = kindOf(u.kind);
          const a = u.items.filter(needsAttention).length;
          return (
            <div key={u.id}
              className={cn(
                "flex flex-col items-center gap-2 transition-[width] duration-700 [transition-timing-function:cubic-bezier(.3,.7,.2,1)] motion-reduce:transition-none",
                cfg[mode], mode === "hero" && selected && "order-first",
              )}>
              <Unit unit={u} mode={mode} onSelect={onSelect} onEdit={onEditItem} onMore={onToggleDetails} />
              {mode === "mini" && (
                <span className="max-w-full text-center text-[11px] leading-tight text-slate-600 dark:text-slate-300">
                  <span className="block truncate font-medium">{u.name}</span>
                  <span className={cn("block", a > 0 && "font-semibold text-red-600 dark:text-red-400")}>{u.items.length}{a > 0 ? ` · ${a}!` : ""}</span>
                </span>
              )}
              {mode === "hero" && (
                <div className="flex w-full flex-col items-center gap-2 animate-in fade-in motion-reduce:animate-none" style={{ animationDelay: "400ms", animationFillMode: "backwards" }}>
                  <div className="flex items-center gap-3">
                    <p className="text-center text-sm font-semibold leading-tight">
                      {u.name}
                      <span className="block text-xs font-normal text-slate-500">
                        {u.items.length} item{u.items.length !== 1 ? "s" : ""}{alerts > 0 && <span className="font-semibold text-red-600 dark:text-red-400"> · {alerts} need attention</span>}
                      </span>
                    </p>
                    <Button size="icon" variant="outline" className="h-8 w-8 bg-background/80" onClick={onAddItem} aria-label={`Add item to ${u.name}`}><Plus className="h-4 w-4" /></Button>
                  </div>
                  <div className="flex w-full gap-2">
                    <Button variant="outline" size="sm" className="flex-1 bg-background/80" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4" />All spaces</Button>
                    <Button size="sm" className="flex-1 bg-emerald-700 text-white hover:bg-emerald-700" onClick={onToggleDetails} aria-expanded={detailsOpen}>
                      {detailsOpen ? <>Hide details<ChevronUp className="ml-1 h-4 w-4" /></> : <>More details<ChevronDown className="ml-1 h-4 w-4" /></>}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div aria-hidden="true" className="relative -mx-4 h-5 border-t border-black/10 bg-gradient-to-b from-stone-400 to-stone-500 dark:from-slate-700 dark:to-slate-800 md:-mx-8" />
    </div>
  );
}
