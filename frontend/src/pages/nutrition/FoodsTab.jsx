import { useEffect, useState } from "react";
import { ChefHat, Flame, Loader2, Pencil, Plus, Search, Star, Trash2, Utensils } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useFetch, refreshAll } from "@/lib/useFetch";
import { Card, EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { QualityBadge, fmt, useNutrientMeta } from "./shared";

const FORM_FIELDS = ["energy_kcal", "protein_g", "carbs_g", "fat_g", "fiber_g", "sugars_g", "sat_fat_g", "sodium_mg", "calcium_mg", "iron_mg", "vit_c_mg", "vit_d_ug", "vit_b12_ug", "potassium_mg"];

function FoodDetail({ id, onClose, onLog }) {
  const [food, setFood] = useState(null);
  useEffect(() => {
    setFood(null);
    if (id) api.get(`/nutrition/foods/${id}`).then(({ data }) => setFood(data)).catch((err) => { toast.error(errorMessage(err, "Could not open this food")); onClose(); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = async () => {
    try { if (food.favorite) await api.delete(`/nutrition/foods/${food.id}/favorite`); else await api.post(`/nutrition/foods/${food.id}/favorite`); setFood({ ...food, favorite: !food.favorite }); refreshAll(); }
    catch (err) { toast.error(errorMessage(err, "Could not change favourites")); }
  };
  const groups = food ? ["macro", "fat", "vitamin", "mineral", "other"].map((g) => [g, food.nutrients.filter((n) => (n.group === "energy" ? "macro" : n.group) === g)]) : [];
  const title = { macro: "Energy and macronutrients", fat: "Fats", vitamin: "Vitamins", mineral: "Minerals", other: "Other" };
  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto" data-testid="food-detail">
        <DialogHeader>
          <DialogTitle className="pr-6 leading-snug">{food ? food.name : "Loading…"}</DialogTitle>
          <DialogDescription>{food ? <span className="flex flex-wrap items-center gap-2"><QualityBadge quality={food.quality} /><span>{food.brand ? `${food.brand} · ` : ""}{food.data_version}</span></span> : "Nutrition per 100 g"}</DialogDescription>
        </DialogHeader>
        {food && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500">Values per 100 g. {food.completeness.reported} of {food.completeness.of} tracked nutrients are reported by this source; the rest show "not reported", which is not the same as zero.</p>
            {groups.map(([g, list]) => (
              <div key={g}>
                <p className="mb-1 text-sm font-semibold">{title[g]}</p>
                <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  {list.map((n) => (
                    <div key={n.key} className="flex justify-between border-b border-border/60 py-1 text-sm">
                      <dt className="text-slate-600 dark:text-slate-300">{n.name}</dt>
                      <dd className="stat-num">{n.per100 == null ? <span className="text-slate-400">not reported</span> : `${fmt(n.per100)} ${n.unit}`}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
            {food.portions?.length > 0 && <p className="text-xs text-slate-500">Portions: {food.portions.map((p) => `${p.label} = ${fmt(p.grams)} g`).join(" · ")}</p>}
            <div className="flex justify-between gap-2">
              <Button type="button" variant="outline" onClick={toggle} aria-pressed={!!food.favorite}><Star className={food.favorite ? "mr-1.5 h-4 w-4 fill-amber-400 text-amber-500" : "mr-1.5 h-4 w-4"} />{food.favorite ? "Favourite" : "Add to favourites"}</Button>
              <Button type="button" onClick={() => { onClose(); onLog(food.id); }} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="food-detail-log">Log this food</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateFoodDialog({ open, onOpenChange, byKey }) {
  const [f, setF] = useState({ name: "", brand: "", portionLabel: "", portionGrams: "" });
  const [n, setN] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setF({ name: "", brand: "", portionLabel: "", portionGrams: "" }); setN({}); setError(""); } }, [open]);
  const submit = async (e) => {
    e.preventDefault(); setSaving(true); setError("");
    const nutrients = Object.fromEntries(Object.entries(n).filter(([, v]) => v !== "" && v != null).map(([k, v]) => [k, parseFloat(v)]));
    const portions = f.portionLabel && f.portionGrams ? [{ label: f.portionLabel, grams: parseFloat(f.portionGrams) }] : [];
    try { await api.post("/nutrition/foods", { name: f.name, brand: f.brand || null, nutrients, portions }); toast.success(`Saved ${f.name}`); refreshAll(); onOpenChange(false); }
    catch (err) { const d = err.response?.data?.detail; setError(typeof d === "string" ? d : errorMessage(err, "Could not save this food")); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-xl overflow-y-auto" data-testid="create-food-dialog">
        <DialogHeader>
          <DialogTitle>Add your own food</DialogTitle>
          <DialogDescription>Copy the values from the label, per 100 g. Leave out anything you do not know: it will show as "not reported", not as zero.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">{error}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="cf-name">Name</Label><Input id="cf-name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="mt-1 h-10" data-testid="cf-name" /></div>
            <div><Label htmlFor="cf-brand">Brand (optional)</Label><Input id="cf-brand" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} className="mt-1 h-10" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {FORM_FIELDS.map((k) => (
              <div key={k}>
                <Label htmlFor={`cf-${k}`} className="text-xs">{byKey[k]?.name} ({byKey[k]?.unit}){k === "energy_kcal" ? " *" : ""}</Label>
                <Input id={`cf-${k}`} inputMode="decimal" value={n[k] ?? ""} onChange={(e) => setN({ ...n, [k]: e.target.value.replace(",", ".") })} className="mt-1 h-9" data-testid={`cf-${k}`} />
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="cf-pl">One serving is called (optional)</Label><Input id="cf-pl" value={f.portionLabel} onChange={(e) => setF({ ...f, portionLabel: e.target.value })} placeholder="1 bowl" className="mt-1 h-10" /></div>
            <div><Label htmlFor="cf-pg">…and weighs (g)</Label><Input id="cf-pg" inputMode="decimal" value={f.portionGrams} onChange={(e) => setF({ ...f, portionGrams: e.target.value.replace(",", ".") })} className="mt-1 h-10" /></div>
          </div>
          <div className="flex justify-end"><Button type="submit" disabled={saving || !f.name || !n.energy_kcal} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="cf-save">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save food"}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecipeDialog({ open, onOpenChange, editing }) {
  const blank = { name: "", servings: 1, ingredients: [], calories: "", protein: "", carbs: "", fat: "", notes: "" };
  const [f, setF] = useState(blank);
  useEffect(() => {
    if (!open) return;
    setF(editing ? { name: editing.name || "", servings: editing.servings || 1, ingredients: (editing.ingredients || []).map((i) => ({ ...i })), calories: editing.calories ?? "", protein: editing.protein ?? "", carbs: editing.carbs ?? "", fat: editing.fat ?? "", notes: editing.notes || "" } : blank);
  }, [open, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const upd = (i, k, v) => setF((x) => ({ ...x, ingredients: x.ingredients.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)) }));
  const num = (v) => (v === "" || v == null ? null : parseFloat(v));
  const submit = async (e) => {
    e.preventDefault();
    const payload = { name: f.name, servings: parseInt(f.servings, 10) || 1, notes: f.notes, calories: num(f.calories), protein: num(f.protein), carbs: num(f.carbs), fat: num(f.fat),
      ingredients: f.ingredients.filter((i) => i.name.trim()).map((i) => ({ name: i.name, quantity: parseFloat(i.quantity) || 1, unit: i.unit || "unit" })) };
    try {
      if (editing) await api.put(`/recipes/${editing.id}`, payload); else await api.post("/recipes", payload);
      toast.success(editing ? "Recipe updated" : "Recipe created"); refreshAll(); onOpenChange(false);
    } catch (err) { toast.error(errorMessage(err, "Could not save recipe")); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto" data-testid="recipe-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit recipe" : "New recipe"}</DialogTitle>
          <DialogDescription>Ingredients link to your Groceries stock. Nutrition is for the whole recipe and entered by you; one serving is the total divided by the servings.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-2 space-y-3">
          <Input placeholder="Recipe name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <Input type="number" min={1} placeholder="Servings" value={f.servings} onChange={(e) => setF({ ...f, servings: e.target.value })} required />
          <div className="space-y-2">
            <div className="flex items-center justify-between"><Label>Ingredients</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setF((x) => ({ ...x, ingredients: [...x.ingredients, { name: "", quantity: 1, unit: "unit" }] }))}><Plus className="mr-1 h-4 w-4" />Add</Button></div>
            {f.ingredients.map((it, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2">
                <Input className="col-span-5 h-9" placeholder="Name" value={it.name} onChange={(e) => upd(i, "name", e.target.value)} />
                <Input className="col-span-3 h-9" type="number" min={0} step="0.1" placeholder="Qty" value={it.quantity} onChange={(e) => upd(i, "quantity", e.target.value)} />
                <Input className="col-span-3 h-9" placeholder="Unit" value={it.unit} onChange={(e) => upd(i, "unit", e.target.value)} />
                <Button type="button" variant="ghost" size="icon" className="col-span-1 h-9 w-9 text-red-500" aria-label="Remove ingredient" onClick={() => setF((x) => ({ ...x, ingredients: x.ingredients.filter((_, idx) => idx !== i) }))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[["calories", "Calories, whole recipe"], ["protein", "Protein (g), whole recipe"], ["carbs", "Carbs (g), whole recipe"], ["fat", "Fat (g), whole recipe"]].map(([k, p]) => (
              <Input key={k} type="number" min={0} step="0.1" placeholder={p} aria-label={p} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            ))}
          </div>
          <Input placeholder="Notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" className="bg-emerald-600 text-white hover:bg-emerald-700">{editing ? "Save" : "Create recipe"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FoodsTab({ onLog }) {
  const { byKey } = useNutrientMeta();
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [deleteRecipe, setDeleteRecipe] = useState(null);
  const [deleteFood, setDeleteFood] = useState(null);
  const { data: favorites } = useFetch("/nutrition/foods/favorites");
  const { data: mine } = useFetch("/nutrition/foods/mine");
  const { data: recipes } = useFetch("/recipes");

  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults(null); return undefined; }
    const t = setTimeout(() => api.get("/nutrition/foods/search", { params: { q: term, limit: 30 } }).then(({ data }) => setResults(data)).catch(() => setResults([])), 220);
    return () => clearTimeout(t);
  }, [q]);

  const cook = async (r) => {
    try { const { data } = await api.post(`/recipes/${r.id}/cook`); toast.success(`Cooked ${r.name}`, { description: data.inventory_changes?.join(", ") }); refreshAll(); }
    catch (err) { toast.error(errorMessage(err, "Could not cook recipe")); }
  };
  const logRecipe = async (r) => {
    try { await api.post("/nutrition/diary", { recipe_id: r.id, quantity: 1 }); toast.success(`Added 1 serving of ${r.name} to today`); refreshAll(); }
    catch (err) { toast.error(errorMessage(err, "Could not log this recipe")); }
  };
  const removeRecipe = async () => {
    try { await api.delete(`/recipes/${deleteRecipe.id}`); toast.success("Recipe deleted"); setDeleteRecipe(null); refreshAll(); } catch (err) { toast.error(errorMessage(err, "Could not delete recipe")); }
  };
  const removeFood = async () => {
    try { await api.delete(`/nutrition/foods/${deleteFood.id}`); toast.success("Food deleted. Past diary entries keep their numbers."); setDeleteFood(null); refreshAll(); } catch (err) { toast.error(errorMessage(err, "Could not delete this food")); }
  };
  const list = (foods, empty) => (foods?.length ? (
    <ul className="divide-y divide-border">
      {foods.map((f) => (
        <li key={f.id} className="flex items-center gap-2 px-4 py-2.5 sm:px-5">
          <button type="button" onClick={() => setDetailId(f.id)} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:underline" data-testid={`food-row-${f.id}`}>
            <p className="truncate text-sm font-medium">{f.name}{f.brand ? <span className="font-normal text-slate-500"> · {f.brand}</span> : null}</p>
            <p className="text-xs text-slate-500"><span className="stat-num">{fmt(f.per100.energy_kcal)} kcal</span> per 100 g · P {fmt(f.per100.protein_g)} · C {fmt(f.per100.carbs_g)} · F {fmt(f.per100.fat_g)}</p>
          </button>
          <QualityBadge quality={f.quality} />
          {f.mine && <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" aria-label={`Delete ${f.name}`} onClick={() => setDeleteFood(f)}><Trash2 className="h-4 w-4" /></Button>}
        </li>
      ))}
    </ul>
  ) : <p className="px-5 py-5 text-sm text-slate-500">{empty}</p>);

  return (
    <div className="space-y-6" data-testid="foods-tab">
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="font-semibold">Food database</h3><p className="text-xs text-slate-500">About 8,000 USDA reference foods, plus packaged foods you look up by barcode and foods you add.</p></div>
          <Button variant="outline" onClick={() => setCreateOpen(true)} data-testid="create-food"><Plus className="mr-1.5 h-4 w-4" />Add your own food</Button>
        </div>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search foods" aria-label="Search the food database" className="h-11 pl-9" data-testid="foods-search" />
        </div>
        {results && <div className="mt-3 rounded-xl border border-border">{list(results, `No food matches "${q}".`)}</div>}
      </Card>
      {!results && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="overflow-hidden"><h3 className="border-b border-border px-4 py-3 font-semibold sm:px-5"><Star className="mr-1.5 inline h-4 w-4 text-amber-500" aria-hidden="true" />Favourites</h3>{list(favorites, "Star a food when you log it and it will be here for one-tap access.")}</Card>
          <Card className="overflow-hidden"><h3 className="border-b border-border px-4 py-3 font-semibold sm:px-5"><Utensils className="mr-1.5 inline h-4 w-4 text-emerald-600" aria-hidden="true" />Foods you added</h3>{list(mine, "Foods you add (from a label, or your own recipes) appear here and are private to you.")}</Card>
        </div>
      )}

      <Card className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2"><ChefHat className="h-4 w-4 text-emerald-600" aria-hidden="true" /><h3 className="font-semibold">Recipes</h3></div>
          <Button size="sm" onClick={() => { setEditingRecipe(null); setRecipeOpen(true); }} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="new-recipe"><Plus className="mr-1 h-4 w-4" />New recipe</Button>
        </div>
        {recipes === null ? <div className="skeleton mt-4 h-28 rounded-2xl" aria-busy="true" /> : !recipes?.length ? (
          <EmptyState icon={ChefHat} title="No recipes yet" sub="Save the meals you cook often, then log a serving in one tap." compact />
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recipes.map((r) => (
              <div key={r.id} data-testid={`recipe-${r.id}`} className="rounded-xl border border-border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="truncate text-sm font-semibold">{r.name}</p>
                    <p className="text-xs text-slate-500">{r.servings} serving{r.servings > 1 ? "s" : ""}{r.calories != null ? ` · ${Math.round(r.calories / (r.servings || 1))} kcal each` : " · no nutrition yet"}</p></div>
                  <div className="flex shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${r.name}`} data-testid={`recipe-edit-${r.id}`} onClick={() => { setEditingRecipe(r); setRecipeOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" aria-label={`Delete ${r.name}`} data-testid={`recipe-delete-${r.id}`} onClick={() => setDeleteRecipe(r)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <p className="mt-2 line-clamp-2 text-xs text-slate-500">{(r.ingredients || []).map((i) => `${i.quantity}${i.unit} ${i.name}`).join(", ")}</p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" className="h-8" onClick={() => logRecipe(r)} disabled={r.calories == null} data-testid={`log-recipe-${r.id}`}>Log a serving</Button>
                  <Button size="sm" className="h-8 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => cook(r)} data-testid={`cook-${r.id}`}><Flame className="mr-1 h-3.5 w-3.5" />Cook</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <FoodDetail id={detailId} onClose={() => setDetailId(null)} onLog={onLog} />
      <CreateFoodDialog open={createOpen} onOpenChange={setCreateOpen} byKey={byKey} />
      <RecipeDialog open={recipeOpen} onOpenChange={setRecipeOpen} editing={editingRecipe} />
      <ConfirmDialog open={!!deleteRecipe} onOpenChange={(v) => !v && setDeleteRecipe(null)} title="Delete recipe?" description={deleteRecipe ? `This will permanently delete "${deleteRecipe.name}".` : ""} onConfirm={removeRecipe} confirmText="Delete" variant="danger" />
      <ConfirmDialog open={!!deleteFood} onOpenChange={(v) => !v && setDeleteFood(null)} title="Delete this food?" description={deleteFood ? `"${deleteFood.name}" will be removed. Diary entries that used it keep their numbers.` : ""} onConfirm={removeFood} confirmText="Delete" variant="danger" />
    </div>
  );
}
