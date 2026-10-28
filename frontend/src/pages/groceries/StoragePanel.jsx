import { useEffect, useMemo, useState } from "react";
import { Plus, Minus, Search, X, Pencil, Trash2, FolderInput, Settings2, Utensils } from "lucide-react";
import { Card, EmptyState } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { CATS, CatIcon, quantityText, isLow, expiryLabel } from "./shared";
import { adjustQuantity, moveItems, discardItems } from "./inventoryActions";
import { Checkbox } from "@/components/ui/checkbox";

const TONES = {
  red: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300",
};

export function StoragePanel({ title, kind, items, locations, currentName, onAddItem, onEditItem, onEditLocation }) {
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const [discardIds, setDiscardIds] = useState(null);

  // The panel stays mounted while you switch spaces (so the page does not jump); reset its filters instead.
  useEffect(() => { setSearch(""); setCat("all"); setSelected(new Set()); }, [title]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((g) => (!q || g.name.toLowerCase().includes(q)) && (cat === "all" || g.category === cat))
      .sort((a, b) => (a.expiration || "9999").localeCompare(b.expiration || "9999") || a.name.localeCompare(b.name));
  }, [items, search, cat]);

  const adjust = adjustQuantity;
  const move = async (ids, to) => { if (await moveItems(ids, to)) setSelected(new Set()); };
  const discard = async (ids) => {
    if (await discardItems(ids)) { setDiscardIds(null); setSelected(new Set()); }
  };

  const toggle = (id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const others = locations.filter((l) => l.name !== currentName);
  const picked = rows.filter((g) => selected.has(g.id)).map((g) => g.id);

  return (
    <Card className="p-4 md:p-5 space-y-4" role="region" aria-label={`Inside ${title}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          <p className="text-xs text-slate-500">{items.length} item{items.length !== 1 ? "s" : ""}{kind ? ` · ${kind}` : ""}</p>
        </div>
        {onEditLocation && (
          <Button variant="ghost" size="sm" onClick={onEditLocation} aria-label={`Edit ${title}`}><Settings2 className="h-4 w-4 mr-1" />Edit space</Button>
        )}
        <Button size="sm" onClick={onAddItem} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="h-4 w-4 mr-1" />Add item</Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input placeholder={`Search ${title.toLowerCase()}...`} aria-label="Search items" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          {search && <button aria-label="Clear search" onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Category filter"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {picked.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2 text-sm" role="toolbar" aria-label="Bulk actions">
          <span className="font-medium mr-auto">{picked.length} selected</span>
          {others.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button size="sm" variant="outline"><FolderInput className="h-4 w-4 mr-1" />Move to…</Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                {others.map((l) => <DropdownMenuItem key={l.id} onSelect={() => move(picked, l.name)}>{l.name}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button size="sm" variant="outline" className="text-red-600" onClick={() => setDiscardIds(picked)}><Trash2 className="h-4 w-4 mr-1" />Discard</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState icon={Utensils} title={items.length ? "No matches" : "Nothing in here yet"}
          sub={items.length ? "Try a different search or category." : "Add what you have so LifeRecord can track it."} />
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((g) => {
            const exp = expiryLabel(g.expiration);
            const low = isLow(g);
            return (
              <li key={g.id} className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 py-2.5" data-testid="storage-item">
                <Checkbox checked={selected.has(g.id)} onCheckedChange={() => toggle(g.id)} aria-label={`Select ${g.name}`} />
                <CatIcon category={g.category} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{g.name}</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {exp && <span className={cn("text-[11px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap", TONES[exp.tone])}>{exp.text}</span>}
                    {low && <span className={cn("text-[11px] px-1.5 py-0.5 rounded-full font-medium", TONES.amber)}>Low</span>}
                    <span className="text-[11px] text-slate-400 self-center">{g.category}</span>
                  </div>
                </div>
                <div className="order-last sm:order-none flex items-center gap-1 w-full sm:w-auto pl-[4.75rem] sm:pl-0">
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => adjust(g, -1)} disabled={Number(g.quantity) <= 0} aria-label={`Use one ${g.name}`}><Minus className="h-3.5 w-3.5" /></Button>
                  <span className="w-16 text-center text-sm font-semibold tabular-nums" aria-live="polite">{quantityText(g.quantity, g.unit)}</span>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => adjust(g, 1)} aria-label={`Add one ${g.name}`}><Plus className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="hidden sm:flex">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onEditItem(g)} aria-label={`Edit ${g.name}`}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setDiscardIds([g.id])} aria-label={`Discard ${g.name}`}><Trash2 className="h-4 w-4" /></Button>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move ${g.name}`}><FolderInput className="h-4 w-4" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    {others.map((l) => <DropdownMenuItem key={l.id} onSelect={() => move([g.id], l.name)}>Move to {l.name}</DropdownMenuItem>)}
                    <DropdownMenuItem className="sm:hidden" onSelect={() => onEditItem(g)}>Edit</DropdownMenuItem>
                    <DropdownMenuItem className="sm:hidden text-red-600" onSelect={() => setDiscardIds([g.id])}>Discard</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={!!discardIds}
        onOpenChange={(v) => !v && setDiscardIds(null)}
        title="Discard from inventory?"
        description={`This removes ${discardIds?.length || 0} item${discardIds?.length !== 1 ? "s" : ""} from your inventory. Use the − button instead if you just ate or used some.`}
        onConfirm={() => discard(discardIds)}
        confirmText="Discard"
        variant="danger"
      />
    </Card>
  );
}
