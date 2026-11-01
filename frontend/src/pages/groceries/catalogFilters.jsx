import { useState } from "react";
import { Bookmark, ChevronLeft, ChevronRight, Pin, PinOff, SlidersHorizontal, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { CATS, DIET_TAGS, NUTRI_FILTERS } from "./shared";

export const EMPTY_FILTERS = { cat: "all", sub: "all", diet: [], nutri: [], stock: "any", fav: false };

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
export const filtersEqual = (a, b) => a.cat === b.cat && a.sub === b.sub && a.stock === b.stock && a.fav === b.fav
  && sameSet(a.diet, b.diet) && sameSet(a.nutri, b.nutri);

/** The filters that are switched on, in the order they are shown, each with how to switch it off. */
export function activeFilterList(f) {
  const out = [];
  if (f.cat !== "all") out.push({ key: "cat", label: f.cat, clear: { cat: "all", sub: "all" } });
  if (f.cat !== "all" && f.sub !== "all") out.push({ key: "sub", label: f.sub, clear: { sub: "all" } });
  f.diet.forEach((t) => out.push({ key: `diet:${t}`, label: DIET_TAGS.find((d) => d.key === t)?.label || t, clear: { diet: f.diet.filter((x) => x !== t) } }));
  f.nutri.forEach((k) => out.push({ key: `nutri:${k}`, label: NUTRI_FILTERS.find((n) => n.key === k)?.label || k, clear: { nutri: f.nutri.filter((x) => x !== k) } }));
  if (f.stock !== "any") out.push({ key: "stock", label: f.stock === "in" ? "In my kitchen" : "Not in my kitchen", clear: { stock: "any" } });
  if (f.fav) out.push({ key: "fav", label: "Favourites", clear: { fav: false } });
  return out;
}

const PRESETS_KEY = "lr.catalog.presets";
const DEFAULT_PRESETS = [
  { id: "vegan", name: "Vegan", pinned: true, filters: { ...EMPTY_FILTERS, diet: ["vegan"] } },
  { id: "high-protein", name: "High protein", pinned: true, filters: { ...EMPTY_FILTERS, nutri: ["high-protein"] } },
  { id: "restock", name: "Not in my kitchen", pinned: true, filters: { ...EMPTY_FILTERS, stock: "out" } },
];

function loadPresets() {
  try {
    const saved = JSON.parse(localStorage.getItem(PRESETS_KEY) || "null");
    if (Array.isArray(saved)) return saved;
  } catch { /* unreadable or unavailable: start from the defaults */ }
  return DEFAULT_PRESETS;
}

/** Saved filter combinations. Kept in this browser; pinned ones sit next to the Filters button. */
export function usePresets() {
  const [presets, setPresets] = useState(loadPresets);
  const persist = (next) => {
    setPresets(next);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  };
  return {
    presets,
    add: (name, filters) => persist([...presets, { id: `p${Date.now().toString(36)}`, name, pinned: true, filters }]),
    remove: (id) => persist(presets.filter((p) => p.id !== id)),
    togglePin: (id) => persist(presets.map((p) => (p.id === id ? { ...p, pinned: !p.pinned } : p))),
  };
}

export function Chip({ active, onClick, children, tone = "emerald", small = false, className, ...rest }) {
  const on = tone === "amber"
    ? "border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
    : "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300";
  return (
    <button type="button" onClick={onClick} aria-pressed={active} {...rest}
      className={cn("shrink-0 whitespace-nowrap rounded-full border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        small ? "px-3 py-1 text-[13px]" : "px-3.5 py-1.5 text-sm",
        active ? on : "border-border text-muted-foreground hover:bg-accent/50", className)}>
      {children}
    </button>
  );
}

function Section({ title, children }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

export function FiltersPopover({ filters, setFilters, counts, subCounts, presets, onApplyPreset, onRemovePreset, onTogglePin }) {
  const n = activeFilterList(filters).length;
  const toggleIn = (key, value) => setFilters({ [key]: filters[key].includes(value) ? filters[key].filter((x) => x !== value) : [...filters[key], value] });
  const subs = Object.keys(subCounts).sort();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="shrink-0 gap-2" aria-label={n ? `Filters, ${n} on` : "Filters"}>
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Filters
          {n > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-emerald-700 px-1 text-[11px] font-semibold text-white">{n}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="max-h-[75vh] w-[min(94vw,30rem)] space-y-4 overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Filters</h3>
          {n > 0 && <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setFilters(EMPTY_FILTERS)}>Clear all</Button>}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Saved filters</p>
          {presets.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet. Turn on some filters, then choose Save filters under the search box.</p>
          ) : (
            <ul className="space-y-0.5">
              {presets.map((p) => (
                <li key={p.id} className="flex items-center gap-1 rounded-lg hover:bg-accent/40">
                  <button type="button" onClick={() => onApplyPreset(p)} className="min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {p.name}
                  </button>
                  <button type="button" onClick={() => onTogglePin(p.id)} aria-pressed={p.pinned}
                    aria-label={p.pinned ? `Remove ${p.name} from quick access` : `Add ${p.name} to quick access`}
                    title={p.pinned ? "Shown next to Filters" : "Show next to Filters"}
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {p.pinned ? <Pin className="h-4 w-4 fill-current text-emerald-600" /> : <PinOff className="h-4 w-4" />}
                  </button>
                  <button type="button" onClick={() => onRemovePreset(p)} aria-label={`Delete saved filter ${p.name}`}
                    className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Section title="Category">
          {["all", ...CATS.filter((c) => counts[c] || c === filters.cat)].map((c) => (
            <Chip key={c} small active={filters.cat === c} onClick={() => setFilters({ cat: c, sub: "all" })}>
              {c === "all" ? `All ${Object.values(counts).reduce((a, b) => a + b, 0)}` : `${c} ${counts[c] || 0}`}
            </Chip>
          ))}
        </Section>
        {filters.cat !== "all" && subs.length > 1 && (
          <Section title={`Type of ${filters.cat.toLowerCase()}`}>
            {["all", ...subs].map((s) => (
              <Chip key={s} small active={filters.sub === s} onClick={() => setFilters({ sub: s })}>
                {s === "all" ? "Any kind" : `${s} ${subCounts[s]}`}
              </Chip>
            ))}
          </Section>
        )}
        <Section title="Diet">
          {DIET_TAGS.map((d) => <Chip key={d.key} small active={filters.diet.includes(d.key)} onClick={() => toggleIn("diet", d.key)}>{d.label}</Chip>)}
        </Section>
        <Section title="Nutrition per 100 g">
          {NUTRI_FILTERS.map((f) => <Chip key={f.key} small tone="amber" active={filters.nutri.includes(f.key)} onClick={() => toggleIn("nutri", f.key)}>{f.label}</Chip>)}
        </Section>
        <Section title="Your kitchen">
          <Chip small active={filters.stock === "in"} onClick={() => setFilters({ stock: filters.stock === "in" ? "any" : "in" })}>In my kitchen</Chip>
          <Chip small active={filters.stock === "out"} onClick={() => setFilters({ stock: filters.stock === "out" ? "any" : "out" })}>Not in my kitchen</Chip>
          <Chip small tone="amber" active={filters.fav} onClick={() => setFilters({ fav: !filters.fav })}>
            <span className="inline-flex items-center gap-1.5"><Star className={cn("h-3.5 w-3.5", filters.fav && "fill-current")} aria-hidden="true" />Favourites</span>
          </Chip>
        </Section>
      </PopoverContent>
    </Popover>
  );
}

/** Only the filters that are on, each removable, with a way to save the combination. */
export function ActiveFilters({ filters, onClearOne, onClearAll, onSavePreset }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const list = activeFilterList(filters);
  if (!list.length) return null;
  const save = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSavePreset(name.trim());
    setName("");
    setOpen(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Active filters">
      {list.map((a) => (
        <button key={a.key} type="button" onClick={() => onClearOne(a.clear)} aria-label={`Remove ${a.label} filter`}
          className="inline-flex items-center gap-1 rounded-full bg-emerald-50 py-1 pl-3 pr-2 text-[13px] font-medium text-emerald-700 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25">
          {a.label}<X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ))}
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onClearAll} aria-label="Clear all filters">Clear all</Button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs"><Bookmark className="h-3.5 w-3.5" aria-hidden="true" />Save filters</Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3">
          <form onSubmit={save} className="space-y-2">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Name this combination</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Vegetarian snacks" aria-label="Saved filter name" autoFocus />
            </label>
            <Button type="submit" size="sm" disabled={!name.trim()} className="w-full bg-emerald-700 text-white hover:bg-emerald-700">Save and pin</Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function Pager({ page, pages, total, size, onPage, className }) {
  if (total === 0) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  return (
    <nav className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)} aria-label="Catalog pages">
      <span className="tabular-nums" aria-live="polite">{from}–{to} of {total}</span>
      <Button variant="outline" size="icon" className="h-8 w-8" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
      <span className="tabular-nums">Page {page} of {pages}</span>
      <Button variant="outline" size="icon" className="h-8 w-8" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
    </nav>
  );
}
