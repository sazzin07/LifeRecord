import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeftRight, Link2, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SWAP_NUTRIENTS, fmt, shortName, refreshNutrition } from "./shared";

const blankIngredient = () => ({ key: Math.random().toString(36).slice(2), name: "", quantity: "1", unit: "unit", food_id: null, food: null });
const unitsFor = (food) => ["g", "kg", "oz", "lb", ...(food?.portions || []).map((p) => p.label), ...(food?.liquid ? ["ml", "l"] : [])];
const STATUS_TEXT = { unlinked: "not linked to a food", food_missing: "its food was removed", unit_unknown: null };

/** What swapping one ingredient for a similar food would do to the whole recipe, per serving. Nothing changes until "Use" is tapped, and the recipe is saved with its own Save. */
function Alternatives({ ingredient, nutrients, onUse }) {
  const options = SWAP_NUTRIENTS.filter(([k]) => ingredient.food?.nutrients?.find((n) => n.key === k)?.per100 != null);
  const [key, setKey] = useState(options[0]?.[0] || "");
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!options.length) return <p className="col-span-12 text-xs text-slate-500">This food does not report the nutrients swaps compare, so no alternatives can be suggested.</p>;
  const go = async () => {
    setBusy(true);
    try { const { data } = await api.post("/nutrition/recipe-alternatives", { ...nutrients, nutrient: key, limit: 5 }); setRes(data); }
    catch (err) { toast.error(errorMessage(err, "Could not look for alternatives")); } finally { setBusy(false); }
  };
  return (
    <div className="col-span-12 rounded-lg border border-dashed border-border p-2" data-testid="alternatives">
      <div className="flex gap-2">
        <Select value={key} onValueChange={(v) => { setKey(v); setRes(null); }}><SelectTrigger className="h-9" aria-label="What the swap should improve" data-testid="alt-nutrient"><SelectValue /></SelectTrigger>
          <SelectContent>{options.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
        <Button type="button" variant="outline" size="sm" className="h-9" onClick={go} disabled={busy} data-testid="alt-go">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}</Button>
      </div>
      {res && (res.alternatives.length === 0 ? <p className="mt-2 text-xs text-slate-500" data-testid="alt-none">{res.note.startsWith(res.food) ? res.note : "No similar food of the same kind does better here."}</p> : (
        <ul className="mt-2 divide-y divide-border" aria-live="polite">
          {res.alternatives.map((a) => (
            <li key={a.food_id} className="flex items-center gap-2 py-1.5" data-testid={`alt-${a.food_id}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{a.name}</p>
                <p className="text-xs text-slate-500">Recipe {res.name.toLowerCase()}: <span className="stat-num">{fmt(a.recipe_per_serving.before)} → {a.recipe_per_serving.after == null ? "n/a" : fmt(a.recipe_per_serving.after)} {res.unit}</span> per serving
                  {a.recipe_per_serving.change_pct != null ? ` (${a.recipe_per_serving.change_pct > 0 ? "+" : ""}${Math.round(a.recipe_per_serving.change_pct)}%)` : ""}
                  {a.energy_per_serving.after != null ? ` · ${fmt(a.energy_per_serving.before)} → ${fmt(a.energy_per_serving.after)} kcal` : ""}</p>
              </div>
              <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={() => onUse(a, res.grams)} data-testid={`alt-use-${a.food_id}`}>Use</Button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

function FindFood({ onPick }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const seq = useRef(0);
  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults(null); return undefined; }
    const id = ++seq.current;
    const t = setTimeout(() => api.get("/nutrition/foods/search", { params: { q: term, limit: 6 } }).then(({ data }) => { if (id === seq.current) setResults(data); }).catch(() => { if (id === seq.current) setResults([]); }), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="col-span-12 rounded-lg border border-dashed border-border p-2">
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for the food this ingredient is" aria-label="Search for a food to link" className="h-9" data-testid="link-food-search" />
      {results && (results.length === 0 ? <p className="mt-2 text-xs text-slate-500">No food matches "{q}".</p> : (
        <ul className="mt-1 max-h-44 overflow-y-auto">
          {results.map((f) => (
            <li key={f.id}><button type="button" onClick={() => onPick(f)} data-testid={`link-food-${f.id}`}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none dark:hover:bg-slate-800/60">
              <span className="truncate">{f.name}{f.brand ? ` · ${f.brand}` : ""}</span><span className="stat-num shrink-0 text-xs text-slate-500">{fmt(f.per100.energy_kcal)} kcal/100 g</span>
            </button></li>
          ))}
        </ul>
      ))}
    </div>
  );
}

/**
 * Create or edit a recipe. Link an ingredient to a food and the recipe's nutrition is calculated per serving from the food's own
 * data; an ingredient that is not linked is left out and listed, never counted as zero. A recipe with no linked ingredient keeps
 * whole-recipe numbers typed in by hand.
 */
export function RecipeDialog({ open, onOpenChange, editing }) {
  const [f, setF] = useState({ name: "", servings: "1", ingredients: [], calories: "", protein: "", carbs: "", fat: "", notes: "" });
  const [finding, setFinding] = useState(null);
  const [swapping, setSwapping] = useState(null); // the ingredient whose alternatives are shown
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const linked = f.ingredients.filter((i) => i.food_id);

  useEffect(() => {
    if (!open) return;
    setFinding(null); setSwapping(null); setPreview(null);
    const base = { name: editing?.name || "", servings: String(editing?.servings || 1), calories: editing?.calories ?? "", protein: editing?.protein ?? "", carbs: editing?.carbs ?? "", fat: editing?.fat ?? "", notes: editing?.notes || "" };
    const ings = (editing?.ingredients || []).map((i) => ({ ...blankIngredient(), name: i.name, quantity: String(i.quantity ?? 1), unit: i.unit || "unit", food_id: i.food_id || null }));
    setF({ ...base, ingredients: ings });
    ings.filter((i) => i.food_id).forEach((i) => api.get(`/nutrition/foods/${i.food_id}`).then(({ data }) => setF((x) => ({ ...x, ingredients: x.ingredients.map((it) => (it.key === i.key ? { ...it, food: data } : it)) }))).catch(() => {}));
  }, [open, editing]);

  // live nutrition from the linked ingredients (the server does the arithmetic; this only shows it)
  useEffect(() => {
    if (!open || !linked.length) { setPreview(null); return undefined; }
    const t = setTimeout(() => {
      api.post("/nutrition/recipe-preview", { servings: parseInt(f.servings, 10) || 1, ingredients: f.ingredients.filter((i) => i.name.trim() || i.food_id).map((i) => ({ name: i.name || "?", quantity: parseFloat(i.quantity) || 0, unit: i.unit || "unit", food_id: i.food_id })) })
        .then(({ data }) => setPreview(data)).catch(() => setPreview(null));
    }, 350);
    return () => clearTimeout(t);
  }, [open, f.ingredients, f.servings]); // eslint-disable-line react-hooks/exhaustive-deps

  const upd = (key, patch) => setF((x) => ({ ...x, ingredients: x.ingredients.map((it) => (it.key === key ? { ...it, ...patch } : it)) }));
  const link = async (key, summary) => {
    setFinding(null);
    try {
      const { data } = await api.get(`/nutrition/foods/${summary.id}`);
      setF((x) => ({ ...x, ingredients: x.ingredients.map((it) => (it.key === key ? { ...it, food_id: data.id, food: data, name: it.name.trim() ? it.name : shortName(data.name), unit: "g", quantity: it.unit === "unit" ? "100" : it.quantity } : it)) }));
    } catch (err) { toast.error(errorMessage(err, "Could not link this food")); }
  };
  const use = async (key, alt, grams, oldFood) => {
    try {
      const { data } = await api.get(`/nutrition/foods/${alt.food_id}`);
      setF((x) => ({ ...x, ingredients: x.ingredients.map((it) => (it.key !== key ? it : { ...it, food_id: data.id, food: data, unit: "g", quantity: String(Math.round(grams * 10) / 10),
        name: it.name.trim() === shortName(oldFood?.name || "") ? shortName(data.name) : it.name })) }));
      setSwapping(null); toast.success(`Now using ${shortName(data.name)}. Save the recipe to keep the change.`);
    } catch (err) { toast.error(errorMessage(err, "Could not use this food")); }
  };
  const num = (v) => (v === "" || v == null ? null : parseFloat(v));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    const payload = { name: f.name, servings: parseInt(f.servings, 10) || 1, notes: f.notes,
      calories: linked.length ? null : num(f.calories), protein: linked.length ? null : num(f.protein), carbs: linked.length ? null : num(f.carbs), fat: linked.length ? null : num(f.fat),
      ingredients: f.ingredients.filter((i) => i.name.trim()).map((i) => ({ name: i.name, quantity: parseFloat(i.quantity) || 1, unit: i.unit || "unit", food_id: i.food_id || null })) };
    try {
      if (editing) await api.put(`/recipes/${editing.id}`, payload); else await api.post("/recipes", payload);
      toast.success(editing ? "Recipe updated" : "Recipe created"); refreshNutrition(); onOpenChange(false);
    } catch (err) { toast.error(errorMessage(err, "Could not save recipe")); } finally { setBusy(false); }
  };
  const problems = (preview?.ingredients || []).filter((i) => i.status !== "ok" && (i.food_id || preview.linked));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto overflow-x-hidden [&>*]:min-w-0" data-testid="recipe-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit recipe" : "New recipe"}</DialogTitle>
          <DialogDescription>Link ingredients to foods and the nutrition per serving is calculated for you. Ingredient names also match your Groceries stock when you cook.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-1 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><Label htmlFor="rc-name" className="text-xs">Recipe name</Label><Input id="rc-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="mt-1 h-10" data-testid="recipe-name" /></div>
            <div><Label htmlFor="rc-serv" className="text-xs">Servings</Label><Input id="rc-serv" type="number" min={1} required value={f.servings} onChange={(e) => setF({ ...f, servings: e.target.value })} className="mt-1 h-10" data-testid="recipe-servings" /></div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label>Ingredients</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setF((x) => ({ ...x, ingredients: [...x.ingredients, blankIngredient()] }))} data-testid="recipe-add-ingredient"><Plus className="mr-1 h-4 w-4" />Add</Button></div>
            {f.ingredients.length === 0 && <p className="text-xs text-slate-500">Add the ingredients, then link each one to a food.</p>}
            {f.ingredients.map((it) => (
              <div key={it.key} className="grid grid-cols-12 items-center gap-2 rounded-xl border border-border p-2" data-testid="recipe-ingredient">
                <Input className="col-span-9 h-9 sm:col-span-5" placeholder="Name" aria-label="Ingredient name" value={it.name} onChange={(e) => upd(it.key, { name: e.target.value })} data-testid="ing-name" />
                <Input className="col-span-5 h-9 sm:col-span-2" inputMode="decimal" placeholder="Qty" aria-label="Quantity" value={it.quantity} onChange={(e) => upd(it.key, { quantity: e.target.value.replace(",", ".") })} data-testid="ing-qty" />
                {it.food_id && it.food ? (
                  <Select value={unitsFor(it.food).includes(it.unit) ? it.unit : "g"} onValueChange={(v) => upd(it.key, { unit: v })}>
                    <SelectTrigger className="col-span-6 h-9 sm:col-span-4" aria-label="Unit" data-testid="ing-unit"><SelectValue /></SelectTrigger>
                    <SelectContent>{unitsFor(it.food).map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                  </Select>
                ) : <Input className="col-span-6 h-9 sm:col-span-4" placeholder="Unit" aria-label="Unit" value={it.unit} onChange={(e) => upd(it.key, { unit: e.target.value })} data-testid="ing-unit" />}
                <Button type="button" variant="ghost" size="icon" className="col-span-1 h-9 w-9 text-red-500" aria-label="Remove ingredient" onClick={() => setF((x) => ({ ...x, ingredients: x.ingredients.filter((i) => i.key !== it.key) }))}><Trash2 className="h-4 w-4" /></Button>
                <div className="col-span-12 -mt-1 flex items-center gap-2 text-xs">
                  {it.food_id ? (
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><Link2 className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate" data-testid="ing-linked">{it.food ? shortName(it.food.name) : "linked food"}</span>
                      <button type="button" aria-label="Unlink this food" className="shrink-0 rounded-full hover:bg-emerald-100 dark:hover:bg-emerald-500/20" onClick={() => upd(it.key, { food_id: null, food: null, unit: "unit" })}><X className="h-3 w-3" /></button></span>
                  ) : <button type="button" className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline dark:text-emerald-400" onClick={() => setFinding(finding === it.key ? null : it.key)} data-testid="ing-link"><Link2 className="h-3 w-3" aria-hidden="true" />Link to a food for nutrition</button>}
                </div>
                {finding === it.key && <FindFood onPick={(food) => link(it.key, food)} />}
                {it.food_id && it.food && (
                  <button type="button" className="col-span-12 -mt-1 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 focus-visible:underline focus-visible:outline-none dark:hover:text-slate-200"
                    aria-expanded={swapping === it.key} onClick={() => setSwapping(swapping === it.key ? null : it.key)} data-testid="ing-swap"><ArrowLeftRight className="h-3 w-3" aria-hidden="true" />Find a swap</button>
                )}
                {swapping === it.key && it.food && (
                  <Alternatives ingredient={it} onUse={(a, g) => use(it.key, a, g, it.food)}
                    nutrients={{ servings: parseInt(f.servings, 10) || 1, index: f.ingredients.filter((i) => i.name.trim() || i.food_id).findIndex((i) => i.key === it.key),
                      ingredients: f.ingredients.filter((i) => i.name.trim() || i.food_id).map((i) => ({ name: i.name || "?", quantity: parseFloat(i.quantity) || 0, unit: i.unit || "unit", food_id: i.food_id })) }} />
                )}
              </div>
            ))}
          </div>

          {linked.length > 0 ? (
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50" aria-live="polite" data-testid="recipe-preview">
              {!preview ? <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Calculating…</p> : preview.linked === 0 ? (
                <p className="text-sm text-amber-700 dark:text-amber-400">None of the linked ingredients could be calculated yet. Check their units below.</p>
              ) : (
                <>
                  <p className="text-sm"><span className="stat-num text-lg font-semibold" data-testid="preview-kcal">{fmt(preview.per_serving.energy_kcal)}</span> kcal per serving
                    <span className="text-slate-500"> · based on {preview.linked} of {preview.total_ingredients} {preview.total_ingredients === 1 ? "ingredient" : "ingredients"}</span></p>
                  <p className="mt-1 text-xs text-slate-500">Protein {fmt(preview.per_serving.protein_g)} g · Carbs {fmt(preview.per_serving.carbs_g)} g · Fat {fmt(preview.per_serving.fat_g)} g{preview.per_serving.fiber_g != null ? ` · Fibre ${fmt(preview.per_serving.fiber_g)} g` : ""}</p>
                </>
              )}
              {problems.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-amber-700 dark:text-amber-400">
                  {problems.map((p, i) => <li key={i} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /><span><strong>{p.name}</strong> is left out: {STATUS_TEXT[p.status] || p.reason}</span></li>)}
                </ul>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {[["calories", "Calories, whole recipe"], ["protein", "Protein (g), whole recipe"], ["carbs", "Carbs (g), whole recipe"], ["fat", "Fat (g), whole recipe"]].map(([k, p]) => (
                <Input key={k} type="number" min={0} step="0.1" placeholder={p} aria-label={p} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="h-10" />
              ))}
              <p className="col-span-2 -mt-1 text-xs text-slate-500">Or link ingredients above to calculate this instead of typing it.</p>
            </div>
          )}
          <Input placeholder="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="h-10" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy || !f.name.trim()} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="recipe-save">{editing ? "Save" : "Create recipe"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
