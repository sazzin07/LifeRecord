import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, BookOpen, Check, ChefHat, CircleHelp, Coffee, CookingPot, Flame, Microwave, Pencil, Plus,
  Sandwich, Soup, Timer, Trash2, Wind, Zap, ShoppingCart,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { Card, EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";

const APPLIANCE_KINDS = [
  { value: "oven", label: "Oven", icon: Flame },
  { value: "hob", label: "Hob", icon: CookingPot },
  { value: "microwave", label: "Microwave", icon: Microwave },
  { value: "air_fryer", label: "Air fryer", icon: Wind },
  { value: "blender", label: "Blender", icon: Soup },
  { value: "kettle", label: "Kettle", icon: Timer },
  { value: "coffee_machine", label: "Coffee machine", icon: Coffee },
  { value: "toaster", label: "Toaster", icon: Sandwich },
  { value: "other", label: "Other", icon: Zap },
];
const kindMeta = (k) => APPLIANCE_KINDS.find((x) => x.value === k) || APPLIANCE_KINDS[APPLIANCE_KINDS.length - 1];

const STATUS = {
  ok: { icon: Check, tone: "text-emerald-600 dark:text-emerald-400", label: () => "In stock" },
  short: { icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-400", label: (r) => `Need ${+r.shortfall.toFixed(2)} ${r.unit} more` },
  missing: { icon: Plus, tone: "text-red-600 dark:text-red-400", label: () => "Not in stock" },
  check_units: { icon: CircleHelp, tone: "text-slate-500", label: () => "In stock, units differ" },
};

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

function RecipeCard({ e, onAddMissing, onCook }) {
  const r = e.recipe;
  const tone = e.can_cook_now ? "bg-emerald-500" : e.coverage >= 60 ? "bg-amber-500" : "bg-red-400";
  return (
    <Card className="flex flex-col gap-3 p-4" data-testid="recipe-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold leading-tight">{r.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {r.servings} serving{r.servings !== 1 ? "s" : ""}{r.calories ? ` · ${Math.round(r.calories / (r.servings || 1))} kcal each` : ""}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
          e.can_cook_now ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
          {e.can_cook_now ? "Ready to cook" : `${e.missing.length} missing`}
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(e.coverage)} aria-valuemin={0} aria-valuemax={100} aria-label="Ingredients in stock">
        <div className={cn("h-full rounded-full transition-all duration-500", tone)} style={{ width: `${e.coverage}%` }} />
      </div>

      {e.uses_expiring.length > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          Uses up {e.uses_expiring.map((u) => `${u.name.toLowerCase()} (${u.expires_in <= 0 ? "today" : `${u.expires_in}d`})`).join(", ")} before it goes off.
        </p>
      )}

      <ul className="space-y-1.5">
        {e.ingredients.map((i) => {
          const S = STATUS[i.status];
          return (
            <li key={i.name} className="flex items-center gap-2 text-sm">
              <S.icon className={cn("h-4 w-4 shrink-0", S.tone)} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{i.name} <span className="text-muted-foreground">{fmt(i.needed)} {i.unit}</span></span>
              <span className={cn("shrink-0 text-xs", S.tone)}>{S.label(i)}</span>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button size="sm" className="bg-emerald-700 text-white hover:bg-emerald-700" onClick={() => onCook(e)}><ChefHat className="mr-1.5 h-4 w-4" />Cook this</Button>
        {e.missing.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => onAddMissing(e)}><ShoppingCart className="mr-1.5 h-4 w-4" />Add {e.missing.length} to a list</Button>
        )}
      </div>
    </Card>
  );
}

/** Edit quantities, pick a list. Adds shopping-list entries only: nothing here counts as bought or in stock. */
function AddMissingDialog({ evaluation, lists, defaultListId, open, setOpen }) {
  const [rows, setRows] = useState([]);
  const [listId, setListId] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!evaluation) return;
    setRows(evaluation.missing.map((m) => ({ ...m, include: true, text: fmt(m.quantity) })));
    setListId(defaultListId || lists[0]?.id || "");
  }, [evaluation, defaultListId, lists, open]);

  const chosen = rows.filter((r) => r.include && Number(r.text) > 0);
  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await api.post(`/recipes/${evaluation.recipe.id}/add-missing`, {
        list_id: listId || null,
        items: chosen.map((r) => ({ name: r.name, quantity: Number(r.text), unit: r.unit })),
      });
      const listName = lists.find((l) => l.id === listId)?.name || "your list";
      toast.success(`Added ${data.count} item${data.count !== 1 ? "s" : ""} to ${listName}`, { description: "They are on the list, not in your inventory." });
      setOpen(false);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not add to the list"); }
    finally { setSaving(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add missing ingredients</DialogTitle>
          <DialogDescription>For {evaluation?.recipe.name}. Adjust the amounts you want to buy.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {lists.length > 0 && (
            <Select value={listId} onValueChange={setListId}>
              <SelectTrigger aria-label="Shopping list"><SelectValue placeholder="Choose a list" /></SelectTrigger>
              <SelectContent>{lists.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={r.name} className="flex items-center gap-3">
                <Checkbox checked={r.include} onCheckedChange={(c) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, include: c === true } : x)))} aria-label={`Include ${r.name}`} />
                <span className="min-w-0 flex-1 truncate text-sm">{r.name}</span>
                <Input className="h-9 w-20 text-right" type="text" inputMode="decimal" aria-label={`${r.name} quantity`} value={r.text}
                  onChange={(e) => { if (/^[0-9]*[.,]?[0-9]{0,3}$/.test(e.target.value)) setRows((rs) => rs.map((x, j) => (j === i ? { ...x, text: e.target.value.replace(",", ".") } : x))); }} />
                <span className="w-12 text-xs text-muted-foreground">{r.unit}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button className="bg-emerald-700 text-white hover:bg-emerald-700" disabled={!chosen.length || saving} onClick={submit}>
              {saving ? "Adding…" : `Add ${chosen.length} to list`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ApplianceDialog({ appliance, open, setOpen, onSave }) {
  const [f, setF] = useState({ name: "", kind: "other", notes: "" });
  useEffect(() => { setF(appliance ? { name: appliance.name, kind: appliance.kind, notes: appliance.notes || "" } : { name: "", kind: "other", notes: "" }); }, [appliance, open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{appliance ? "Edit appliance" : "Add appliance"}</DialogTitle>
          <DialogDescription>The assistant uses these when it suggests how to cook something.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSave(f); }} className="space-y-4">
          <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Name</span>
            <Input value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} placeholder="e.g. Air fryer" required /></label>
          <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Type</span>
            <Select value={f.kind} onValueChange={(v) => setF((x) => ({ ...x, kind: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{APPLIANCE_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
            </Select></label>
          <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Notes</span>
            <Input value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} placeholder="Optional, e.g. 5 L basket" /></label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="bg-emerald-700 text-white hover:bg-emerald-700">{appliance ? "Save changes" : "Add appliance"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function KitchenTab({ suggestions, appliances, lists, selectedListId }) {
  const [filter, setFilter] = useState("all");
  const [addFor, setAddFor] = useState(null);
  const [cookFor, setCookFor] = useState(null);
  const [applianceDialog, setApplianceDialog] = useState({ open: false, appliance: null });
  const [deleteAppliance, setDeleteAppliance] = useState(null);

  const shown = useMemo(() => (filter === "ready" ? suggestions.filter((s) => s.can_cook_now) : suggestions), [suggestions, filter]);
  const activeLists = lists.filter((l) => !l.archived);

  const cook = async () => {
    const e = cookFor;
    setCookFor(null);
    try {
      const { data } = await api.post(`/recipes/${e.recipe.id}/cook`);
      toast.success(`Cooked ${data.recipe}`, { description: data.inventory_changes.slice(0, 3).join(" · ") + (data.inventory_changes.length > 3 ? " …" : "") });
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not cook that recipe"); }
  };

  const saveAppliance = async (f) => {
    const editing = applianceDialog.appliance;
    try {
      if (editing) await api.put(`/appliances/${editing.id}`, f); else await api.post("/appliances", f);
      toast.success(editing ? "Appliance updated" : "Appliance added");
      setApplianceDialog({ open: false, appliance: null });
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not save the appliance"); }
  };
  const removeAppliance = async () => {
    const a = deleteAppliance;
    setDeleteAppliance(null);
    try { await api.delete(`/appliances/${a.id}`); toast.success(`${a.name} removed`); refreshAll(); }
    catch (err) { toast.error(err.response?.data?.detail || "Could not remove the appliance"); }
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="cook-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="cook-heading" className="text-lg font-semibold leading-tight">Cook with what you have</h2>
            <p className="text-xs text-muted-foreground">Ranked by what is in stock, with a boost for recipes that use food about to expire.</p>
          </div>
          <div className="flex items-center gap-2">
            {["all", "ready"].map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} className={cn("rounded-full", filter === f && "bg-emerald-700 text-white hover:bg-emerald-700")} onClick={() => setFilter(f)}>
                {f === "all" ? "All recipes" : "Ready to cook"}
              </Button>
            ))}
            <Button asChild size="sm" variant="ghost"><Link to="/nutrition"><BookOpen className="mr-1.5 h-4 w-4" />Manage recipes</Link></Button>
          </div>
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={ChefHat} title={suggestions.length ? "Nothing is ready to cook yet" : "No recipes yet"}
            sub={suggestions.length ? "Switch to All recipes to see what you are missing." : "Add a recipe on the Nutrition page and it will show up here."} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((e) => <RecipeCard key={e.recipe.id} e={e} onAddMissing={setAddFor} onCook={setCookFor} />)}
          </div>
        )}
      </section>

      <section aria-labelledby="appliances-heading" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="appliances-heading" className="text-lg font-semibold leading-tight">Appliances</h2>
            <p className="text-xs text-muted-foreground">What you can cook with.</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setApplianceDialog({ open: true, appliance: null })}><Plus className="mr-1.5 h-4 w-4" />Add appliance</Button>
        </div>
        {appliances.length === 0 ? (
          <EmptyState icon={CookingPot} title="No appliances yet" sub="Add your oven, hob or air fryer so suggestions fit your kitchen." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {appliances.map((a) => {
              const K = kindMeta(a.kind);
              return (
                <Card key={a.id} className="group relative p-4" data-testid="appliance-card">
                  <span className="mb-3 grid h-11 w-11 place-items-center rounded-2xl bg-accent text-accent-foreground"><K.icon className="h-5 w-5" /></span>
                  <p className="truncate text-sm font-semibold">{a.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{a.notes || K.label}</p>
                  <div className="absolute right-2 top-2 flex gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${a.name}`} onClick={() => setApplianceDialog({ open: true, appliance: a })}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" aria-label={`Remove ${a.name}`} onClick={() => setDeleteAppliance(a)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <AddMissingDialog evaluation={addFor} lists={activeLists} defaultListId={selectedListId} open={!!addFor} setOpen={(v) => !v && setAddFor(null)} />
      <ApplianceDialog appliance={applianceDialog.appliance} open={applianceDialog.open} setOpen={(v) => setApplianceDialog((d) => ({ ...d, open: v }))} onSave={saveAppliance} />
      <ConfirmDialog
        open={!!cookFor}
        onOpenChange={(v) => !v && setCookFor(null)}
        title={`Cook ${cookFor?.recipe.name}?`}
        description={cookFor && (cookFor.can_cook_now
          ? "This uses up the ingredients from your inventory and logs one serving as a meal."
          : `You are missing ${cookFor.missing.map((m) => m.name.toLowerCase()).join(", ")}. Cooking still uses whatever you do have and logs one serving as a meal.`)}
        onConfirm={cook}
        confirmText="Cook it"
        variant="primary"
      />
      <ConfirmDialog
        open={!!deleteAppliance}
        onOpenChange={(v) => !v && setDeleteAppliance(null)}
        title={`Remove ${deleteAppliance?.name}?`}
        description="It will no longer be used in cooking suggestions."
        onConfirm={removeAppliance}
        confirmText="Remove"
        variant="danger"
      />
    </div>
  );
}
