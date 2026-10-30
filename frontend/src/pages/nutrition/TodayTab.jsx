import { useState } from "react";
import { Check, Copy, Droplets, GlassWater, History, Lightbulb, MoreHorizontal, Pencil, Plus, Trash2, Utensils, X, ArrowRightLeft, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { Card, EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { QuickAdd } from "./QuickAdd";
import { Suggestions } from "./Suggestions";
import { MEALS, MEAL_BY_KEY, MACRO_COLORS, EnergyBar, RangeGauge, QualityBadge, fmt, shiftDate, refreshNutrition } from "./shared";

function EntryRow({ entry, date, onEdit, onDelete }) {
  const n = entry.nutrients || {};
  const act = async (fn, ok) => {
    try { await fn(); toast.success(ok); refreshNutrition(); } catch (err) { toast.error(errorMessage(err, "That did not work")); }
  };
  return (
    <div className="group flex items-center gap-3 px-4 py-3 sm:px-5" data-testid={`entry-${entry.id}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" data-testid="entry-name">{entry.description}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
          {entry.quantity != null && <span>{fmt(entry.quantity)} {entry.unit === "serving" ? "serving" + (entry.quantity === 1 ? "" : "s") : entry.unit}{entry.grams && entry.unit !== "g" ? ` · ${fmt(entry.grams)} g` : ""}</span>}
          {entry.eaten_at && <span>{entry.eaten_at}</span>}
          <span>{n.protein_g != null ? `P ${fmt(n.protein_g)}` : "P –"} · {n.carbs_g != null ? `C ${fmt(n.carbs_g)}` : "C –"} · {n.fat_g != null ? `F ${fmt(n.fat_g)}` : "F –"}</span>
          {entry.quality !== "verified" && <QualityBadge quality={entry.quality} />}
        </p>
      </div>
      <p className="stat-num shrink-0 text-sm font-semibold">{n.energy_kcal != null ? fmt(n.energy_kcal) : "–"}<span className="text-xs font-normal text-slate-500"> kcal</span></p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Actions for ${entry.description}`} data-testid={`entry-menu-${entry.id}`}><MoreHorizontal className="h-4 w-4" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => onEdit(entry)} data-testid="entry-edit"><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => act(() => api.post(`/nutrition/diary/${entry.id}/duplicate`, { date }), "Duplicated")} data-testid="entry-duplicate"><Copy className="mr-2 h-4 w-4" />Duplicate</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => act(() => api.post(`/nutrition/diary/${entry.id}/duplicate`, { date: shiftDate(date, 1) }), "Copied to tomorrow")}><CalendarPlus className="mr-2 h-4 w-4" />Copy to tomorrow</DropdownMenuItem>
          <DropdownMenuSeparator />
          {MEALS.filter((m) => m.key !== entry.meal_type && m.key !== "other").map((m) => (
            <DropdownMenuItem key={m.key} onSelect={() => act(() => api.post(`/nutrition/diary/${entry.id}/move`, { meal_type: m.key }), `Moved to ${m.label.toLowerCase()}`)}>
              <ArrowRightLeft className="mr-2 h-4 w-4" />Move to {m.label.toLowerCase()}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-red-600 focus:text-red-600" onSelect={() => onDelete(entry)} data-testid="entry-delete"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Hydration({ day, date }) {
  const h = day.hydration;
  const [custom, setCustom] = useState("");
  const add = async (ml, beverage = "water") => {
    try { await api.post("/nutrition/water", { amount_ml: ml, beverage, date }); toast.success(`Added ${ml} ml`); refreshNutrition(); }
    catch (err) { toast.error(errorMessage(err, "Could not add water")); }
  };
  const remove = async (id) => {
    try { await api.delete(`/nutrition/water/${id}`); refreshNutrition(); } catch (err) { toast.error(errorMessage(err, "Could not remove this drink")); }
  };
  const [editing, setEditing] = useState(null); // { id, ml }
  const saveEdit = async (e) => {
    e.preventDefault();
    const ml = parseInt(editing.ml, 10);
    if (!(ml > 0)) { toast.error("Enter an amount in millilitres"); return; }
    try { await api.put(`/nutrition/water/${editing.id}`, { amount_ml: ml }); setEditing(null); refreshNutrition(); } catch (err) { toast.error(errorMessage(err, "Could not change this drink")); }
  };
  const pct = h.target_ml ? Math.min((h.total_ml / h.target_ml) * 100, 100) : 0;
  return (
    <Card className="p-5" data-testid="hydration-card">
      <div className="flex items-center gap-2"><Droplets className="h-4 w-4 text-sky-500" aria-hidden="true" /><h3 className="font-semibold">Hydration</h3></div>
      <p className="mt-3 text-sm"><span className="stat-num text-2xl font-semibold" data-testid="water-total">{fmt(h.total_ml / 1000, 2)}</span> <span className="text-slate-500">of {h.target_ml ? fmt(h.target_ml / 1000, 1) : "–"} L total water</span></p>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-label="Total water" aria-valuemin={0} aria-valuemax={h.target_ml || 0} aria-valuenow={h.total_ml}>
        <div className="h-full rounded-full bg-sky-500 motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-500">Drinks {fmt(h.drinks_ml)} ml + water in food {fmt(h.food_water_ml)} ml. EFSA's reference counts both.</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[[150, "Cup"], [250, "Glass"], [500, "Bottle"]].map(([ml, label]) => (
          <Button key={ml} type="button" variant="outline" className="h-auto flex-col gap-0.5 py-2" onClick={() => add(ml)} data-testid={`water-add-${ml}`}>
            <GlassWater className="h-4 w-4 text-sky-500" aria-hidden="true" /><span className="text-xs">{label}</span><span className="stat-num text-[11px] text-slate-500">{ml} ml</span>
          </Button>
        ))}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = parseInt(custom, 10); if (v > 0) { add(v); setCustom(""); } }}>
        <Input inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))} placeholder="Other amount (ml)" aria-label="Other amount in millilitres" className="h-9" data-testid="water-custom" />
        <Button type="submit" variant="outline" size="sm" disabled={!custom}>Add</Button>
      </form>
      {h.entries.length > 0 && (
        <ul className="mt-3 space-y-1">
          {h.entries.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2 text-sm">
              {editing?.id === w.id ? (
                <form className="flex flex-1 items-center gap-1.5" onSubmit={saveEdit}>
                  <Input autoFocus inputMode="numeric" value={editing.ml} onChange={(e) => setEditing({ id: w.id, ml: e.target.value.replace(/\D/g, "") })} aria-label="Amount in millilitres" className="h-8 w-24" data-testid="water-edit-input" />
                  <span className="text-slate-500">ml</span>
                  <Button type="submit" variant="ghost" size="icon" className="h-7 w-7" aria-label="Save this amount" data-testid="water-edit-save"><Check className="h-3.5 w-3.5" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Cancel" onClick={() => setEditing(null)}><X className="h-3.5 w-3.5" /></Button>
                </form>
              ) : (
                <>
                  <span className="text-slate-600 dark:text-slate-300">{w.amount_ml} ml <span className="text-slate-400">{w.beverage}{w.eaten_at ? ` · ${w.eaten_at}` : ""}</span></span>
                  <span className="flex shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Change ${w.amount_ml} ml drink`} onClick={() => setEditing({ id: w.id, ml: String(w.amount_ml) })} data-testid={`water-edit-${w.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Remove ${w.amount_ml} ml drink`} onClick={() => remove(w.id)}><X className="h-3.5 w-3.5" /></Button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Insights({ insights, onLog }) {
  const [all, setAll] = useState(false);
  if (!insights?.insights?.length) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-500" aria-hidden="true" /><h3 className="font-semibold">Insights</h3></div>
        <p className="mt-3 text-sm text-slate-500">{insights?.note || "Nothing stands out today. Insights appear when something you have logged is well below its reference or above a guideline limit."}</p>
      </Card>
    );
  }
  return (
    <Card className="p-5" data-testid="insights-card">
      <div className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-500" aria-hidden="true" /><h3 className="font-semibold">Insights</h3></div>
      <ul className="mt-3 space-y-4">
        {(all ? insights.insights : insights.insights.slice(0, 3)).map((i) => (
          <li key={i.nutrient}>
            <p className="text-sm font-medium">{i.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">{i.why}</p>
            {i.foods?.length > 0 && (
              <>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {i.foods.map((f) => (
                    <button key={f.food_id} type="button" onClick={() => onLog(f.food_id)} title={`${fmt(f.amount_per_100g)} per 100 g`}
                      className="rounded-full border border-border px-2.5 py-1 text-xs hover:border-emerald-400 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:hover:bg-emerald-500/10">
                      {f.name.split(",").slice(0, 2).join(",")}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400">{i.foods_note}</p>
              </>
            )}
          </li>
        ))}
      </ul>
      {insights.insights.length > 3 && (
        <Button type="button" variant="ghost" size="sm" className="mt-3 w-full" aria-expanded={all} onClick={() => setAll((v) => !v)} data-testid="insights-more">
          {all ? "Show fewer" : `Show ${insights.insights.length - 3} more`}
        </Button>
      )}
    </Card>
  );
}

export function TodayTab({ day, insights, date, onAdd, onEdit }) {
  const [toDelete, setToDelete] = useState(null);
  const ref = day.progress || {};
  const total = day.totals.energy_kcal;
  const target = day.energy_target;
  const left = target != null && total != null ? target - total : null;
  const byType = Object.fromEntries(day.meals.map((m) => [m.meal_type, m]));

  const remove = async () => {
    try { await api.delete(`/nutrition/diary/${toDelete.id}`); toast.success("Entry deleted"); setToDelete(null); refreshNutrition(); }
    catch (err) { toast.error(errorMessage(err, "Could not delete this entry")); }
  };
  const copyYesterday = async (m) => {
    try {
      const { data } = await api.post("/nutrition/diary/copy", { from_date: shiftDate(date, -1), to_date: date, meal_type: m.key });
      toast.success(`Copied ${data.copied} ${data.copied === 1 ? "item" : "items"} from yesterday's ${m.label.toLowerCase()}`); refreshNutrition();
    } catch (err) { toast.error(errorMessage(err, "Could not copy yesterday's meal")); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-6 lg:col-span-2">
        <QuickAdd date={date} onMore={(foodId, query) => onAdd(undefined, foodId, query)} />
        <Card className="p-5 sm:p-6" data-testid="day-ledger">
          {day.entries === 0 ? (
            <EmptyState icon={Utensils} title="Nothing logged for this day yet"
              sub="Search about 8,000 reference foods, scan a barcode, add a recipe, or type a meal in. Totals and targets fill in as you go."
              action={<Button onClick={() => onAdd()} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="add-first"><Plus className="mr-1 h-4 w-4" />Add food</Button>} />
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="stat-num text-4xl font-semibold tracking-tight" data-testid="energy-total">{fmt(total ?? 0)}<span className="ml-1.5 text-base font-normal text-slate-500">kcal</span></p>
                  <p className="mt-1 text-sm text-slate-500" data-testid="energy-left">
                    {target ? (left >= 0 ? `${fmt(left)} left of ${fmt(target)} kcal` : `${fmt(-left)} over ${fmt(target)} kcal`) : "No energy target set"}
                  </p>
                </div>
                <Button onClick={() => onAdd()} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="add-food"><Plus className="mr-1 h-4 w-4" />Add food</Button>
              </div>
              <div className="mt-5"><EnergyBar meals={day.meals} total={total || 0} target={target || 0} /></div>
              <div className="mt-6 grid gap-5 sm:grid-cols-3">
                {[["protein_g", "Protein"], ["carbs_available_g", "Carbohydrate"], ["fat_g", "Fat"]].map(([k, label]) => {
                  const p = ref[k];
                  return p ? <RangeGauge key={k} testid={`gauge-${k}`} label={label} color={MACRO_COLORS[k]} intake={p.intake || 0} min={p.min} max={p.max} target={p.target} unit="g" missing={p.status === "no_data"} /> : null;
                })}
              </div>
              {day.energy_check && Math.abs(day.energy_check.difference_pct) > 10 && (
                <p className="mt-4 text-xs text-slate-500">Listed energy and the energy the macronutrients add up to differ by {Math.abs(Math.round(day.energy_check.difference_pct))}% today. That is normal when label and database values are mixed; the listed energy is what is counted.</p>
              )}
              {day.reference?.notes?.length > 0 && (
                <p className="mt-3 text-xs text-slate-500">{day.reference.notes[0]} <span className="text-slate-400">Set your details under Goals.</span></p>
              )}
            </>
          )}
        </Card>

        <Suggestions date={date} />

        {MEALS.filter((m) => m.key !== "other" || byType.other).map((m) => {
          const g = byType[m.key];
          return (
            <Card key={m.key} className="overflow-hidden" data-testid={`meal-${m.key}`}>
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
                <div className="flex items-center gap-2.5">
                  <span className="h-6 w-1.5 rounded-full" style={{ background: m.color }} aria-hidden="true" />
                  <h3 className="font-semibold">{m.label}</h3>
                  {g && <span className="stat-num text-sm text-slate-500">{fmt(g.totals.energy_kcal || 0)} kcal</span>}
                </div>
                <div className="flex items-center gap-1">
                  {!g && m.key !== "other" && <Button variant="ghost" size="sm" onClick={() => copyYesterday(m)} aria-label={`Copy yesterday's ${m.label.toLowerCase()}`} data-testid={`copy-${m.key}`}><History className="mr-1 h-4 w-4" />Copy yesterday</Button>}
                  <Button variant="ghost" size="sm" onClick={() => onAdd(m.key)} aria-label={`Add food to ${m.label.toLowerCase()}`} data-testid={`add-${m.key}`}><Plus className="mr-1 h-4 w-4" />Add</Button>
                </div>
              </div>
              {g ? <div className="divide-y divide-border">{g.entries.map((e) => <EntryRow key={e.id} entry={e} date={date} onEdit={onEdit} onDelete={setToDelete} />)}</div>
                : <p className="px-5 py-4 text-sm text-slate-400">Nothing logged.</p>}
            </Card>
          );
        })}
      </div>

      <div className="min-w-0 space-y-6">
        <Hydration day={day} date={date} />
        <Insights insights={insights} onLog={(id) => onAdd(undefined, id)} />
        {day.quality && Object.keys(day.quality).length > 0 && (
          <Card className="p-5">
            <h3 className="font-semibold">Where today's numbers come from</h3>
            <ul className="mt-3 space-y-1.5 text-sm">
              {Object.entries(day.quality).map(([q, n]) => (
                <li key={q} className="flex items-center justify-between"><QualityBadge quality={q} /><span className="text-slate-500">{n} {n === 1 ? "entry" : "entries"}</span></li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">Typed-in and estimated entries are counted, but they may lack vitamins and minerals. The Nutrients tab shows exactly how complete each value is.</p>
          </Card>
        )}
      </div>

      <ConfirmDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)} title="Delete this entry?"
        description={toDelete ? `This removes "${toDelete.description}" from ${MEAL_BY_KEY[toDelete.meal_type]?.label.toLowerCase()} on this day.` : ""}
        onConfirm={remove} confirmText="Delete" variant="danger" />
    </div>
  );
}
