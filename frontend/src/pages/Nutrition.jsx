import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, Leaf, Plus, Sparkles, Sun, Target, UtensilsCrossed, Utensils } from "lucide-react";
import { useFetch } from "@/lib/useFetch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DatePicker } from "@/components/ui/date-picker";
import { openAI } from "@/components/AppShell";
import { FoodDialog } from "./nutrition/FoodDialog";
import { TodayTab, PLACEHOLDER_DAY } from "./nutrition/TodayTab";
import { PlanTab } from "./nutrition/PlanTab";
import { NutrientsTab } from "./nutrition/NutrientsTab";
import { TrendsTab } from "./nutrition/TrendsTab";
import { FoodsTab } from "./nutrition/FoodsTab";
import { GoalsTab } from "./nutrition/GoalsTab";
import { ReminderBanner } from "./nutrition/Reminders";
import { prettyDate, shiftDate } from "./nutrition/shared";
import { QuickAdd } from "./nutrition/QuickAdd";
import { NutritionOrb, MacroChips } from "./nutrition/Orb";
import { QuickWater } from "./nutrition/QuickWater";
import { cn } from "@/lib/utils";

const TABS = [
  ["today", "Today", Sun], ["plan", "Plan", CalendarDays], ["nutrients", "Nutrients", Leaf], ["trends", "Trends", BarChart3], ["foods", "Foods", UtensilsCrossed], ["goals", "Goals", Target],
];
const DAY_TABS = new Set(["today", "nutrients", "trends"]); // the tabs that look at one chosen day
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export default function Nutrition() {
  // The tab and the day live in the address (?tab=plan&date=2026-10-30), so refresh, Back and a shared link all land in the same place.
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get("tab")) ? params.get("tab") : "today";
  const pickedDate = ISO.test(params.get("date") || "") ? params.get("date") : null; // null = "today" as the server sees it (the profile's time zone)
  // Compared with the live address, not the last render: a click can fire two handlers before React re-renders, and each used to add a history entry.
  const setUrl = (patch) => {
    const cur = new URLSearchParams(window.location.search);
    const next = new URLSearchParams(cur);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    if (next.toString() !== cur.toString()) setParams(next);
  };
  const [dialog, setDialog] = useState({ open: false });
  const { data: day } = useFetch(`/nutrition/day${pickedDate ? `?date=${pickedDate}` : ""}`);
  // Remember the last known "today": while another day is loading `day` is empty, but the header still needs it.
  const todayRef = useRef(null);
  if (day?.today) todayRef.current = day.today;
  const today = todayRef.current;
  const date = pickedDate || day?.today || todayRef.current || null;
  const { data: insights, loading: insightsLoading } = useFetch(date && tab === "today" ? `/nutrition/insights?date=${date}` : null);

  const openAdd = (meal, foodId, query) => setDialog({ open: true, meal, foodId, initialQuery: query, entry: null, planning: false });
  const openPlan = (planDate, foodId, recipeId) => setDialog({ open: true, planning: true, date: planDate, foodId, recipeId, entry: null });
  const go = (d) => setUrl({ date: d === today ? null : d });
  const showSide = DAY_TABS.has(tab);                 // the orb and the day's figures stay beside every view that looks at one day
  const sideDay = day || PLACEHOLDER_DAY;
  const sideLoading = !day;
  const isToday = !pickedDate || pickedDate === today;

  return (
    <div className="space-y-6 pb-20 sm:pb-0" /* room for the floating assistant button under the last row on a phone */>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 basis-64 flex-1">
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl">Nutrition</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">What you eat, what it contains, and how it compares with the references</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => openAI("Log a meal: ")} aria-label="Ask the assistant" data-testid="nutrition-ai"><Sparkles className="mr-1.5 h-4 w-4 text-emerald-700" />Assistant</Button>
          <Button size="sm" onClick={() => openAdd()} className="bg-emerald-700 text-white hover:bg-emerald-800" data-testid="header-add-food"><Plus className="mr-1 h-4 w-4" />Add food</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setUrl({ tab: v === "today" ? null : v })}>
        <div className={cn("grid gap-6 lg:gap-10", showSide && "lg:grid-cols-[minmax(0,21.5rem)_minmax(0,1fr)]")}>
          {showSide && (
            <aside aria-label="The day" data-testid="day-ledger" className="min-w-0 lg:sticky lg:top-24 lg:self-start"
              {...(sideLoading ? { "data-skeleton": "", inert: "true", "aria-hidden": "true" } : {})}>
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center rounded-full border border-line-strong bg-field" role="group" aria-label="Choose day">
                    <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Previous day" disabled={!date} onClick={() => go(shiftDate(date, -1))} data-testid="day-prev"><ChevronLeft className="h-4 w-4" /></Button>
                    <div className="w-40"><DatePicker value={date || ""} onChange={(v) => v && go(v)} clearable={false} aria-label="Day" /></div>
                    <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Next day" disabled={!date} onClick={() => go(shiftDate(date, 1))} data-testid="day-next"><ChevronRight className="h-4 w-4" /></Button>
                  </div>
                  {date && date !== today && <Button variant="outline" size="sm" onClick={() => setUrl({ date: null })} data-testid="day-today">Today</Button>}
                  {date && date !== today && <p className="text-sm text-muted-foreground" data-testid="day-label">{prettyDate(date, today)} · {date}</p>}
                </div>
                <NutritionOrb day={sideDay} loading={sideLoading} />
                <MacroChips day={sideDay} loading={sideLoading} />
                <QuickWater day={sideDay} date={date} loading={sideLoading} />
                {!sideLoading && day.entries === 0 && (
                  <div className="rounded-3xl border border-dashed border-line-strong px-5 py-6 text-center">
                    <span className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-line bg-field text-accent-ink"><Utensils className="h-5 w-5" aria-hidden="true" /></span>
                    <p className="mt-3 font-semibold">Nothing logged for this day yet</p>
                    <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">Search about 8,000 reference foods, scan a barcode, add a recipe, or type a meal in. Totals and targets fill in as you go.</p>
                    <Button onClick={() => openAdd()} className="mt-4" data-testid="add-first"><Plus className="mr-1 h-4 w-4" />Add food</Button>
                  </div>
                )}
              </div>
            </aside>
          )}

          <div className="min-w-0">
            <QuickAdd date={date} onMore={(foodId, query) => openAdd(undefined, foodId, query)} />
            <TabsList className="mt-5 h-11 w-full justify-start overflow-x-auto scrollbar-hide sm:w-auto">
              {TABS.map(([k, label, Icon]) => (
                <TabsTrigger key={k} value={k} data-testid={`tab-${k}`}
                  className="relative isolate flex-1 shrink-0 gap-1.5 sm:flex-none data-[state=active]:!bg-none data-[state=active]:!shadow-none">
                  <span aria-hidden="true" className={cn("absolute inset-0 -z-10 rounded-full pill-fill transition-opacity duration-200 ease-in-out motion-reduce:transition-none", tab === k ? "opacity-100" : "opacity-0")} />
                  <Icon className="h-4 w-4" aria-hidden="true" />{label}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="mt-6">
              {!day && DAY_TABS.has(tab) && tab !== "today" && (
                <div className="grid gap-6" role="status" aria-busy="true" aria-label="Loading the day"><div className="skeleton h-64 rounded-3xl" /></div>
              )}
              <TabsContent value="today" className="mt-0 space-y-6">
                {isToday && <ReminderBanner onLogMeal={(meal) => openAdd(meal)} />}
                {day ? <TodayTab day={day} insights={insights} insightsLoading={insightsLoading && !insights} date={date} isToday={isToday} onAdd={openAdd} onEdit={(entry) => setDialog({ open: true, entry, planning: false })} />
                  : <div role="status" aria-busy="true" aria-label="Loading the day"><TodayTab loading day={PLACEHOLDER_DAY} date={date} isToday={isToday} onAdd={() => {}} onEdit={() => {}} /></div>}
              </TabsContent>
              <TabsContent value="plan" className="mt-0">{today && <PlanTab anchor={pickedDate || today} today={today} onAdd={(d) => openPlan(d)} onEdit={(item) => setDialog({ open: true, planning: true, entry: item })} />}</TabsContent>
              <TabsContent value="nutrients" className="mt-0">{day && <NutrientsTab day={day} />}</TabsContent>
              <TabsContent value="trends" className="mt-0">{day && date && <TrendsTab date={date} today={today} energyTarget={day.energy_target} />}</TabsContent>
              <TabsContent value="foods" className="mt-0"><FoodsTab date={pickedDate || undefined} onLog={(id) => openAdd(undefined, id)} onPlan={(id) => openPlan(today, id)} onPlanRecipe={(id) => openPlan(today, undefined, id)} /></TabsContent>
              <TabsContent value="goals" className="mt-0"><GoalsTab /></TabsContent>
            </div>
          </div>
        </div>
      </Tabs>

      <FoodDialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} planning={!!dialog.planning}
        date={dialog.planning ? (dialog.entry?.date || dialog.date || today || undefined) : (date || undefined)}
        defaultMealType={dialog.meal} entry={dialog.entry} initialFoodId={dialog.foodId} initialRecipeId={dialog.recipeId} initialQuery={dialog.initialQuery} />
    </div>
  );
}
