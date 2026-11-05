import { useState } from "react";
import { Check, Copy, Droplets, GlassWater, History, Lightbulb, MoreHorizontal, Pencil, Plus, Trash2, X, ArrowRightLeft, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { Card } from "@/components/common";
import { InfoTip } from "@/components/InfoTip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DayCurve } from "./DayCurve";
import { Suggestions } from "./Suggestions";
import { MEALS, MEAL_BY_KEY, MACRO_COLORS, RangeGauge, QualityBadge, UpperLevelBanner, fmt, shiftDate, refreshNutrition, useNutrientMeta } from "./shared";

function EntryRow({ entry, date, onEdit, onDelete }) {
  const n = entry.nutrients || {};
  const act = async (fn, ok) => {
    try { await fn(); toast.success(ok); refreshNutrition(); } catch (err) { toast.error(errorMessage(err, "That did not work")); }
  };
  return (
    <div className="group flex items-center gap-3 px-4 py-3 sm:px-5" data-testid={`entry-${entry.id}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" data-testid="entry-name">{entry.description}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
          {entry.quantity != null && <span>{fmt(entry.quantity)} {entry.unit === "serving" ? "serving" + (entry.quantity === 1 ? "" : "s") : entry.unit}{entry.grams && entry.unit !== "g" ? ` · ${fmt(entry.grams)} g` : ""}</span>}
          {entry.eaten_at && <span>{entry.eaten_at}</span>}
          <span>{n.protein_g != null ? `P ${fmt(n.protein_g)}` : "P –"} · {n.carbs_g != null ? `C ${fmt(n.carbs_g)}` : "C –"} · {n.fat_g != null ? `F ${fmt(n.fat_g)}` : "F –"}</span>
          {entry.quality !== "verified" && <QualityBadge quality={entry.quality} />}
        </p>
      </div>
      <p className="stat-num shrink-0 text-sm font-semibold">{n.energy_kcal != null ? fmt(n.energy_kcal) : "–"}<span className="text-xs font-normal text-slate-500 dark:text-slate-400"> kcal</span></p>
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
          <DropdownMenuItem className="text-red-600 dark:text-red-400 focus:text-red-600" onSelect={() => onDelete(entry)} data-testid="entry-delete"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function Hydration({ day, date, loading }) {
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
      <p className="mt-3 text-sm"><span className="stat-num text-2xl font-semibold" data-testid="water-total">{fmt(h.total_ml / 1000, 2)}</span> <span className="text-slate-500 dark:text-slate-400">{loading ? <span className="sk-ph">of 0.0 L total water</span> : <>of {h.target_ml ? fmt(h.target_ml / 1000, 1) : "–"} L total water</>}</span></p>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-label="Total water" aria-valuemin={0} aria-valuemax={h.target_ml || 0} aria-valuenow={h.total_ml}>
        <div className="h-full rounded-full bg-sky-500 motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 flex items-center gap-0.5 text-xs text-muted-foreground">{loading ? <span className="sk-ph">Drinks 000 ml + food 000 ml</span> : <>Drinks {fmt(h.drinks_ml)} ml + food {fmt(h.food_water_ml)} ml<InfoTip label="About total water">EFSA's reference for total water counts both the drinks you log and the water in food.</InfoTip></>}</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[[150, "Cup"], [250, "Glass"], [500, "Bottle"]].map(([ml, label]) => (
          <Button key={ml} type="button" variant="outline" className="h-auto flex-col gap-0.5 py-2" onClick={() => add(ml)} data-testid={`water-add-${ml}`}>
            <GlassWater className="h-4 w-4 text-sky-500" aria-hidden="true" /><span className="text-xs">{label}</span><span className="stat-num text-[11px] text-slate-500 dark:text-slate-400">{ml} ml</span>
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
                  <span className="text-slate-500 dark:text-slate-400">ml</span>
                  <Button type="submit" variant="ghost" size="icon" className="h-7 w-7" aria-label="Save this amount" data-testid="water-edit-save"><Check className="h-3.5 w-3.5" /></Button>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Cancel" onClick={() => setEditing(null)}><X className="h-3.5 w-3.5" /></Button>
                </form>
              ) : (
                <>
                  <span className="text-slate-600 dark:text-slate-300">{w.amount_ml} ml <span className="text-slate-500 dark:text-slate-400">{w.beverage}{w.eaten_at ? ` · ${w.eaten_at}` : ""}</span></span>
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

/**
 * An insight's reason, shortened: the first sentence stays ("0 of 95 mg (0%) from what you have logged"), a missing-data warning stays as a few words because a low
 * figure could mislead without it, and the rest ("a low recorded intake for one day is not a deficiency") sits behind the (i).
 */
function Why({ text }) {
  const main = (text.match(/^(.*?)(?:;\s|\.\s(?=[A-Z])|\.?$)/) || [null, text])[1];
  const rest = text.slice(main.length).replace(/^[;.]\s*/, "");
  const gap = rest.match(/(\d+) of (\d+) entries have no/);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs leading-relaxed text-muted-foreground">
      <span>{main}.</span>
      {gap && <span className="text-amber-700 dark:text-amber-400">{gap[1]} of {gap[2]} entries have no data.</span>}
      {rest && <InfoTip label="More about this" className="-my-1">{rest}</InfoTip>}
    </p>
  );
}

function Insights({ insights, onLog, loading }) {
  const [all, setAll] = useState(false);
  if (loading) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-500" aria-hidden="true" /><h3 className="font-semibold">Insights</h3></div>
        <p className="mt-3 text-sm"><span className="sk-ph">Nothing stands out today. Insights appear when something you have logged is well below its reference or above a guideline limit.</span></p>
      </Card>
    );
  }
  if (!insights?.insights?.length) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-500" aria-hidden="true" /><h3 className="font-semibold">Insights</h3></div>
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{insights?.note || "Nothing stands out today. Insights appear when something you have logged is well below its reference or above a guideline limit."}</p>
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
            <Why text={i.why} />
            {i.foods?.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {i.foods.map((f) => (
                  <button key={f.food_id} type="button" onClick={() => onLog(f.food_id)} title={`${fmt(f.amount_per_100g)} per 100 g`}
                    className="rounded-full border border-line px-2.5 py-1 text-xs transition-colors duration-200 hover:border-line-strong hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {f.name.split(",").slice(0, 2).join(",")}
                  </button>
                ))}
                {i.foods_note && <InfoTip label="About these foods">{i.foods_note}</InfoTip>}
              </div>
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

/** What the day view is drawn from while the real day is on its way: the same components with nothing in them, so the loading page is the loaded page. */
export const PLACEHOLDER_DAY = {
  entries: 1, totals: { energy_kcal: 0 }, energy_target: 2000, meals: [], upper_exceeded: [], quality: null, energy_check: null, reference: null,
  progress: { protein_g: { intake: 0, target: 1, status: "ok" }, carbs_available_g: { intake: 0, target: 1, status: "ok" }, fat_g: { intake: 0, target: 1, status: "ok" } },
  hydration: { total_ml: 0, target_ml: 2500, drinks_ml: 0, food_water_ml: 0, entries: [] },
};

export function TodayTab({ day, insights, date, isToday = true, onAdd, onEdit, loading = false, insightsLoading = false }) {
  const [toDelete, setToDelete] = useState(null);
  const ref = day.progress || {};
  const { byKey } = useNutrientMeta();
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
    <div className="min-w-0 space-y-8" {...(loading ? { "data-skeleton": "", inert: true, "aria-hidden": "true" } : {})}>
      <DayCurve day={day} isToday={isToday} loading={loading} />

      <section aria-label="Macronutrients against their ranges" className="grid gap-5 sm:grid-cols-3">
        {[["protein_g", "Protein"], ["carbs_available_g", "Carbohydrate"], ["fat_g", "Fat"]].map(([k, label]) => {
          const p = ref[k];
          return p ? <RangeGauge key={k} testid={`gauge-${k}`} label={label} color={MACRO_COLORS[k]} intake={p.intake || 0} min={p.min} max={p.max} target={p.target} unit="g" missing={!loading && p.status === "no_data"} loading={loading} /> : null;
        })}
        {loading && <div className="h-6 sm:col-span-3" aria-hidden="true" />}   {/* the row that says how the references were chosen has its place while the day loads */}
        {(day.reference?.notes?.length > 0 || (day.energy_check && Math.abs(day.energy_check.difference_pct) > 10)) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground sm:col-span-3">
            {day.reference?.notes?.length > 0 && (
              <span className="inline-flex items-center gap-0.5">About these references<InfoTip label="About these references">{day.reference.notes[0]} Set your details under Goals.</InfoTip></span>
            )}
            {day.energy_check && Math.abs(day.energy_check.difference_pct) > 10 && (
              <span className="inline-flex items-center gap-0.5">Energy differs by {Math.abs(Math.round(day.energy_check.difference_pct))}%<InfoTip label="About the energy difference">Listed energy and the energy the macronutrients add up to differ by {Math.abs(Math.round(day.energy_check.difference_pct))}% today. That is normal when label and database values are mixed; the listed energy is what is counted.</InfoTip></span>
            )}
          </div>
        )}
      </section>

      <UpperLevelBanner items={day.upper_exceeded} byKey={byKey} />

      <Suggestions date={date} />

      <Card className="overflow-hidden" data-testid="day-log">
        {MEALS.filter((m) => m.key !== "other" || byType.other).map((m, i) => {
          const g = byType[m.key];
          return (
            <section key={m.key} className={i ? "border-t border-line" : ""} data-testid={`meal-${m.key}`}>
              <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
                <div className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} aria-hidden="true" />
                  <h3 className="text-[1.0625rem] font-semibold">{m.label}</h3>
                  {g && <span className="stat-num text-sm text-muted-foreground">{fmt(g.totals.energy_kcal || 0)} kcal</span>}
                </div>
                <div className="flex items-center gap-1">
                  {!g && m.key !== "other" && <Button variant="ghost" size="sm" onClick={() => copyYesterday(m)} aria-label={`Copy yesterday's ${m.label.toLowerCase()}`} data-testid={`copy-${m.key}`}><History className="mr-1 h-4 w-4" />Copy yesterday</Button>}
                  <Button variant="ghost" size="sm" onClick={() => onAdd(m.key)} aria-label={`Add food to ${m.label.toLowerCase()}`} data-testid={`add-${m.key}`}><Plus className="mr-1 h-4 w-4" />Add</Button>
                </div>
              </div>
              {g ? <div className="divide-y divide-line">{g.entries.map((e) => <EntryRow key={e.id} entry={e} date={date} onEdit={onEdit} onDelete={setToDelete} />)}</div>
                : <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-6">{loading ? <span className="sk-ph">Nothing logged.</span> : "Nothing logged."}</p>}
            </section>
          );
        })}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Hydration day={day} date={date} loading={loading} />
        <Insights insights={insights} onLog={(id) => onAdd(undefined, id)} loading={loading || insightsLoading} />
      </div>
      {day.quality && Object.keys(day.quality).length > 0 && (
        <Card className="p-5">
          <h3 className="font-semibold">Where today's numbers come from</h3>
          <ul className="mt-3 space-y-1.5 text-sm">
            {Object.entries(day.quality).map(([q, n]) => (
              <li key={q} className="flex items-center justify-between"><QualityBadge quality={q} /><span className="text-muted-foreground">{n} {n === 1 ? "entry" : "entries"}</span></li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">Typed-in and estimated entries are counted but may lack vitamins and minerals.</p>
        </Card>
      )}

      <ConfirmDialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)} title="Delete this entry?"
        description={toDelete ? `This removes "${toDelete.description}" from ${MEAL_BY_KEY[toDelete.meal_type]?.label.toLowerCase()} on this day.` : ""}
        onConfirm={remove} confirmText="Delete" variant="danger" />
    </div>
  );
}
