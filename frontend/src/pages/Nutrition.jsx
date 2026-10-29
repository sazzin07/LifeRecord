import { useMemo, useState, useEffect } from "react";
import { Trash2, Utensils, Sparkles, ChefHat, Flame, Plus, Pencil, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useFetch, refreshAll } from "@/lib/useFetch";
import { Card, StatCard, SectionHeading, EmptyState, ConfidenceBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { openAI } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";

const TARGETS = { cal: 2700, p: 160, c: 300, f: 90 };

function MacroRing({ label, value, target, color }) {
  const pct = Math.min(100, Math.round((value / target) * 100));
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-20 w-20">
        <svg className="h-full w-full -rotate-90" viewBox="0 0 36 36">
          <path className="text-slate-100 dark:text-slate-800" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" />
          <path className={color} d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray={`${pct}, 100`} />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-sm font-bold">{Math.round(value)}</span>
        </div>
      </div>
      <span className="text-xs text-slate-500 mt-1">{label}</span>
    </div>
  );
}

function MealDialog({ open, setOpen, editing, date, onSave }) {
  const [f, setF] = useState({ description: "", calories: "", protein: "", carbs: "", fat: "", date: date });
  useEffect(() => {
    if (open) {
      setF(editing || { description: "", calories: "", protein: "", carbs: "", fat: "", date });
    }
  }, [open, editing, date]);
  const submit = (e) => {
    e.preventDefault();
    onSave({
      description: f.description,
      calories: f.calories === "" ? null : parseFloat(f.calories),
      protein: f.protein === "" ? null : parseFloat(f.protein),
      carbs: f.carbs === "" ? null : parseFloat(f.carbs),
      fat: f.fat === "" ? null : parseFloat(f.fat),
      date: f.date,
    });
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md" data-testid="meal-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit meal" : "Log a meal"}</DialogTitle>
          <DialogDescription>{editing ? "Update what you ate and its macros." : "Manually log a meal and its macros."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 mt-2">
          <Input placeholder="What did you eat?" value={f.description} onChange={(e) => setF((x) => ({ ...x, description: e.target.value }))} required />
          <DatePicker value={f.date} onChange={(v) => setF((x) => ({ ...x, date: v }))} clearable={false} aria-label="Date" />
          <div className="grid grid-cols-2 gap-3">
            <Input type="number" min={0} step="1" placeholder="Calories" value={f.calories} onChange={(e) => setF((x) => ({ ...x, calories: e.target.value }))} />
            <Input type="number" min={0} step="0.1" placeholder="Protein (g)" value={f.protein} onChange={(e) => setF((x) => ({ ...x, protein: e.target.value }))} />
            <Input type="number" min={0} step="0.1" placeholder="Carbs (g)" value={f.carbs} onChange={(e) => setF((x) => ({ ...x, carbs: e.target.value }))} />
            <Input type="number" min={0} step="0.1" placeholder="Fat (g)" value={f.fat} onChange={(e) => setF((x) => ({ ...x, fat: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white">{editing ? "Save" : "Log meal"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecipeDialog({ open, setOpen, editing, onSave }) {
  const [f, setF] = useState({ name: "", servings: 1, ingredients: [], calories: "", protein: "", carbs: "", fat: "", notes: "" });
  useEffect(() => {
    if (open) {
      setF(editing ? {
        name: editing.name || "",
        servings: editing.servings || 1,
        ingredients: (editing.ingredients || []).map((i) => ({ ...i })),
        calories: editing.calories ?? "",
        protein: editing.protein ?? "",
        carbs: editing.carbs ?? "",
        fat: editing.fat ?? "",
        notes: editing.notes || "",
      } : { name: "", servings: 1, ingredients: [], calories: "", protein: "", carbs: "", fat: "", notes: "" });
    }
  }, [open, editing]);
  const addIngredient = () => setF((x) => ({ ...x, ingredients: [...x.ingredients, { name: "", quantity: 1, unit: "unit" }] }));
  const updateIng = (i, k, v) => setF((x) => ({ ...x, ingredients: x.ingredients.map((it, idx) => idx === i ? { ...it, [k]: v } : it) }));
  const removeIng = (i) => setF((x) => ({ ...x, ingredients: x.ingredients.filter((_, idx) => idx !== i) }));
  const submit = (e) => {
    e.preventDefault();
    onSave({
      name: f.name,
      servings: parseInt(f.servings) || 1,
      ingredients: f.ingredients.filter((i) => i.name.trim()).map((i) => ({ name: i.name, quantity: parseFloat(i.quantity) || 1, unit: i.unit || "unit" })),
      calories: f.calories === "" ? null : parseFloat(f.calories),
      protein: f.protein === "" ? null : parseFloat(f.protein),
      carbs: f.carbs === "" ? null : parseFloat(f.carbs),
      fat: f.fat === "" ? null : parseFloat(f.fat),
      notes: f.notes,
    });
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="recipe-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit recipe" : "New recipe"}</DialogTitle>
          <DialogDescription>{editing ? "Update ingredients and nutrition." : "Create a recipe with ingredients and nutrition per serving."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 mt-2">
          <Input placeholder="Recipe name" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} required />
          <Input type="number" min={1} placeholder="Servings" value={f.servings} onChange={(e) => setF((x) => ({ ...x, servings: e.target.value }))} required />
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Ingredients</Label>
              <Button type="button" variant="outline" size="sm" onClick={addIngredient}><Plus className="h-4 w-4 mr-1" /> Add</Button>
            </div>
            {f.ingredients.map((it, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <Input className="col-span-5 h-9" placeholder="Name" value={it.name} onChange={(e) => updateIng(i, "name", e.target.value)} />
                <Input className="col-span-3 h-9" type="number" min={0} step="0.1" placeholder="Qty" value={it.quantity} onChange={(e) => updateIng(i, "quantity", e.target.value)} />
                <Input className="col-span-3 h-9" placeholder="Unit" value={it.unit} onChange={(e) => updateIng(i, "unit", e.target.value)} />
                <Button type="button" variant="ghost" size="icon" className="col-span-1 h-9 w-9 text-red-500" aria-label="Remove ingredient" onClick={() => removeIng(i)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input type="number" min={0} step="1" placeholder="Calories / serving" value={f.calories} onChange={(e) => setF((x) => ({ ...x, calories: e.target.value }))} />
            <Input type="number" min={0} step="0.1" placeholder="Protein (g)" value={f.protein} onChange={(e) => setF((x) => ({ ...x, protein: e.target.value }))} />
            <Input type="number" min={0} step="0.1" placeholder="Carbs (g)" value={f.carbs} onChange={(e) => setF((x) => ({ ...x, carbs: e.target.value }))} />
            <Input type="number" min={0} step="0.1" placeholder="Fat (g)" value={f.fat} onChange={(e) => setF((x) => ({ ...x, fat: e.target.value }))} />
          </div>
          <Input placeholder="Notes" value={f.notes} onChange={(e) => setF((x) => ({ ...x, notes: e.target.value }))} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white">{editing ? "Save" : "Create recipe"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Nutrition() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: meals, loading } = useFetch(`/meals?date=${today}`);
  const { data: recipes } = useFetch("/recipes");
  const [deleteMealId, setDeleteMealId] = useState(null);
  const [deleteRecipeId, setDeleteRecipeId] = useState(null);
  const [mealDialogOpen, setMealDialogOpen] = useState(false);
  const [editingMeal, setEditingMeal] = useState(null);
  const [recipeDialogOpen, setRecipeDialogOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState(null);

  const arr = useMemo(() => meals || [], [meals]);
  const mealToDelete = arr.find((m) => m.id === deleteMealId);
  const recipeToDelete = (recipes || []).find((r) => r.id === deleteRecipeId);

  const tot = useMemo(() => ({
    cal: arr.reduce((s, x) => s + (x.calories || 0), 0),
    p: arr.reduce((s, x) => s + (x.protein || 0), 0),
    c: arr.reduce((s, x) => s + (x.carbs || 0), 0),
    f: arr.reduce((s, x) => s + (x.fat || 0), 0),
  }), [arr]);

  const saveMeal = async (payload) => {
    try {
      if (editingMeal) {
        await api.put(`/meals/${editingMeal.id}`, payload);
        toast.success("Meal updated");
      } else {
        await api.post("/meals", payload);
        toast.success("Meal logged");
      }
      setMealDialogOpen(false);
      setEditingMeal(null);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not save meal"); }
  };

  const saveRecipe = async (payload) => {
    try {
      if (editingRecipe) {
        await api.put(`/recipes/${editingRecipe.id}`, payload);
        toast.success("Recipe updated");
      } else {
        await api.post("/recipes", payload);
        toast.success("Recipe created");
      }
      setRecipeDialogOpen(false);
      setEditingRecipe(null);
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not save recipe"); }
  };

  const delMeal = async (id) => {
    try { await api.delete(`/meals/${id}`); toast.success("Meal deleted"); setDeleteMealId(null); refreshAll(); }
    catch (err) { toast.error(errorMessage(err, "Could not delete meal")); }
  };

  const delRecipe = async (id) => {
    try { await api.delete(`/recipes/${id}`); toast.success("Recipe deleted"); setDeleteRecipeId(null); refreshAll(); }
    catch (err) { toast.error(errorMessage(err, "Could not delete recipe")); }
  };

  const cook = async (r) => {
    try {
      const { data } = await api.post(`/recipes/${r.id}/cook`);
      toast.success(`Cooked ${r.name}`, { description: data.inventory_changes?.join(", ") });
      refreshAll();
    } catch (err) { toast.error(errorMessage(err, "Could not cook recipe")); }
  };

  return (
    <div className="space-y-6">
      <SectionHeading title="Nutrition" sub="Today's meals, calories and macros"
        action={
          <div className="flex gap-2">
            <Button onClick={() => { setEditingMeal(null); setMealDialogOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white h-9"><Plus className="h-4 w-4 mr-1" />Add meal</Button>
            <Button onClick={() => openAI("Log a meal: ")} variant="outline" className="h-9"><Sparkles className="h-4 w-4 mr-1 text-emerald-600" />AI</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testid="nutri-cal" label="Calories" value={`${Math.round(tot.cal)}`} hint={`/ ${TARGETS.cal}`} />
        <StatCard testid="nutri-protein" label="Protein" value={`${Math.round(tot.p)}g`} accent="text-indigo-500" hint={`/ ${TARGETS.p}g`} />
        <StatCard testid="nutri-carbs" label="Carbs" value={`${Math.round(tot.c)}g`} accent="text-amber-500" hint={`/ ${TARGETS.c}g`} />
        <StatCard testid="nutri-fat" label="Fat" value={`${Math.round(tot.f)}g`} accent="text-red-500" hint={`/ ${TARGETS.f}g`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          {loading ? <div className="skeleton h-40 rounded-2xl" /> : arr.length === 0 ? (
            <Card><EmptyState icon={Utensils} title="No meals logged today"
              sub="Add a meal manually or let the assistant estimate the macros."
              action={
                <div className="flex gap-2 flex-wrap justify-center">
                  <Button onClick={() => { setEditingMeal(null); setMealDialogOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="h-4 w-4 mr-1" />Add meal</Button>
                  <Button onClick={() => openAI("I ate ")} variant="outline"><Sparkles className="h-4 w-4 mr-1 text-emerald-600" />Log with AI</Button>
                </div>
              } />
            </Card>
          ) : (
            <Card>
              <div className="divide-y divide-border">
                {arr.map((m) => (
                  <div key={m.id} data-testid={`meal-${m.id}`} className="flex items-center gap-3 px-5 py-3 group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                    <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 grid place-items-center shrink-0"><Utensils className="h-4 w-4 text-emerald-600" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{m.description}</p>
                      <p className="text-xs text-slate-500">{Math.round(m.protein || 0)}P · {Math.round(m.carbs || 0)}C · {Math.round(m.fat || 0)}F</p>
                    </div>
                    <div className="text-right"><p className="stat-num font-semibold text-sm">{Math.round(m.calories || 0)} kcal</p><ConfidenceBadge type="estimated">Est.</ConfidenceBadge></div>
                    <div className="flex gap-1 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${m.description}`} data-testid={`meal-edit-${m.id}`} onClick={() => { setEditingMeal(m); setMealDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600" aria-label={`Delete ${m.description}`} data-testid={`meal-delete-${m.id}`} onClick={() => setDeleteMealId(m.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card className="p-5 h-fit">
          <p className="text-sm font-medium mb-4">Macro progress</p>
          <div className="flex justify-around">
            <MacroRing label="Protein" value={tot.p} target={TARGETS.p} color="text-indigo-500" />
            <MacroRing label="Carbs" value={tot.c} target={TARGETS.c} color="text-amber-500" />
            <MacroRing label="Fat" value={tot.f} target={TARGETS.f} color="text-red-500" />
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><ChefHat className="h-4 w-4 text-emerald-600" /><h3 className="font-semibold">Recipes</h3></div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { setEditingRecipe(null); setRecipeDialogOpen(true); }} className="bg-emerald-600 hover:bg-emerald-700 text-white h-9"><Plus className="h-4 w-4 mr-1" />New recipe</Button>
            <Button size="sm" variant="outline" onClick={() => openAI("Create a recipe: ")} data-testid="recipe-ai"><Sparkles className="h-4 w-4 mr-1 text-emerald-600" />AI</Button>
          </div>
        </div>
        {recipes === null ? (
          <div className="skeleton h-32 rounded-2xl" aria-busy="true" />
        ) : !recipes.length ? (
          <EmptyState icon={ChefHat} title="No recipes yet" sub="Create a recipe manually or ask the assistant." compact />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {recipes.map((r) => (
              <div key={r.id} data-testid={`recipe-${r.id}`} className="rounded-xl border border-border p-4 hover:border-emerald-200 dark:hover:border-emerald-800 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-sm">{r.name}</p>
                    <p className="text-xs text-slate-500">{r.servings} serving{r.servings > 1 ? "s" : ""} · {Math.round((r.calories || 0) / (r.servings || 1))} kcal each</p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${r.name}`} data-testid={`recipe-edit-${r.id}`} onClick={() => { setEditingRecipe(r); setRecipeDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600" aria-label={`Delete ${r.name}`} data-testid={`recipe-delete-${r.id}`} onClick={() => setDeleteRecipeId(r.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-2 line-clamp-2">{(r.ingredients || []).map((i) => `${i.quantity}${i.unit} ${i.name}`).join(", ")}</p>
                <Button size="sm" onClick={() => cook(r)} className="mt-3 bg-emerald-600 hover:bg-emerald-700 text-white h-8 w-full" data-testid={`cook-${r.id}`}><Flame className="h-3.5 w-3.5 mr-1" />Cook</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <MealDialog open={mealDialogOpen} setOpen={setMealDialogOpen} editing={editingMeal} date={today} onSave={saveMeal} />
      <RecipeDialog open={recipeDialogOpen} setOpen={setRecipeDialogOpen} editing={editingRecipe} onSave={saveRecipe} />

      <ConfirmDialog
        open={!!deleteMealId}
        onOpenChange={(v) => !v && setDeleteMealId(null)}
        title="Delete meal?"
        description={mealToDelete ? `This will permanently delete "${mealToDelete.description}".` : "This will permanently delete the meal."}
        onConfirm={() => deleteMealId && delMeal(deleteMealId)}
        confirmText="Delete"
        variant="danger"
      />
      <ConfirmDialog
        open={!!deleteRecipeId}
        onOpenChange={(v) => !v && setDeleteRecipeId(null)}
        title="Delete recipe?"
        description={recipeToDelete ? `This will permanently delete "${recipeToDelete.name}".` : "This will permanently delete the recipe."}
        onConfirm={() => deleteRecipeId && delRecipe(deleteRecipeId)}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
