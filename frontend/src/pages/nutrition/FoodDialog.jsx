import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Loader2, Search, Star, ScanBarcode, ChefHat, Pencil, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MEALS, QualityBadge, defaultMeal, fmt, refreshNutrition } from "./shared";

// the camera reader (ZXing) is only downloaded when someone taps Scan
const BarcodeScanner = lazy(() => import("./BarcodeScanner"));

const MASS = { g: 1, kg: 1000, oz: 28.3495 };

/** Same arithmetic as the server (nutrition_calc.to_grams): used only for the live preview; the server's answer is what is saved. */
function previewGrams(food, qty, unit) {
  if (!(qty > 0)) return null;
  if (MASS[unit]) return qty * MASS[unit];
  const p = (food.portions || []).find((x) => x.label === unit);
  if (p) return qty * p.grams;
  return food.liquid && ["ml", "l"].includes(unit.toLowerCase()) ? qty * (unit.toLowerCase() === "l" ? 1000 : 1) : null;
}
const per100 = (food, key) => food.nutrients.find((n) => n.key === key)?.per100;

function FoodRow({ food, onPick }) {
  return (
    <button type="button" onClick={() => onPick(food)} data-testid={`food-result-${food.id}`}
      className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-slate-50 focus-visible:border-emerald-400 focus-visible:outline-none dark:hover:bg-slate-800/60">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{food.name}{food.brand ? <span className="font-normal text-slate-500 dark:text-slate-400"> · {food.brand}</span> : null}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="stat-num">{fmt(food.per100.energy_kcal)} kcal</span>
          <span>per 100 g</span>
          <span>P {fmt(food.per100.protein_g)} · C {fmt(food.per100.carbs_g)} · F {fmt(food.per100.fat_g)}</span>
          {food.last_quantity ? <span className="text-emerald-700 dark:text-emerald-400">last: {fmt(food.last_quantity)} {food.last_unit}</span> : null}
        </p>
      </div>
      <QualityBadge quality={food.quality} />
    </button>
  );
}

/**
 * Add, edit or plan food. With `planning` the same screens write to the meal plan (`/nutrition/plan`) instead of the diary, so
 * choosing a food, a recipe or typing a meal in works the same way in both places.
 */
export function FoodDialog({ open, onOpenChange, date, defaultMealType, entry, initialFoodId, initialRecipeId, initialQuery, planning = false }) {
  const editing = !!entry;
  const base = planning ? "/nutrition/plan" : "/nutrition/diary";
  const [scanning, setScanning] = useState(false);
  const [mode, setMode] = useState("find");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [food, setFood] = useState(null);
  const [qty, setQty] = useState("100");
  const [unit, setUnit] = useState("g");
  const [mealType, setMealType] = useState(defaultMealType || defaultMeal());
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [quick, setQuick] = useState({ description: "", calories: "", protein: "", carbs: "", fat: "" });
  const [barcode, setBarcode] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [servings, setServings] = useState("1");
  const [error, setError] = useState("");
  const clientRef = useRef(null);
  const inputRef = useRef(null);
  const { data: recent } = useFetch(open && !editing ? "/nutrition/foods/recent" : null);
  const { data: favorites } = useFetch(open && !editing ? "/nutrition/foods/favorites" : null);
  const { data: recipes } = useFetch(open && !editing ? "/recipes" : null);

  const pick = useCallback(async (f) => {
    setError("");
    try {
      const { data } = await api.get(`/nutrition/foods/${f.id}`);
      setFood(data);
      const first = data.portions?.[0];
      const again = f.last_quantity && f.last_unit && data.units?.includes(f.last_unit); // a recent food: start from the amount used last time
      setUnit(again ? f.last_unit : first ? first.label : "g");
      setQty(again ? String(f.last_quantity) : first ? "1" : "100");
      setMode("find");
    } catch (err) { toast.error(errorMessage(err, "Could not open this food")); }
  }, []);

  // reset every time the dialog opens
  useEffect(() => {
    if (!open) return;
    clientRef.current = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)) + "";
    setError(""); setSaving(false); setResults(null); setBarcode(""); setRecipeId(""); setServings("1");
    setQuery(initialQuery || ""); setMealType(entry?.meal_type || defaultMealType || defaultMeal()); setTime(entry?.eaten_at || "");
    setQuick({ description: "", calories: "", protein: "", carbs: "", fat: "" });
    if (entry) {
      setFood(null);
      if (entry.food_id) {
        api.get(`/nutrition/foods/${entry.food_id}`).then(({ data }) => { setFood(data); setQty(String(entry.quantity ?? 100)); setUnit(entry.unit || "g"); })
          .catch(() => setError("The food behind this entry is no longer available. You can still change its meal and time."));
      } else if (!entry.recipe_id) {
        const n = entry.nutrients || {};
        setQuick({ description: entry.description, calories: n.energy_kcal ?? "", protein: n.protein_g ?? "", carbs: n.carbs_g ?? "", fat: n.fat_g ?? "" });
        setMode("quick");
      } else { setQty(String(entry.quantity ?? 1)); }
    } else {
      setFood(null); setMode("find");
      if (initialFoodId) pick({ id: initialFoodId });
      else if (initialRecipeId) { setMode("recipe"); setRecipeId(initialRecipeId); }
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // debounced search
  useEffect(() => {
    if (!open || editing || mode !== "find" || food) return undefined;
    const q = query.trim();
    if (!q) { setResults(null); return undefined; }
    setSearching(true);
    const t = setTimeout(async () => {
      try { const { data } = await api.get("/nutrition/foods/search", { params: { q, limit: 30 } }); setResults(data); }
      catch (err) { setResults([]); setError(errorMessage(err, "Search failed")); }
      finally { setSearching(false); }
    }, 220);
    return () => clearTimeout(t);
  }, [query, open, editing, mode, food]);

  const grams = food ? previewGrams(food, parseFloat(qty), unit) : null;
  const preview = useMemo(() => {
    if (!food || grams == null) return null;
    const get = (k) => { const v = per100(food, k); return v == null ? null : (v * grams) / 100; };
    return { kcal: get("energy_kcal"), p: get("protein_g"), c: get("carbs_g"), f: get("fat_g"), fiber: get("fiber_g") };
  }, [food, grams]);

  const done = (msg) => { toast.success(msg); refreshNutrition(); onOpenChange(false); };
  const fail = (err, fallback) => { const m = errorMessage(err, fallback); setError(m); toast.error(m); setSaving(false); };

  const saveFood = async () => {
    setSaving(true); setError("");
    try {
      const qn = parseFloat(qty);
      if (editing) {
        await api.put(`${base}/${entry.id}`, { quantity: qn, unit, meal_type: mealType, eaten_at: time || undefined, ...(planning ? {} : { if_updated_at: entry.updated_at }) });
        done(planning ? "Plan updated" : "Entry updated");
      } else {
        await api.post(base, { date, food_id: food.id, quantity: qn, unit, meal_type: mealType, eaten_at: time || undefined, ...(planning ? {} : { client_ref: clientRef.current }) });
        done(`${planning ? "Planned" : "Added"} ${food.name.split(",")[0]} ${planning ? "for" : "to"} ${MEALS.find((m) => m.key === mealType).label.toLowerCase()}`);
      }
    } catch (err) { fail(err, "Could not save this entry"); }
  };

  const saveQuick = async (e) => {
    e.preventDefault(); setSaving(true); setError("");
    const num = (v) => (v === "" || v == null ? undefined : parseFloat(v));
    try {
      if (editing) {
        await api.put(`${base}/${entry.id}`, { description: quick.description, calories: num(quick.calories), protein: num(quick.protein), carbs: num(quick.carbs), fat: num(quick.fat), meal_type: mealType, eaten_at: time || undefined });
        done(planning ? "Plan updated" : "Entry updated");
      } else {
        await api.post(base, { date, description: quick.description, calories: num(quick.calories), protein: num(quick.protein), carbs: num(quick.carbs), fat: num(quick.fat), meal_type: mealType, eaten_at: time || undefined, ...(planning ? {} : { client_ref: clientRef.current }) });
        done(`${planning ? "Planned" : "Added"} ${quick.description}`);
      }
    } catch (err) { fail(err, "Could not save this entry"); }
  };

  const saveRecipe = async () => {
    setSaving(true); setError("");
    try {
      if (editing) {
        await api.put(`${base}/${entry.id}`, { quantity: parseFloat(qty), meal_type: mealType, eaten_at: time || undefined });
        done(planning ? "Plan updated" : "Entry updated");
      } else {
        await api.post(base, { date, recipe_id: recipeId, quantity: parseFloat(servings), meal_type: mealType, eaten_at: time || undefined, ...(planning ? {} : { client_ref: clientRef.current }) });
        done(planning ? "Recipe planned" : "Recipe added");
      }
    } catch (err) { fail(err, "Could not add this recipe"); }
  };

  const lookupBarcode = async (code = barcode) => {
    setSaving(true); setError("");
    try { const { data } = await api.get(`/nutrition/foods/barcode/${String(code).trim()}`); await pick(data); }
    catch (err) { setError(errorMessage(err, "Barcode lookup failed")); }
    finally { setSaving(false); }
  };

  const toggleFavorite = async () => {
    try {
      if (food.favorite) await api.delete(`/nutrition/foods/${food.id}/favorite`); else await api.post(`/nutrition/foods/${food.id}/favorite`);
      setFood({ ...food, favorite: !food.favorite }); refreshNutrition();
    } catch (err) { toast.error(errorMessage(err, "Could not change favourites")); }
  };

  const unitOptions = food ? ["g", "kg", "oz", ...(food.portions || []).map((p) => p.label), ...(food.liquid ? ["ml", "l"] : [])] : [];
  const mealPicker = (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400" htmlFor="nf-meal">Meal</label>
        <Select value={mealType} onValueChange={setMealType}>
          <SelectTrigger id="nf-meal" className="mt-1 h-10" data-testid="food-meal"><SelectValue /></SelectTrigger>
          <SelectContent>{MEALS.map((m) => <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400" htmlFor="nf-time">Time (optional)</label>
        <Input id="nf-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 h-10" data-testid="food-time" />
      </div>
    </div>
  );

  const showPortion = food && mode === "find";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto overflow-x-hidden [&>*]:min-w-0" data-testid="food-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? (planning ? "Edit planned item" : "Edit entry") : planning ? "Plan a meal" : "Add to your diary"}</DialogTitle>
          <DialogDescription>{editing ? entry.description : planning ? "Planned food only counts once you log it. Search the food database, add a recipe or type it in." : "Search the food database, scan a barcode, add a recipe or type it in."}</DialogDescription>
        </DialogHeader>

        {/* The mode's content is rendered below, outside the Tabs, so the triggers must not point aria-controls at a panel that does not exist. */}
        {!editing && !showPortion && (
          <Tabs value={mode} onValueChange={setMode}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="find" aria-controls={undefined} className="gap-1.5" data-testid="food-tab-find"><Search className="h-3.5 w-3.5" />Find food</TabsTrigger>
              <TabsTrigger value="recipe" aria-controls={undefined} className="gap-1.5" data-testid="food-tab-recipe"><ChefHat className="h-3.5 w-3.5" />Recipe</TabsTrigger>
              <TabsTrigger value="quick" aria-controls={undefined} className="gap-1.5" data-testid="food-tab-quick"><Pencil className="h-3.5 w-3.5" />Type it in</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        {error && <p role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}

        {/* ---- find */}
        {mode === "find" && !showPortion && !editing && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" aria-hidden="true" />
              <Input ref={inputRef} autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search foods, e.g. chicken breast, oats, yoghurt"
                aria-label="Search foods" className="h-11 pl-9" data-testid="food-search" />
              {searching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-500 dark:text-slate-400" aria-label="Searching" />}
            </div>
            {results === null ? (
              <div className="space-y-3">
                {favorites?.length > 0 && <div><p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Favourites</p>{favorites.slice(0, 5).map((f) => <FoodRow key={f.id} food={f} onPick={pick} />)}</div>}
                {recent?.length > 0 && <div><p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">Recently logged</p>{recent.slice(0, 6).map((f) => <FoodRow key={f.id} food={f} onPick={pick} />)}</div>}
                <div className="rounded-xl border border-dashed border-border p-3">
                  <label htmlFor="nf-barcode" className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400"><ScanBarcode className="h-3.5 w-3.5" />Packaged food? Scan it or type the barcode number</label>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" variant="outline" className="h-10 shrink-0" onClick={() => setScanning(true)} data-testid="food-scan"><Camera className="mr-1.5 h-4 w-4" />Scan</Button>
                    <Input id="nf-barcode" inputMode="numeric" value={barcode} onChange={(e) => setBarcode(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 3017620422003" className="h-10" data-testid="food-barcode" />
                    <Button type="button" variant="outline" disabled={barcode.length < 8 || saving} onClick={() => lookupBarcode()} data-testid="food-barcode-go">Look up</Button>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Uses Open Food Facts. Values come from the community and are marked as estimated.</p>
                </div>
                {!favorites?.length && !recent?.length && <p className="text-sm text-slate-500 dark:text-slate-400">Start typing to search about 8,000 reference foods. Foods you log often will appear here.</p>}
              </div>
            ) : results.length === 0 ? (
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
                No food matches "{query}". Try a simpler word, or <button type="button" className="font-medium text-emerald-700 underline dark:text-emerald-400" onClick={() => { setQuick((q) => ({ ...q, description: query })); setMode("quick"); }}>type it in</button> yourself.
              </div>
            ) : (
              <div className="max-h-[46vh] space-y-0.5 overflow-y-auto" role="list" aria-label="Search results">
                {results.map((f) => <div key={f.id} role="listitem"><FoodRow food={f} onPick={pick} />{f.flags?.length > 0 && <p className="-mt-1 mb-1 px-3 text-xs text-amber-700 dark:text-amber-400">{f.flags[0]}</p>}</div>)}
              </div>
            )}
          </div>
        )}

        {/* ---- portion step (new food entry, or editing one) */}
        {showPortion && (
          <div className="space-y-4" data-testid="food-portion">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold leading-snug">{food.name}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <QualityBadge quality={food.quality} />
                  <span>{food.brand || food.data_version}</span>
                  <span title="How many of the 41 tracked nutrients this source reports">{food.completeness.reported}/{food.completeness.of} nutrients reported</span>
                </p>
              </div>
              {!editing && (
                <Button type="button" variant="ghost" size="icon" aria-pressed={!!food.favorite} aria-label={food.favorite ? "Remove from favourites" : "Add to favourites"} onClick={toggleFavorite}>
                  <Star className={food.favorite ? "h-4 w-4 fill-amber-400 text-amber-500" : "h-4 w-4 text-slate-500 dark:text-slate-400"} />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-5 gap-3">
              <div className="col-span-2">
                <label htmlFor="nf-qty" className="text-xs font-medium text-slate-500 dark:text-slate-400">Amount</label>
                <Input id="nf-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(",", "."))} className="mt-1 h-10" data-testid="food-qty" />
              </div>
              <div className="col-span-3">
                <label htmlFor="nf-unit" className="text-xs font-medium text-slate-500 dark:text-slate-400">Unit</label>
                <Select value={unit} onValueChange={setUnit}>
                  <SelectTrigger id="nf-unit" className="mt-1 h-10" data-testid="food-unit"><SelectValue /></SelectTrigger>
                  <SelectContent>{unitOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {mealPicker}
            <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50" aria-live="polite" data-testid="food-preview">
              {preview ? (
                <>
                  <p className="text-sm"><span className="stat-num text-lg font-semibold">{fmt(preview.kcal)}</span> kcal <span className="text-slate-500 dark:text-slate-400">· {fmt(grams)} g</span></p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Protein {fmt(preview.p)} g · Carbs {fmt(preview.c)} g · Fat {fmt(preview.f)} g{preview.fiber != null ? ` · Fibre ${fmt(preview.fiber)} g` : ""}</p>
                </>
              ) : <p className="text-sm text-slate-500 dark:text-slate-400">Enter a valid amount and unit to see the nutrition.</p>}
              {food.energy_check && Math.abs(food.energy_check.difference_pct) > 10 && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">The listed energy differs from what the macronutrients add up to by {Math.abs(Math.round(food.energy_check.difference_pct))}%. That happens with food data; the listed value is used.</p>
              )}
            </div>
            <div className="flex justify-between gap-2">
              {!editing ? <Button type="button" variant="outline" onClick={() => setFood(null)}>Back to search</Button> : <span />}
              <Button type="button" disabled={saving || grams == null} onClick={saveFood} className="bg-emerald-700 text-white hover:bg-emerald-800" data-testid="food-save">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save changes" : planning ? "Add to plan" : "Add to diary"}
              </Button>
            </div>
          </div>
        )}
        {editing && mode === "find" && !food && !error && !entry.recipe_id && entry.food_id && <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>}

        {/* ---- recipe */}
        {(mode === "recipe" || (editing && entry?.recipe_id)) && (
          <div className="space-y-4" data-testid="food-recipe">
            {!editing && (
              <div>
                <label htmlFor="nf-recipe" className="text-xs font-medium text-slate-500 dark:text-slate-400">Recipe</label>
                <Select value={recipeId} onValueChange={setRecipeId}>
                  <SelectTrigger id="nf-recipe" className="mt-1 h-10" data-testid="food-recipe-select"><SelectValue placeholder={recipes?.length ? "Choose a recipe" : "No recipes yet"} /></SelectTrigger>
                  <SelectContent>{(recipes || []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div>
              <label htmlFor="nf-serv" className="text-xs font-medium text-slate-500 dark:text-slate-400">Servings eaten</label>
              <Input id="nf-serv" inputMode="decimal" value={editing ? qty : servings} onChange={(e) => (editing ? setQty : setServings)(e.target.value.replace(",", "."))} className="mt-1 h-10" />
            </div>
            {mealPicker}
            <div className="flex justify-end">
              <Button type="button" disabled={saving || (!editing && !recipeId)} onClick={saveRecipe} className="bg-emerald-700 text-white hover:bg-emerald-800" data-testid="food-recipe-save">{editing ? "Save changes" : planning ? "Add to plan" : "Add recipe"}</Button>
            </div>
          </div>
        )}

        {/* ---- quick */}
        {mode === "quick" && (!editing || (!entry.food_id && !entry.recipe_id)) && (
          <form onSubmit={saveQuick} className="space-y-4" data-testid="food-quick">
            <div>
              <label htmlFor="nf-desc" className="text-xs font-medium text-slate-500 dark:text-slate-400">What did you eat?</label>
              <Input id="nf-desc" value={quick.description} onChange={(e) => setQuick({ ...quick, description: e.target.value })} required className="mt-1 h-10" data-testid="quick-description" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[["calories", "Calories (kcal)"], ["protein", "Protein (g)"], ["carbs", "Carbs (g)"], ["fat", "Fat (g)"]].map(([k, l]) => (
                <div key={k}>
                  <label htmlFor={`nf-${k}`} className="text-xs font-medium text-slate-500 dark:text-slate-400">{l}</label>
                  <Input id={`nf-${k}`} inputMode="decimal" value={quick[k]} onChange={(e) => setQuick({ ...quick, [k]: e.target.value.replace(",", ".") })} className="mt-1 h-10" data-testid={`quick-${k}`} />
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Only the numbers you type are recorded; vitamins and minerals stay "no data" for typed-in meals.</p>
            {mealPicker}
            <div className="flex justify-end"><Button type="submit" disabled={saving} className="bg-emerald-700 text-white hover:bg-emerald-800" data-testid="quick-save">{editing ? "Save changes" : planning ? "Add to plan" : "Add to diary"}</Button></div>
          </form>
        )}
      </DialogContent>
      {scanning && (
        <Suspense fallback={null}>
          <BarcodeScanner open={scanning} onOpenChange={setScanning} onDetected={(code) => { setBarcode(code); lookupBarcode(code); }} />
        </Suspense>
      )}
    </Dialog>
  );
}
