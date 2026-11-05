import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { BarChart3, CalendarDays, Leaf, Plus, Sun, Target, UtensilsCrossed } from "lucide-react";
import { useFetch } from "@/lib/useFetch";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useSettings } from "@/context/SettingsContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FoodDialog } from "./nutrition/FoodDialog";
import { TodayTab, PLACEHOLDER_DAY } from "./nutrition/TodayTab";
import { PlanTab } from "./nutrition/PlanTab";
import { NutrientsTab } from "./nutrition/NutrientsTab";
import { TrendsTab } from "./nutrition/TrendsTab";
import { FoodsTab } from "./nutrition/FoodsTab";
import { GoalsTab } from "./nutrition/GoalsTab";
import { ReminderBanner } from "./nutrition/Reminders";
import { QuickAdd } from "./nutrition/QuickAdd";
import { DayPanel, DayNav } from "./nutrition/DayPanel";
import { DayStrip } from "./nutrition/DayStrip";
import { cn } from "@/lib/utils";

const TABS = [
  ["today", "Today", Sun], ["plan", "Plan", CalendarDays], ["nutrients", "Nutrients", Leaf], ["trends", "Trends", BarChart3], ["foods", "Foods", UtensilsCrossed], ["goals", "Goals", Target],
];
// The day panel (the rings and the day's figures) stays beside every tab that looks at a day; Plan (a week of intentions) and Goals (settings) use the whole width.
const PANEL_TABS = new Set(["today", "nutrients", "trends", "foods"]);
const NEEDS_DAY = new Set(["nutrients", "trends"]);       // these tabs draw from the day's data, so they wait for it
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const PANEL_W = "clamp(17rem, 24vw, 22rem)";              // the panel's width: a fixed-feeling column that still gives way on a narrow desktop

export default function Nutrition() {
  // The tab and the day live in the address (?tab=plan&date=2026-10-30), so refresh, Back and a shared link all land in the same place.
  const [params, setParams] = useSearchParams();
  const { animations } = useSettings();
  const reduce = useReducedMotion() || animations === false;
  const wide = useMediaQuery("(min-width: 1024px)");
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
  const showPanel = PANEL_TABS.has(tab);
  const panel = { day: day || PLACEHOLDER_DAY, loading: !day, date, today, go, goToday: () => setUrl({ date: null }), openAdd };
  const isToday = !pickedDate || pickedDate === today;

  return (
    <div className="space-y-6 pb-20 sm:pb-0" /* room for the floating assistant button under the last row on a phone */>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl">Nutrition</h2>
        <Button size="sm" onClick={() => openAdd()} className="bg-emerald-700 text-white hover:bg-emerald-800" data-testid="header-add-food"><Plus className="mr-1 h-4 w-4" />Add food</Button>
      </div>

      {!wide && showPanel && (
        <div className="space-y-3">
          <DayNav date={date} today={today} go={go} goToday={panel.goToday} />
          <DayStrip {...panel} />
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setUrl({ tab: v === "today" ? null : v })}>
        <div className="lg:flex lg:items-start">
          {wide && (
            <aside aria-label="The day" data-testid="day-ledger"
              className={cn("min-w-0 scrollbar-hide lg:sticky lg:top-24 lg:max-h-[calc(100svh-8rem)] lg:shrink-0 lg:overflow-y-auto lg:overflow-x-hidden",
                "transition-[width,margin,opacity,visibility] motion-reduce:transition-none",
                showPanel ? "opacity-100" : "invisible opacity-0")}
              style={{ width: showPanel ? PANEL_W : 0, marginRight: showPanel ? "2.5rem" : 0, transitionDuration: "400ms", transitionTimingFunction: "cubic-bezier(0.16,1,0.3,1)", ...(reduce ? { transition: "none" } : null) }}
              {...(!showPanel ? { inert: true, "aria-hidden": "true" } : null)}
              {...(!day ? { "data-skeleton": "", inert: true, "aria-hidden": "true" } : null)}>
              <div style={{ width: PANEL_W }} className="max-w-full pb-2"><DayPanel {...panel} /></div>
            </aside>
          )}

          <div className="min-w-0 flex-1">
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

            <motion.div key={tab} className="mt-6" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}>
              {!day && NEEDS_DAY.has(tab) && (
                <div className="grid gap-6" role="status" aria-busy="true" aria-label="Loading the day"><div className="skeleton h-64 rounded-3xl" /></div>
              )}
              <TabsContent value="today" className="mt-0 space-y-6">
                {isToday && <ReminderBanner onLogMeal={(meal) => openAdd(meal)} />}
                {day ? <TodayTab day={day} insights={insights} insightsLoading={insightsLoading && !insights} date={date} isToday={isToday} onAdd={openAdd} onEdit={(entry) => setDialog({ open: true, entry, planning: false })} />
                  : <div role="status" aria-busy="true" aria-label="Loading the day"><TodayTab loading day={PLACEHOLDER_DAY} date={date} isToday={isToday} onAdd={() => {}} onEdit={() => {}} /></div>}
              </TabsContent>
              <TabsContent value="plan" className="mt-0">{today && <PlanTab anchor={pickedDate || today} today={today} onAdd={(d) => openPlan(d)} onEdit={(item) => setDialog({ open: true, planning: true, entry: item })} />}</TabsContent>
              <TabsContent value="nutrients" className="mt-0">{day && <NutrientsTab day={day} />}</TabsContent>
              <TabsContent value="trends" className="mt-0">{day && date && <TrendsTab date={date} today={today} energyTarget={day.energy_target} onLog={(id) => openAdd(undefined, id)} />}</TabsContent>
              <TabsContent value="foods" className="mt-0"><FoodsTab date={pickedDate || undefined} onLog={(id) => openAdd(undefined, id)} onPlan={(id) => openPlan(today, id)} onPlanRecipe={(id) => openPlan(today, undefined, id)} /></TabsContent>
              <TabsContent value="goals" className="mt-0"><GoalsTab /></TabsContent>
            </motion.div>
          </div>
        </div>
      </Tabs>

      <FoodDialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} planning={!!dialog.planning}
        date={dialog.planning ? (dialog.entry?.date || dialog.date || today || undefined) : (date || undefined)}
        defaultMealType={dialog.meal} entry={dialog.entry} initialFoodId={dialog.foodId} initialRecipeId={dialog.recipeId} initialQuery={dialog.initialQuery} />
    </div>
  );
}
