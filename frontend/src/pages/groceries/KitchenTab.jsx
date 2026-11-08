import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, BookOpen, Check, ChefHat, CircleHelp, Coffee, CookingPot, Flame, Microwave, Pencil, Plus,
  Sandwich, Soup, Timer, Trash2, Wind, Zap, ShoppingCart, Leaf, Sparkles,
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
import { Glyph } from "./glyphs";
import { CAT_META } from "./shared";
import { Pill } from "./pills";
import { MixPanel } from "./MixPanel";
import { EMPTY_MIX, GOALS, applyMix, cookSummary, cookTimeLabel, perServing, voice } from "./kitchenMix";
import { CoverRing } from "./todayParts";

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
  ok: { icon: Check, tone: "text-green-700 dark:text-green-400", label: () => "In stock" },
  short: { icon: AlertTriangle, tone: "text-amber-600 dark:text-amber-400", label: (r) => `Need ${+r.shortfall.toFixed(2)} ${r.unit} more` },
  missing: { icon: Plus, tone: "text-red-600 dark:text-red-400", label: () => "Not in stock" },
  check_units: { icon: CircleHelp, tone: "text-slate-500", label: () => "In stock, units differ" },
};

const fmt = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

const TILT = [-9, 6, -5, 8, -7, 4];

/* The recipe's ingredients laid out on a plate a little askew; they fan out when you reach for the card. Missing ones are greyed and dashed. */
function Plate({ e, size }) {
  const miss = new Set(e.missing.map((m) => m.name.toLowerCase()));
  const ings = e.recipe.ingredients || [];
  const tone = CAT_META[Glyph.category(ings[0]?.name)]?.color || "#8b6a9d";
  return (
    <div className="gt-plate" style={{ "--c": tone }}>
      <span className="gt-dish" aria-hidden="true" />
      {ings.map((ing, k) => (
        <img key={ing.name} className={cn("gt-rp", miss.has(ing.name.toLowerCase()) && "miss")} alt="" width={size} height={size} src={Glyph.url(ing.name, "")}
          style={{ "--k": k, "--o": (k - (ings.length - 1) / 2).toFixed(2), "--r": `${TILT[k % TILT.length]}deg` }} />
      ))}
      {e.can_cook_now && <span className="gt-stamp">Ready!</span>}
    </div>
  );
}

function RecipeCard({ e, onAddMissing, onCook, feature = false, goal = null }) {
  const r = e.recipe, per = perServing(r);
  const hot = (id) => (goal === id || (id === "energy" && goal === "light") ? "hl" : "");
  return (
    <article className={cn("gt-card gt-rcard", e.can_cook_now && "ready", feature && "feature")} data-testid="recipe-card" aria-label={r.name}>
      <Plate e={e} size={feature ? 68 : 56} />
      <div className="gt-rc-head">
        <div className="min-w-0">
          {feature && <p className="gt-eyebrow gt-feat-eyebrow"><Sparkles aria-hidden="true" />{goal ? `Best for ${GOALS.find((g) => g.id === goal).label.toLowerCase().replace("most ", "")}` : e.can_cook_now ? "Tonight's pick" : "Closest to ready"}</p>}
          <h3 className="gt-rc-name">{r.name}</h3>
          <p className="gt-note">{r.servings} serving{r.servings !== 1 ? "s" : ""}{cookTimeLabel(r.cook_minutes) && ` · ${cookTimeLabel(r.cook_minutes)}`}</p>
        </div>
        <CoverRing pct={Math.round(e.coverage)} ready={e.can_cook_now} />
      </div>
      <p className="gt-voice">{voice(e)}</p>
      <p className="gt-stats-row">
        <span className={cn("gt-st", hot("protein"))}><b>{per.protein ?? "—"}</b> g protein</span>
        <span className={cn("gt-st", hot("energy"))}><b>{per.kcal ?? "—"}</b> kcal</span>
        <span className="gt-note">per serving</span>
      </p>
      <span className={cn("gt-tag", e.can_cook_now ? "green" : "plain")} style={{ alignSelf: "flex-start" }}>{e.can_cook_now ? "Ready to cook" : `${e.missing.length} missing`}</span>
      {e.uses_expiring.length > 0 && (
        <p className="gt-use-first"><Leaf aria-hidden="true" />Uses up {e.uses_expiring.map((u) => `${u.name.toLowerCase()} (${u.expires_in <= 0 ? "today" : `${u.expires_in}d`})`).join(", ")} before it goes off.</p>
      )}
      <ul className="gt-ing-list">
        {e.ingredients.map((i) => {
          const S = STATUS[i.status];
          return (
            <li key={i.name}>
              <S.icon className={cn("h-4 w-4 shrink-0", S.tone)} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{i.name} <span className="text-muted-foreground">{fmt(i.needed)} {i.unit}</span></span>
              <span className={cn("shrink-0 text-xs", S.tone)}>{S.label(i)}</span>
            </li>
          );
        })}
      </ul>
      <div className="gt-rc-act">
        <button type="button" className="gt-btn cta" onClick={() => onCook(e)}><ChefHat aria-hidden="true" />Cook this</button>
        {e.missing.length > 0 && <button type="button" className="gt-btn" onClick={() => onAddMissing(e)}><ShoppingCart aria-hidden="true" />Add {e.missing.length} to a list</button>}
      </div>
    </article>
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
  const [mix, setMix] = useState(EMPTY_MIX);
  const [addFor, setAddFor] = useState(null);
  const [cookFor, setCookFor] = useState(null);
  const [applianceDialog, setApplianceDialog] = useState({ open: false, appliance: null });
  const [deleteAppliance, setDeleteAppliance] = useState(null);

  const base = useMemo(() => (filter === "ready" ? suggestions.filter((s) => s.can_cook_now) : suggestions), [suggestions, filter]);
  const shown = useMemo(() => applyMix(base, mix), [base, mix]);
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
    <div className="gt space-y-8">
      <section aria-labelledby="cook-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="cook-heading" className="text-lg font-semibold leading-tight">Cook with what you have</h2>
            <p className="text-xs text-muted-foreground">Ranked by what is in stock, with a boost for recipes that use food about to expire.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Pill role="group" aria-label="Show recipes">
              {[["all", "All recipes"], ["ready", "Ready to cook"]].map(([f, label]) => <button key={f} type="button" className="gt-pill-b" aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>)}
            </Pill>
            <Button asChild size="sm" variant="ghost" className="gt-tap"><Link to="/nutrition"><BookOpen className="mr-1.5 h-4 w-4" />Manage recipes</Link></Button>
          </div>
        </div>
        {base.length > 0 && <MixPanel mix={mix} setMix={setMix} base={base} list={shown} />}
        {shown.length === 0 ? (
          <EmptyState icon={ChefHat} title={base.length ? "No recipe has all of that" : suggestions.length ? "Nothing is ready to cook yet" : "No recipes yet"}
            sub={base.length ? "Take one of the choices off and the recipes come back." : suggestions.length ? "Switch to All recipes to see what you are missing." : "Add a recipe on the Nutrition page and it will show up here."} />
        ) : (
          <div className="gt-recipes">
            {shown.map((e, i) => <RecipeCard key={e.recipe.id} e={e} feature={i === 0} goal={mix.goal} onAddMissing={setAddFor} onCook={setCookFor} />)}
          </div>
        )}
      </section>

      <section aria-labelledby="appliances-heading" className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="appliances-heading" className="text-lg font-semibold leading-tight">Appliances</h2>
            <p className="text-xs text-muted-foreground">What you can cook with.</p>
          </div>
          <Button size="sm" variant="outline" className="gt-tap" onClick={() => setApplianceDialog({ open: true, appliance: null })}><Plus className="mr-1.5 h-4 w-4" />Add appliance</Button>
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
                  {(a.notes || a.name.trim().toLowerCase() !== K.label.toLowerCase()) && <p className="truncate text-xs text-muted-foreground">{a.notes || K.label}</p>}
                  <div className="gt-appl-acts absolute right-2 top-2 flex gap-0.5">
                    <Button variant="ghost" size="icon" className="gt-tap h-8 w-8" aria-label={`Edit ${a.name}`} onClick={() => setApplianceDialog({ open: true, appliance: a })}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="gt-tap h-8 w-8 text-red-500" aria-label={`Remove ${a.name}`} onClick={() => setDeleteAppliance(a)}><Trash2 className="h-4 w-4" /></Button>
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
        description={cookFor && cookSummary(cookFor)}
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
