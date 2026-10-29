import { useRef, useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight, Leaf, Sparkles, Sun, Target, UtensilsCrossed } from "lucide-react";
import { useFetch } from "@/lib/useFetch";
import { SectionHeading } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DatePicker } from "@/components/ui/date-picker";
import { openAI } from "@/components/AppShell";
import { FoodDialog } from "./nutrition/FoodDialog";
import { TodayTab } from "./nutrition/TodayTab";
import { NutrientsTab } from "./nutrition/NutrientsTab";
import { TrendsTab } from "./nutrition/TrendsTab";
import { FoodsTab } from "./nutrition/FoodsTab";
import { GoalsTab } from "./nutrition/GoalsTab";
import { prettyDate, shiftDate } from "./nutrition/shared";

export default function Nutrition() {
  const [tab, setTab] = useState("today");
  const [pickedDate, setPickedDate] = useState(null); // null = "today" as the server sees it (the profile's time zone)
  const [dialog, setDialog] = useState({ open: false });
  const { data: day } = useFetch(`/nutrition/day${pickedDate ? `?date=${pickedDate}` : ""}`);
  // Remember the last known "today": while another day is loading `day` is empty, but the header still needs it.
  const todayRef = useRef(null);
  if (day?.today) todayRef.current = day.today;
  const today = todayRef.current;
  const date = pickedDate || day?.today || todayRef.current || null;
  const { data: insights } = useFetch(date && tab === "today" ? `/nutrition/insights?date=${date}` : null);

  const openAdd = (meal, foodId) => setDialog({ open: true, meal, foodId, entry: null });
  const go = (d) => setPickedDate(d === today ? null : d);

  return (
    <div className="space-y-6">
      <SectionHeading title="Nutrition" sub="What you eat, what it contains, and how it compares with the references" />
      <div className="-mt-2 flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-xl border border-border bg-card" role="group" aria-label="Choose day">
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Previous day" disabled={!date} onClick={() => go(shiftDate(date, -1))} data-testid="day-prev"><ChevronLeft className="h-4 w-4" /></Button>
              <div className="w-44"><DatePicker value={date || ""} onChange={(v) => v && go(v)} clearable={false} aria-label="Day" /></div>
              <Button variant="ghost" size="icon" className="h-9 w-9" aria-label="Next day" disabled={!date} onClick={() => go(shiftDate(date, 1))} data-testid="day-next"><ChevronRight className="h-4 w-4" /></Button>
            </div>
            {date && date !== today && <Button variant="outline" size="sm" onClick={() => setPickedDate(null)} data-testid="day-today">Today</Button>}
            <Button variant="outline" size="sm" onClick={() => openAI("Log a meal: ")} aria-label="Ask the assistant" data-testid="nutrition-ai"><Sparkles className="mr-1.5 h-4 w-4 text-emerald-600" />Assistant</Button>
      </div>
      {date && date !== today && <p className="-mt-3 text-sm text-slate-500" data-testid="day-label">{prettyDate(date, today)} · {date}</p>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-11 w-full justify-start overflow-x-auto scrollbar-hide sm:w-auto">
          <TabsTrigger value="today" className="flex-1 shrink-0 gap-1.5 sm:flex-none" data-testid="tab-today"><Sun className="h-4 w-4" />Today</TabsTrigger>
          <TabsTrigger value="nutrients" className="flex-1 shrink-0 gap-1.5 sm:flex-none" data-testid="tab-nutrients"><Leaf className="h-4 w-4" />Nutrients</TabsTrigger>
          <TabsTrigger value="trends" className="flex-1 shrink-0 gap-1.5 sm:flex-none" data-testid="tab-trends"><BarChart3 className="h-4 w-4" />Trends</TabsTrigger>
          <TabsTrigger value="foods" className="flex-1 shrink-0 gap-1.5 sm:flex-none" data-testid="tab-foods"><UtensilsCrossed className="h-4 w-4" />Foods</TabsTrigger>
          <TabsTrigger value="goals" className="flex-1 shrink-0 gap-1.5 sm:flex-none" data-testid="tab-goals"><Target className="h-4 w-4" />Goals</TabsTrigger>
        </TabsList>

        <div className="mt-6">
          {!day && tab !== "foods" && tab !== "goals" && (
            <div className="grid gap-6 lg:grid-cols-3" aria-busy="true"><div className="skeleton h-64 rounded-2xl lg:col-span-2" /><div className="skeleton h-64 rounded-2xl" /></div>
          )}
          <TabsContent value="today" className="mt-0">{day && <TodayTab day={day} insights={insights} date={date} onAdd={openAdd} onEdit={(entry) => setDialog({ open: true, entry })} />}</TabsContent>
          <TabsContent value="nutrients" className="mt-0">{day && <NutrientsTab day={day} />}</TabsContent>
          <TabsContent value="trends" className="mt-0">{day && date && <TrendsTab date={date} today={today} energyTarget={day.energy_target} />}</TabsContent>
          <TabsContent value="foods" className="mt-0"><FoodsTab onLog={(id) => openAdd(undefined, id)} /></TabsContent>
          <TabsContent value="goals" className="mt-0"><GoalsTab /></TabsContent>
        </div>
      </Tabs>

      <FoodDialog open={dialog.open} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} date={date || undefined}
        defaultMealType={dialog.meal} entry={dialog.entry} initialFoodId={dialog.foodId} />
    </div>
  );
}
