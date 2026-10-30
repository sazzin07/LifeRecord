import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";
import { Card } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RemindersSettings } from "./Reminders";
import { SRC_LABEL, fmt, upperLevelText, useNutrientMeta, refreshNutrition } from "./shared";

const ACTIVITY = { sedentary: "Mostly sitting (PAL 1.4)", moderate: "Moderately active (PAL 1.6)", active: "Active (PAL 1.8)", very_active: "Very active (PAL 2.0)" };
const PREGNANCY = { pregnant_t1: "Pregnant, first trimester", pregnant_t2: "Pregnant, second trimester", pregnant_t3: "Pregnant, third trimester", lactating_0_6: "Breastfeeding, first 6 months", lactating_6plus: "Breastfeeding, after 6 months" };
const NONE = "__none";
const KIND = { PRI: "Population reference intake", AI: "Adequate intake", RI: "Reference range", AR: "Average requirement", limit: "Guideline limit", ref: "Labelling reference" };

function ProfileForm({ profile }) {
  const [f, setF] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    if (!profile) return;
    setF({ birth_year: profile.birth_year ?? "", sex: profile.sex ?? NONE, height_cm: profile.height_cm ?? "", weight_kg: profile.weight_kg ?? "", activity: profile.activity ?? NONE,
      pregnancy: profile.pregnancy ?? NONE, diet_tags: profile.diet_tags || [], allergies: (profile.allergies || []).join(", "), timezone: profile.timezone || "" });
  }, [profile]);
  if (!f) return <div className="skeleton h-64 rounded-2xl" aria-busy="true" />;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const nullable = (v) => (v === NONE || v === "" ? null : v);
  const save = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      await api.put("/nutrition/profile", {
        birth_year: f.birth_year === "" ? null : parseInt(f.birth_year, 10), sex: nullable(f.sex), height_cm: f.height_cm === "" ? null : parseFloat(f.height_cm),
        weight_kg: f.weight_kg === "" ? null : parseFloat(f.weight_kg), activity: nullable(f.activity), pregnancy: f.sex === "F" ? nullable(f.pregnancy) : null,
        diet_tags: f.diet_tags, allergies: f.allergies.split(",").map((s) => s.trim()).filter(Boolean), timezone: f.timezone || null });
      toast.success("Details saved. Suggested targets updated."); refreshNutrition();
    } catch (err) {
      const d = err.response?.data?.detail;
      toast.error(typeof d === "string" ? d : Array.isArray(d) ? "Please check the highlighted values" : "Could not save your details");
    } finally { setSaving(false); }
  };
  const clear = async () => {
    try { await api.delete("/nutrition/profile"); toast.success("Your nutrition details were removed"); setConfirmClear(false); refreshNutrition(); } catch (err) { toast.error(errorMessage(err, "Could not remove your details")); }
  };
  const field = "mt-1 h-10";
  return (
    <Card className="p-5" data-testid="profile-form">
      <h3 className="font-semibold">About you</h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Optional. These details are used only to pick reference values and stay in your account. Leave a field empty if you prefer not to say; general adult values are used where something is missing.</p>
      <form onSubmit={save} className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div><Label htmlFor="p-year">Birth year</Label><Input id="p-year" inputMode="numeric" value={f.birth_year} onChange={(e) => set("birth_year")(e.target.value.replace(/\D/g, "").slice(0, 4))} className={field} data-testid="profile-year" /></div>
          <div><Label htmlFor="p-sex">Sex (for the reference tables)</Label>
            <Select value={f.sex} onValueChange={set("sex")}><SelectTrigger id="p-sex" className={field} data-testid="profile-sex"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>Prefer not to say</SelectItem><SelectItem value="F">Female</SelectItem><SelectItem value="M">Male</SelectItem></SelectContent></Select></div>
          <div><Label htmlFor="p-h">Height (cm)</Label><Input id="p-h" inputMode="decimal" value={f.height_cm} onChange={(e) => set("height_cm")(e.target.value.replace(",", "."))} className={field} /></div>
          <div><Label htmlFor="p-w">Weight (kg)</Label><Input id="p-w" inputMode="decimal" value={f.weight_kg} onChange={(e) => set("weight_kg")(e.target.value.replace(",", "."))} placeholder="uses your latest weigh-in" className={field} data-testid="profile-weight" /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="p-act">Activity level</Label>
            <Select value={f.activity} onValueChange={set("activity")}><SelectTrigger id="p-act" className={field} data-testid="profile-activity"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>Not set (assume moderate)</SelectItem>{Object.entries(ACTIVITY).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
          {f.sex === "F" && (
            <div><Label htmlFor="p-preg">Pregnancy or breastfeeding</Label>
              <Select value={f.pregnancy} onValueChange={set("pregnancy")}><SelectTrigger id="p-preg" className={field}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value={NONE}>Not applicable</SelectItem>{Object.entries(PREGNANCY).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
          )}
        </div>
        <fieldset>
          <legend className="text-sm font-medium">Diet choices</legend>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {["vegan", "vegetarian", "gluten-free", "lactose-free"].map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm"><Checkbox checked={f.diet_tags.includes(t)} onCheckedChange={(c) => set("diet_tags")(c ? [...f.diet_tags, t] : f.diet_tags.filter((x) => x !== t))} />{t}</label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">Used to filter food suggestions and flag foods by name. Always check labels: this app cannot see ingredient lists for generic foods.</p>
        </fieldset>
        <div><Label htmlFor="p-all">Allergies or foods to avoid (comma separated)</Label><Input id="p-all" value={f.allergies} onChange={(e) => set("allergies")(e.target.value)} placeholder="peanut, shellfish" className={field} data-testid="profile-allergies" /></div>
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
          <div><Label htmlFor="p-tz">Time zone (decides which day "today" is)</Label><Input id="p-tz" value={f.timezone} onChange={(e) => set("timezone")(e.target.value)} placeholder={deviceTz} className={field} /></div>
          <Button type="button" variant="outline" onClick={() => set("timezone")(deviceTz)}>Use this device's</Button>
        </div>
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="ghost" className="text-red-600 dark:text-red-400" onClick={() => setConfirmClear(true)} disabled={!profile.exists}>Remove my details</Button>
          <Button type="submit" disabled={saving} className="bg-emerald-700 text-white hover:bg-emerald-800" data-testid="profile-save">Save details</Button>
        </div>
      </form>
      <ConfirmDialog open={confirmClear} onOpenChange={setConfirmClear} title="Remove your nutrition details?" description="Your profile and any targets you set yourself are deleted. Your diary is not touched." onConfirm={clear} confirmText="Remove" variant="danger" />
    </Card>
  );
}

function TargetDialog({ item, byKey, onClose }) {
  const [v, setV] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (item) setV({ min: item.min ?? "", target: item.target ?? "", max: item.max ?? "" }); }, [item]);
  if (!item) return null;
  const info = byKey[item.key] || {};
  const num = (x) => (x === "" ? undefined : parseFloat(x));
  const save = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      const { data } = await api.put(`/nutrition/targets/${item.key}`, { min: num(v.min), target: num(v.target), max: num(v.max) });
      if (data.warning) toast.warning(data.warning, { duration: 12000 }); else toast.success(`${info.name} target saved`);
      refreshNutrition(); onClose();
    } catch (err) { const d = err.response?.data?.detail; toast.error(typeof d === "string" ? d : "Check the values: minimum ≤ target ≤ maximum"); } finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="target-dialog">
        <DialogHeader><DialogTitle>Your {info.name?.toLowerCase()} target</DialogTitle>
          <DialogDescription>Suggested: {item.suggested.min != null && item.suggested.max != null ? `${fmt(item.suggested.min)}–${fmt(item.suggested.max)}` : fmt(item.suggested.target ?? item.suggested.max)} {item.unit} ({KIND[item.kind]}, {SRC_LABEL[item.source]}). Your own values always replace the suggestion and are never changed silently.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[["min", "Minimum"], ["target", "Target"], ["max", "Maximum"]].map(([k, l]) => (
              <div key={k}><Label htmlFor={`t-${k}`}>{l}</Label><Input id={`t-${k}`} inputMode="decimal" value={v[k] ?? ""} onChange={(e) => setV({ ...v, [k]: e.target.value.replace(",", ".") })} className="mt-1 h-10" data-testid={`target-${k}`} /></div>
            ))}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Unit: {item.unit}. Fill in only what you want to set.</p>
          <div className="flex justify-end"><Button type="submit" disabled={saving} className="bg-emerald-700 text-white hover:bg-emerald-800" data-testid="target-save">Save target</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GoalsTab() {
  const { data: profile } = useFetch("/nutrition/profile");
  const { data: t } = useFetch("/nutrition/targets");
  const { byKey } = useNutrientMeta();
  const [editing, setEditing] = useState(null);
  const reset = async (k) => {
    try { await api.delete(`/nutrition/targets/${k}`); toast.success("Back to the suggested value"); refreshNutrition(); } catch (err) { toast.error(errorMessage(err, "Could not reset")); }
  };
  const order = ["energy_kcal", "protein_g", "carbs_available_g", "fat_g", "fiber_g", "sat_fat_g", "sugars_g", "sodium_mg", "epa_dha_mg", "calcium_mg", "iron_mg", "magnesium_mg", "potassium_mg", "zinc_mg", "vit_a_ug", "vit_c_mg", "vit_d_ug", "vit_b12_ug", "folate_ug"];
  const items = t ? [...order.filter((k) => t.items[k]), ...Object.keys(t.items).filter((k) => !order.includes(k) && k !== "water_ml")].map((k) => ({ key: k, ...t.items[k] })) : [];
  return (
    <div className="space-y-6" data-testid="goals-tab">
      <ProfileForm profile={profile} />
      <RemindersSettings timezone={profile?.timezone} />
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3 sm:px-5">
          <h3 className="font-semibold">Targets</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{!t ? "Loading…" : t.supported === false ? "" : t.personalised ? "Suggested for your details, from EFSA's dietary reference values." : "General adult values. Add your birth year and sex above for personalised ones."}</p>
        </div>
        {t && t.supported === false ? (
          <div className="flex gap-3 p-5 text-sm"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" /><p>{t.notes[0]}</p></div>
        ) : !t ? <div className="skeleton m-5 h-48 rounded-2xl" aria-busy="true" /> : (
          <>
            {t.notes.length > 0 && <ul className="space-y-1 border-b border-border bg-amber-50/60 px-5 py-3 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">{t.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
            <div className="divide-y divide-border">
              {items.map((it) => (
                <div key={it.key} className="flex items-center gap-3 px-4 py-3 text-sm sm:px-5" data-testid={`goal-${it.key}`}>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{byKey[it.key]?.name || it.key}{it.overridden && <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Your target</span>}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{KIND[it.kind]} · {SRC_LABEL[it.source]}</p>
                    {upperLevelText(it.upper, it.unit) && <p className="text-xs text-slate-500 dark:text-slate-400" data-testid={`goal-upper-${it.key}`}>{upperLevelText(it.upper, it.unit)}</p>}
                  </div>
                  <p className="stat-num shrink-0 text-right">
                    {it.min != null && it.max != null ? `${fmt(it.min)}–${fmt(it.max)}` : it.target != null ? fmt(it.target) : it.max != null ? `≤ ${fmt(it.max)}` : "–"} <span className="text-xs text-slate-500 dark:text-slate-400">{it.unit}</span>
                  </p>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Edit ${byKey[it.key]?.name} target`} onClick={() => setEditing(it)} data-testid={`goal-edit-${it.key}`}><Pencil className="h-4 w-4" /></Button>
                  {it.overridden ? <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Reset ${byKey[it.key]?.name} to suggested`} onClick={() => reset(it.key)}><RotateCcw className="h-4 w-4" /></Button> : <span className="h-8 w-8" aria-hidden="true" />}
                </div>
              ))}
            </div>
            <p className="border-t border-border px-5 py-4 text-xs text-slate-500 dark:text-slate-400">{t.disclaimer}</p>
          </>
        )}
      </Card>
      {t?.sources?.length > 0 && (
        <Card className="p-5" data-testid="sources-card">
          <h3 className="font-semibold">Where the numbers come from</h3>
          <ul className="mt-3 space-y-3 text-sm">
            {t.sources.map((s) => (
              <li key={s.title}>
                <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-emerald-700 hover:underline dark:text-emerald-400">{s.title}<ExternalLink className="h-3 w-3" aria-hidden="true" /></a>
                <p className="text-xs text-slate-500 dark:text-slate-400">{s.publisher}, {s.published}{s.id ? `, ${s.id}` : ""}. Applies to: {s.population}.</p>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">Food data: USDA FoodData Central (Foundation Foods 2025-12-18 and SR Legacy 2018, public domain) and Open Food Facts (community data, ODbL), with every food's source shown. Not included: babies under 1 year, pregnancy or breastfeeding under 18, supplements and medical conditions. Upper levels are EFSA's, shown beside a target where EFSA gives one.</p>
        </Card>
      )}
      <TargetDialog item={editing} byKey={byKey} onClose={() => setEditing(null)} />
    </div>
  );
}
