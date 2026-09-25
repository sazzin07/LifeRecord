import { useMemo } from "react";
import { Trash2, Utensils, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useFetch, refreshAll } from "@/lib/useFetch";
import { Card, StatCard, SectionHeading, EmptyState, ConfidenceBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { openAI } from "@/components/AppShell";

const TARGETS = { cal: 2700, p: 160, c: 300, f: 90 };

export default function Nutrition() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: meals, loading } = useFetch(`/meals?date=${today}`);
  const del = async (id) => { await api.delete(`/meals/${id}`); refreshAll(); };
  const arr = meals || [];

  const tot = useMemo(() => ({
    cal: arr.reduce((s, x) => s + (x.calories || 0), 0),
    p: arr.reduce((s, x) => s + (x.protein || 0), 0),
    c: arr.reduce((s, x) => s + (x.carbs || 0), 0),
    f: arr.reduce((s, x) => s + (x.fat || 0), 0),
  }), [arr]);

  return (
    <div className="space-y-6">
      <SectionHeading title="Nutrition" sub="Today's meals, calories and macros"
        action={<Button onClick={() => openAI("Log a meal: ")} variant="outline" className="h-9"><Sparkles className="h-4 w-4 mr-1 text-emerald-600" />Log with AI</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testid="nutri-cal" label="Calories" value={`${Math.round(tot.cal)}`} hint={`/ ${TARGETS.cal}`} />
        <StatCard testid="nutri-protein" label="Protein" value={`${Math.round(tot.p)}g`} accent="text-indigo-500" hint={`/ ${TARGETS.p}g`} />
        <StatCard testid="nutri-carbs" label="Carbs" value={`${Math.round(tot.c)}g`} accent="text-amber-500" hint={`/ ${TARGETS.c}g`} />
        <StatCard testid="nutri-fat" label="Fat" value={`${Math.round(tot.f)}g`} accent="text-red-500" hint={`/ ${TARGETS.f}g`} />
      </div>
      {loading ? <div className="skeleton h-40 rounded-2xl" /> : arr.length === 0 ? (
        <Card><EmptyState icon={Utensils} title="No meals logged today" sub="Tell the assistant what you ate and it will estimate the nutrition." action={<Button onClick={() => openAI("I ate ")} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Sparkles className="h-4 w-4 mr-1" />Log a meal</Button>} /></Card>
      ) : (
        <Card>
          <div className="divide-y divide-border">
            {arr.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-5 py-3 group">
                <div className="h-9 w-9 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 grid place-items-center shrink-0"><Utensils className="h-4 w-4 text-emerald-600" /></div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{m.description}</p>
                  <p className="text-xs text-slate-500">{Math.round(m.protein || 0)}P · {Math.round(m.carbs || 0)}C · {Math.round(m.fat || 0)}F</p>
                </div>
                <div className="text-right"><p className="stat-num font-semibold text-sm">{Math.round(m.calories || 0)} kcal</p><ConfidenceBadge type="estimated">Est.</ConfidenceBadge></div>
                <button onClick={() => del(m.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
