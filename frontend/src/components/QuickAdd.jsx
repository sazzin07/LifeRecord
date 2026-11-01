import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExpenseDialog } from "@/components/ExpenseDialog";
import { WorkoutDialog } from "@/components/WorkoutDialog";
import { swr } from "@/lib/query";
import { api, errorMessage } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { Receipt, Utensils, ShoppingCart, Dumbbell, Scale, CheckSquare, HandCoins, UserPlus, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { DatePicker } from "@/components/ui/date-picker";

const OPTIONS = [
  { key: "expense", label: "Expense", icon: Receipt },
  { key: "meal", label: "Meal", icon: Utensils },
  { key: "grocery", label: "Grocery", icon: ShoppingCart },
  { key: "workout", label: "Workout", icon: Dumbbell },
  { key: "weight", label: "Weight", icon: Scale },
  { key: "task", label: "Task", icon: CheckSquare },
  { key: "payment", label: "Payment", icon: HandCoins },
  { key: "person", label: "Person", icon: UserPlus },
];

export function QuickAdd({ open, setOpen }) {
  const [mode, setMode] = useState(null);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [workoutOpen, setWorkoutOpen] = useState(false);
  const [form, setForm] = useState({});
  const [people, setPeople] = useState([]);
  const [accounts, setAccounts] = useState([]);

  useEffect(() => {
    if (open) {
      setMode(null); setForm({});
      swr("/people", (d) => setPeople(d));
      swr("/accounts", (d) => setAccounts(d.filter((a) => a.type !== "owed" && a.type !== "owed_person")));
    }
  }, [open]);

  const choose = (key) => {
    if (key === "expense") { setOpen(false); setExpenseOpen(true); return; }
    if (key === "workout") { setOpen(false); setWorkoutOpen(true); return; }
    setMode(key);
  };

  const submit = async () => {
    try {
      if (mode === "meal") await api.post("/meals", { description: form.description, calories: num(form.calories), protein: num(form.protein), carbs: num(form.carbs), fat: num(form.fat) });
      if (mode === "grocery") await api.post("/groceries", { name: form.name, quantity: num(form.quantity) || 1, unit: form.unit || "unit", category: form.category || "Other", price: num(form.price), store: form.store });
      if (mode === "weight") await api.post("/weight", { weight: num(form.weight), note: form.note || "" });
      if (mode === "task") await api.post("/tasks", { title: form.title, priority: form.priority || "normal", due: form.due || null });
      if (mode === "payment") await api.post("/settlements", { person: form.person, amount: num(form.amount), method: form.method || "Revolut", account: "revolut", account_id: form.account || undefined, direction: "in" });
      if (mode === "person") await api.post("/people", { name: form.name });
      toast.success("Saved");
      refreshAll();
      setOpen(false);
    } catch (err) { toast.error(errorMessage(err, "Could not save")); }
  };

  const num = (v) => (v === "" || v == null ? null : parseFloat(v));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" data-testid="quick-add-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {mode && <button onClick={() => setMode(null)} className="text-slate-400 hover:text-slate-600"><ArrowLeft className="h-4 w-4" /></button>}
              {mode ? `Add ${mode}` : "Quick add"}
            </DialogTitle>
            <DialogDescription className="sr-only">Quickly add an item to Life Record</DialogDescription>
          </DialogHeader>

          {!mode && (
            <div className="grid grid-cols-4 gap-2">
              {OPTIONS.map((o) => (
                <button key={o.key} data-testid={`qa-${o.key}`} onClick={() => choose(o.key)}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-border p-3 hover:border-emerald-400 hover:bg-emerald-50/50 dark:hover:bg-emerald-500/10 transition-colors">
                  <o.icon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-xs font-medium">{o.label}</span>
                </button>
              ))}
            </div>
          )}

          {mode === "meal" && (
            <div className="space-y-3">
              <Input placeholder="What did you eat?" onChange={set("description")} data-testid="meal-desc" />
              <div className="grid grid-cols-4 gap-2">
                <Input placeholder="kcal" onChange={set("calories")} /><Input placeholder="P" onChange={set("protein")} /><Input placeholder="C" onChange={set("carbs")} /><Input placeholder="F" onChange={set("fat")} />
              </div>
            </div>
          )}
          {mode === "grocery" && (
            <div className="space-y-3">
              <Input placeholder="Item name" onChange={set("name")} data-testid="grocery-name" />
              <div className="grid grid-cols-3 gap-2"><Input placeholder="Qty" onChange={set("quantity")} /><Input placeholder="Unit" onChange={set("unit")} /><Input placeholder="€ price" onChange={set("price")} /></div>
              <Input placeholder="Store" onChange={set("store")} />
            </div>
          )}
          {mode === "weight" && (
            <div className="space-y-3">
              <Input placeholder="Weight (kg)" type="number" onChange={set("weight")} data-testid="weight-input" />
              <Input placeholder="Note (optional)" onChange={set("note")} />
            </div>
          )}
          {mode === "task" && (
            <div className="space-y-3">
              <Input placeholder="Task title" onChange={set("title")} data-testid="task-title" />
              <div className="grid grid-cols-2 gap-2">
                <Select onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                  <SelectTrigger aria-label="Priority"><SelectValue placeholder="Priority" /></SelectTrigger>
                  <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
                </Select>
                <DatePicker value={form.due || ""} onChange={(v) => set("due")({ target: { value: v } })} aria-label="Due date" placeholder="Due date" presets={[{ label: "Today", days: 0 }, { label: "Tomorrow", days: 1 }, { label: "Next week", days: 7 }]} />
              </div>
            </div>
          )}
          {mode === "payment" && (
            <div className="space-y-3">
              <Select onValueChange={(v) => setForm((f) => ({ ...f, person: v }))}>
                <SelectTrigger data-testid="payment-person" aria-label="Person"><SelectValue placeholder="Person" /></SelectTrigger>
                <SelectContent>{people.map((p) => <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="Amount" type="number" onChange={set("amount")} data-testid="payment-amount" />
              <div className="grid grid-cols-2 gap-2">
                <Select onValueChange={(v) => setForm((f) => ({ ...f, method: v }))}>
                  <SelectTrigger aria-label="Payment method"><SelectValue placeholder="Method" /></SelectTrigger>
                  <SelectContent><SelectItem value="Revolut">Revolut</SelectItem><SelectItem value="MB WAY">MB WAY</SelectItem><SelectItem value="Cash">Cash</SelectItem></SelectContent>
                </Select>
                <Select onValueChange={(v) => setForm((f) => ({ ...f, account: v }))}>
                  <SelectTrigger aria-label="Into account"><SelectValue placeholder="Into" /></SelectTrigger>
                  <SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          )}
          {mode === "person" && <Input placeholder="Name" onChange={set("name")} data-testid="person-name" />}

          {mode && <Button onClick={submit} className="w-full bg-emerald-700 hover:bg-emerald-800 text-white mt-2" data-testid="qa-submit">Save</Button>}
        </DialogContent>
      </Dialog>
      <ExpenseDialog open={expenseOpen} setOpen={setExpenseOpen} />
      <WorkoutDialog open={workoutOpen} setOpen={setWorkoutOpen} />
    </>
  );
}
