import { Dumbbell, Sparkles, Timer } from "lucide-react";
import { Card, SectionHeading } from "@/components/common";
import { Button } from "@/components/ui/button";
import { openAI } from "@/components/AppShell";

const TEMPLATES = [
  { name: "Push", color: "#10B981", exercises: ["Dips — 3×12", "Pike push-ups — 3×10", "Push-ups — 3×15", "Pseudo planche — 3×8"], iso: "Planche lean — 30s" },
  { name: "Pull", color: "#6366F1", exercises: ["Pull-ups — 3×8", "Rows — 3×10", "Chin-ups — 3×8", "Face pulls — 3×15"], iso: "Dead hang — 45s" },
  { name: "Legs", color: "#F59E0B", exercises: ["Pistol squats — 3×6", "Nordic curls — 3×6", "Calf raises — 3×20", "Lunges — 3×12"], iso: "Wall sit — 60s" },
];

export default function Fitness() {
  return (
    <div className="space-y-6">
      <SectionHeading title="Fitness" sub="Calisthenics — Push · Pull · Legs"
        action={<Button onClick={() => openAI("Log today's workout: ")} variant="outline" className="h-9"><Sparkles className="h-4 w-4 mr-1 text-emerald-600" />Log with AI</Button>} />
      <div className="grid lg:grid-cols-3 gap-4">
        {TEMPLATES.map((t) => (
          <Card key={t.name} className="p-5 lm-in" data-testid={`workout-${t.name.toLowerCase()}`}>
            <div className="flex items-center gap-2 mb-4">
              <div className="h-8 w-8 rounded-xl grid place-items-center" style={{ background: t.color + "22" }}><Dumbbell className="h-4 w-4" style={{ color: t.color }} /></div>
              <h3 className="font-bold">{t.name}</h3>
            </div>
            <div className="space-y-2">
              {t.exercises.map((e) => (
                <div key={e} className="flex items-center justify-between text-sm border-b border-border pb-1.5 last:border-0">
                  <span className="text-slate-700 dark:text-slate-300">{e.split(" — ")[0]}</span>
                  <span className="stat-num text-xs text-slate-500">{e.split(" — ")[1]}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-1 text-sm text-emerald-600 dark:text-emerald-400"><Timer className="h-4 w-4" />{t.iso}</div>
            </div>
          </Card>
        ))}
      </div>
      <Card className="p-6 text-center">
        <p className="text-sm text-slate-500">Templates are fully editable — tell the assistant things like <span className="font-medium text-slate-700 dark:text-slate-300">"replace dips with push-ups, 4 sets"</span> and it will adapt your workout. Detailed workout history is on the roadmap.</p>
      </Card>
    </div>
  );
}
