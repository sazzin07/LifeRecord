import { useState } from "react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { Plus, Trash2, Scale } from "lucide-react";
import { api } from "@/lib/api";
import { useFetch, refreshAll } from "@/lib/useFetch";
import { Card, StatCard, SectionHeading, EmptyState, Label } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function Body() {
  const { data: weight, loading } = useFetch("/weight");
  const [w, setW] = useState("");

  const add = async () => { if (!parseFloat(w)) return; await api.post("/weight", { weight: parseFloat(w) }); setW(""); toast.success("Weight recorded"); refreshAll(); };
  const del = async (id) => { await api.delete(`/weight/${id}`); refreshAll(); };

  const arr = weight || [];
  const last = arr.length ? arr[arr.length - 1] : null;
  const first = arr.length ? arr[0] : null;
  const delta = last && first ? (last.weight - first.weight).toFixed(1) : null;

  return (
    <div className="space-y-6">
      <SectionHeading title="Body" sub="Weekly weight check-ins and trend" />
      <div className="grid grid-cols-2 gap-4">
        <StatCard testid="body-current" label="Current" value={last ? `${last.weight} kg` : "—"} icon={Scale} hint={last ? last.date : "No check-in"} />
        <StatCard testid="body-delta" label="Total change" value={delta ? `${delta > 0 ? "+" : ""}${delta} kg` : "—"} accent="text-emerald-600 dark:text-emerald-400" hint="Since first entry" />
      </div>
      <Card className="p-4">
        <div className="flex gap-2">
          <Input placeholder="Weight in kg" type="number" step="0.1" value={w} onChange={(e) => setW(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} data-testid="body-weight-input" />
          <Button onClick={add} className="bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="body-weight-add"><Plus className="h-4 w-4 mr-1" />Check in</Button>
        </div>
      </Card>
      {loading ? <div className="skeleton h-64 rounded-2xl" /> : arr.length === 0 ? (
        <Card><EmptyState icon={Scale} title="Your body log starts here" sub="Record your weight to see your trend over time." /></Card>
      ) : (
        <>
          <Card className="p-5">
            <Label>Weight trend</Label>
            <ResponsiveContainer width="100%" height={220} className="mt-3">
              <LineChart data={arr}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} stroke="#94A3B8" />
                <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 10 }} stroke="#94A3B8" width={30} />
                <Tooltip formatter={(v) => `${v} kg`} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
                <Line type="monotone" dataKey="weight" stroke="#10B981" strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <div className="divide-y divide-border">
              {[...arr].reverse().map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-5 py-3 group">
                  <span className="stat-num font-semibold">{e.weight} kg</span>
                  <span className="text-sm text-slate-500 flex-1">{e.date}</span>
                  {e.note && <span className="text-xs text-slate-400">{e.note}</span>}
                  <button onClick={() => del(e.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
