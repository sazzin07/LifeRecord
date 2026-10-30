import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, Leaf, Plus, Sparkles, Sun, Target, UtensilsCrossed } from "lucide-react";
import { useFetch } from "@/lib/useFetch";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DatePicker } from "@/components/ui/date-picker";
import { openAI } from "@/components/AppShell";
import { FoodDialog } from "./nutrition/FoodDialog";
import { TodayTab } from "./nutrition/TodayTab";
import { PlanTab } from "./nutrition/PlanTab";
import { NutrientsTab } from "./nutrition/NutrientsTab";
import { TrendsTab } from "./nutrition/TrendsTab";
import { FoodsTab } from "./nutrition/FoodsTab";
import { GoalsTab } from "./nutrition/GoalsTab";
import { ReminderBanner } from "./nutrition/Reminders";
import { prettyDate, shiftDate } from "./nutrition/shared";

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
  const { data: insights } = useFetch(date && tab === "today" ? `/nutrition/insights?date=${date}` : null);

  const openAdd = (meal, foodId, query) => setDialog({ open: true, meal, foodId, initialQuery: query, entry: null, planning: false });
  const openPlan = (planDate, foodId, recipeId) => setDialog({ open: true, planning: true, date: planDate, foodId, recipeId, entry: null });
  const go = (d) => setUrl({ date: d === today ? null : d });

  return (
    <div className="space-y-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 basis-64 flex-1">
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-2xl">Nutrition</h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">What you eat, what it contains, and how it compares with the references</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => openAI("Log a meal: ")} aria-label="Ask the assistant" data-testid="nutrition-ai"><Sparkles className="mr-1.5 h-4 w-4 text-emerald-600" />Assistant</Button>
          <Button size="sm" onClick={() => openAdd()} className="bg-emerald-600 text-white hover:bg-emerald-700" data-testid="header-add-food"><Plus className="mr-1 h-4 w-4" />Add food</Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setUrl({ tab: v === "today" ? null : v })}>
        <TabsList className="h-11 w-full justify-start overflow-x-auto scrollbar-hide sm:w-auto">
          {TABS.map(([k, label, Icon]) => (
            <TabsTrigger key={k} value={k} className="flex-1 shrink-0 gap-1.5 sm:flex-none" data-testid={`tab-${k}`}><Icon className="h-4 w-4" aria-hidden="true" />{label}</TabsTrigger>
          ))}
        </TabsList>

        {DAY_TABS.has(tab) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-xl border border-border bg-card" role="group" aria-label="Choose day">
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Previous day" disabled={!date} onClick={() => go(shiftDate(date, -1))} data-testid="day-prev"><ChevronLeft className="h-4 w-4" /></Button>
              <div className="w-44"><DatePicker value={date || ""} onChange={(v) => v && go(v)} clearable={false} aria-label="Day" /></div>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Next day" disabled={!date} onClick={() => go(shiftDate(date, 1))} data-testid="day-next"><ChevronRight className="h-4 w-4" /></Button>
            </div>
            {date && date !== today && <Button variant="outline" size="sm" onClick={() => setUrl({ date: null })} data-testid="day-today">Today</Button>}
            {date && date !== today && <p className="text-sm text-slate-500" data-testid="day-label">{prettyDate(date, today)} · {date}</p>}
          </div>
        )}

        <div className="mt-5">
          {!day && DAY_TABS.has(tab) && (
            <div className="grid gap-6 lg:grid-cols-3" aria-busy="true"><div className="skeleton h-64 rounded-2xl lg:col-span-2" /><div className="skeleton h-64 rounded-2xl" /></div>
          )}
          <TabsContent value="today" className="mt-0 space-y-6">
            {(!pickedDate || pickedDate === today) && <ReminderBanner onLogMeal={(meal) => openAdd(meal)} />}
            {day && <TodayTab day={day} insights={insights} date={date} onAdd={openAdd} onEdit={(entry) => setDialog({ open: true, entry, planning: false })} />}
          </TabsContent>
          <TabsContent value="plan" className="mt-0">{today && <PlanTab anchor={pickedDate || today} today={today} onAdd={(d) => openPlan(d)} onEdit={(item) => setDialog({ open: true, planning: true, entry: item })} />}</TabsContent>
          <TabsContent value="nutrients" className="mt-0">{day && <NutrientsTab day={day} />}</TabsContent>
          <TabsContent value="trends" className="mt-0">{day && date && <TrendsTab date={date} today={today} energyTarget={day.energy_target} />}</TabsContent>
          <TabsContent value="foods" className="mt-0"><FoodsTab date={pickedDate || undefined} onLog={(id) => openAdd(undefined, id)} onPlan={(id) => openPlan(today, id)} onPlanRecipe={(id) => openPlan(today, undefined, id)} /></TabsContent>
          <TabsContent value="goals" className="mt-0"><GoalsTab /></TabsContent>
        </div>
      </Tabs>

      <FoodDialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} planning={!!dialog.planning}
        date={dialog.planning ? (dialog.entry?.date || dialog.date || today || undefined) : (date || undefined)}
        defaultMealType={dialog.meal} entry={dialog.entry} initialFoodId={dialog.foodId} initialRecipeId={dialog.recipeId} initialQuery={dialog.initialQuery} />
    </div>
  );
}
