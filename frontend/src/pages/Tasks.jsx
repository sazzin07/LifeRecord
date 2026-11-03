import { useState, useEffect } from "react";
import { Busy, ErrorBlock, Sk } from "@/components/skeletons";
import { Plus, Trash2, CheckSquare, Pencil, Repeat } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useFetch, refreshAll } from "@/lib/useFetch";
import { Card, SectionHeading, EmptyState, Label } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const REPEATS = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
const DUE_PRESETS = [{ label: "Today", days: 0 }, { label: "Tomorrow", days: 1 }, { label: "Next week", days: 7 }];

function TaskDialog({ task, onClose }) {
  const [f, setF] = useState({ title: "", priority: "normal", due: "", recurring: "none" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (task) setF({ title: task.title, priority: task.priority || "normal", due: task.due || "", recurring: task.recurring || "none" });
  }, [task]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!f.title.trim()) { toast.error("Give the task a title"); return; }
    setSaving(true);
    try {
      await api.put(`/tasks/${task.id}`, {
        title: f.title.trim(), priority: f.priority, due: f.due || null,
        recurring: f.due && f.recurring !== "none" ? f.recurring : null, done: task.done,
      });
      toast.success("Task updated");
      refreshAll();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "Could not update task"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!task} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="task-edit-dialog">
        <DialogHeader>
          <DialogTitle>Edit task</DialogTitle>
          <DialogDescription className="sr-only">Change the title, priority, due date or repeat</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={f.title} onChange={(e) => set("title")(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} className="mt-1" data-testid="task-edit-title" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Priority</Label>
              <Select value={f.priority} onValueChange={set("priority")}>
                <SelectTrigger className="mt-1" data-testid="task-edit-priority" aria-label="Priority"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
              </Select>
            </div>
            <div><Label>Due</Label>
              <DatePicker value={f.due} onChange={set("due")} placeholder="No due date" presets={DUE_PRESETS} className="mt-1" aria-label="Due date" data-testid="task-edit-due" />
            </div>
          </div>
          <div><Label>Repeat</Label>
            <Select value={f.due ? f.recurring : "none"} onValueChange={set("recurring")} disabled={!f.due}>
              <SelectTrigger className="mt-1" data-testid="task-edit-repeat" aria-label="Repeat"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Does not repeat</SelectItem>
                {Object.entries(REPEATS).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-slate-500">{f.due ? "When you complete a repeating task, the next one is added automatically." : "Set a due date to make the task repeat."}</p>
          </div>
          <Button onClick={save} disabled={saving} className="w-full bg-emerald-700 hover:bg-emerald-800 text-white" data-testid="task-edit-save">Save changes</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Tasks() {
  const { data: tasks, loading, error: tasksError, reload: reloadTasks } = useFetch("/tasks");
  const [title, setTitle] = useState("");
  const [deleteId, setDeleteId] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const add = async () => { if (!title.trim()) return; await api.post("/tasks", { title, priority: "normal" }); setTitle(""); refreshAll(); };
  const toggle = async (t) => {
    await api.put(`/tasks/${t.id}`, { ...t, done: !t.done });
    if (!t.done && t.recurring && t.due) toast.success("Done — the next one is on your list");
    refreshAll();
  };
  const del = async (id) => { await api.delete(`/tasks/${id}`); refreshAll(); };
  const taskToDelete = (tasks || []).find((t) => t.id === deleteId);

  const open = (tasks || []).filter((t) => !t.done);
  const done = (tasks || []).filter((t) => t.done);

  return (
    <div className="space-y-6">
      <SectionHeading title="Tasks" sub="Your lightweight daily list" />
      <Card className="p-4">
        <div className="flex gap-2">
          <Input placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} data-testid="task-input" />
          <Button onClick={add} className="bg-emerald-700 hover:bg-emerald-800 text-white" data-testid="task-add" aria-label="Add task"><Plus className="h-4 w-4" /></Button>
        </div>
      </Card>
      {tasksError ? <ErrorBlock what="your tasks" onRetry={reloadTasks} /> : loading ? (
        <Card>
          <Busy label="Loading tasks" className="divide-y divide-border">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} aria-hidden="true" className="flex items-center gap-3 px-5 py-3">
                <Sk className="h-4 w-4 !rounded" /><Sk className="h-2 w-2 !rounded-full" /><Sk className={i % 2 ? "h-3.5 w-2/5" : "h-3.5 w-3/5"} /><Sk className="ml-auto h-3 w-16" />
              </div>
            ))}
          </Busy>
        </Card>
      ) : (
        <Card>
          {open.length === 0 && done.length === 0 ? <EmptyState icon={CheckSquare} title="No tasks yet" sub="Add your first task above." /> : (
            <div className="divide-y divide-border">
              {[...open, ...done].map((t) => (
                <div key={t.id} data-testid={`task-${t.id}`} className="flex items-center gap-3 px-5 py-3 group">
                  <Checkbox checked={t.done} onCheckedChange={() => toggle(t)} data-testid={`task-check-${t.id}`} aria-label={t.done ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`} />
                  <div className={cn("h-2 w-2 rounded-full shrink-0", t.priority === "high" ? "bg-red-500" : t.priority === "low" ? "bg-slate-300" : "bg-emerald-500")} aria-hidden="true" />
                  <button type="button" onClick={() => setEditing(t)} className={cn("flex-1 text-left text-sm", t.done && "line-through text-slate-400")} data-testid={`task-title-${t.id}`}>{t.title}</button>
                  {t.recurring && <Repeat className="h-3.5 w-3.5 text-slate-400" aria-label={`Repeats ${t.recurring}`} />}
                  {t.due && <span className={cn("text-xs", !t.done && t.due < new Date().toISOString().slice(0, 10) ? "text-red-500" : "text-slate-400")}>{t.due}</span>}
                  <button onClick={() => setEditing(t)} aria-label={`Edit "${t.title}"`} data-testid={`task-edit-${t.id}`} className="sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-slate-400 hover:text-emerald-600"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => { setDeleteId(t.id); setDeleteOpen(true); }} aria-label={`Delete "${t.title}"`} className="sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-slate-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <TaskDialog task={editing} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete task?"
        description={taskToDelete ? `This will permanently delete "${taskToDelete.title}".` : "This will permanently delete the task."}
        onConfirm={() => { const id = deleteId; if (id) del(id); }}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
