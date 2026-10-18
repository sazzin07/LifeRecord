import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users, Plus, Search, Trash2, Pencil, HandCoins, TrendingDown,
  TrendingUp, X,
} from "lucide-react";
import { api, eur } from "@/lib/api";
import { useFetch, refreshAll } from "@/lib/useFetch";
import { Card, StatCard, SectionHeading, EmptyState, Avatar, SkeletonCard } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import PersonDetailModal from "@/components/PersonDetailModal";

const SORTS = [
  { id: "name_asc", label: "Name A-Z" },
  { id: "name_desc", label: "Name Z-A" },
  { id: "balance_desc", label: "Highest balance" },
  { id: "balance_asc", label: "Lowest balance" },
];

export default function People() {
  const nav = useNavigate();
  const { data: people, loading } = useFetch("/people");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("name_asc");
  const [selectedId, setSelectedId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [form, setForm] = useState({ name: "", notes: "", payment_preference: "" });

  const allPeople = useMemo(() => people || [], [people]);

  const totals = useMemo(() => {
    return allPeople.reduce((acc, p) => {
      acc.owed += Math.max(p.net, 0);
      acc.owe += Math.max(-p.net, 0);
      return acc;
    }, { owed: 0, owe: 0 });
  }, [allPeople]);

  const filtered = useMemo(() => {
    let rows = [...allPeople];
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((p) => p.name.toLowerCase().includes(q));
    rows.sort((a, b) => {
      if (sort === "name_asc") return a.name.localeCompare(b.name);
      if (sort === "name_desc") return b.name.localeCompare(a.name);
      if (sort === "balance_desc") return b.net - a.net;
      if (sort === "balance_asc") return a.net - b.net;
      return 0;
    });
    return rows;
  }, [allPeople, search, sort]);

  const allSelected = filtered.length > 0 && filtered.every((p) => selectedIds.has(p.id));
  const someSelected = filtered.some((p) => selectedIds.has(p.id));

  const toggleSelection = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((p) => next.add(p.id));
        return next;
      });
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const openDetail = (id) => { setSelectedId(id); setDetailOpen(true); };

  const startAdd = () => { setEditing(null); setForm({ name: "", notes: "", payment_preference: "" }); setFormOpen(true); };
  const startEdit = (p, e) => {
    e.stopPropagation();
    setEditing(p);
    setForm({ name: p.name, notes: p.notes || "", payment_preference: p.payment_preference || "" });
    setFormOpen(true);
  };

  const savePerson = async () => {
    if (!form.name.trim()) return;
    const body = {
      name: form.name.trim(),
      notes: form.notes,
      payment_preference: form.payment_preference,
    };
    if (editing) {
      await api.put(`/people/${editing.id}`, body);
      toast.success("Person updated");
    } else {
      await api.post("/people", body);
      toast.success("Person added");
    }
    setFormOpen(false);
    refreshAll();
  };

  const deletePerson = async (id) => {
    await api.delete(`/people/${id}`);
    toast.success("Person deleted");
    refreshAll();
  };

  const bulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (ids.length === 1) {
      await deletePerson(ids[0]);
    } else {
      await api.post("/people/bulk-delete", { ids });
      toast.success(`${ids.length} people deleted`);
    }
    setSelectedIds(new Set());
    setBulkDeleteOpen(false);
    refreshAll();
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        title="People"
        sub="Shared expenses, balances and reimbursements"
        action={
          <Button onClick={startAdd} data-testid="add-person-btn" className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white">
            <Plus className="h-4 w-4 mr-1" /> Add person
          </Button>
        }
      />

      {loading ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}</div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="People" value={filtered.length} icon={Users} />
            <StatCard label="You are owed" value={eur(totals.owed)} accent="text-emerald-600 dark:text-emerald-400" icon={TrendingUp} />
            <StatCard label="You owe" value={eur(totals.owe)} accent="text-red-500" icon={TrendingDown} />
            <StatCard label="Net position" value={eur(totals.owed - totals.owe)} accent={totals.owed >= totals.owe ? "text-emerald-600" : "text-red-500"} icon={HandCoins} />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input placeholder="Search people..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" data-testid="people-search" />
            </div>
            <div className="flex gap-2">
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {someSelected && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/20" data-testid="bulk-delete-bar">
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-red-700" data-testid="selected-count">{selectedIds.size} selected</span>
                <Button variant="ghost" size="sm" className="h-8 text-red-600" onClick={clearSelection} data-testid="clear-selection">
                  <X className="h-4 w-4 mr-1" /> Clear
                </Button>
              </div>
              <Button size="sm" className="h-8 bg-red-500 hover:bg-red-600 text-white" onClick={() => setBulkDeleteOpen(true)} data-testid="bulk-delete-btn">
                <Trash2 className="h-4 w-4 mr-1" /> Delete selected
              </Button>
            </div>
          )}

          {filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon={Users}
                title="No people yet"
                sub="Add people to split expenses and track who owes what."
                action={<Button onClick={startAdd} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="h-4 w-4 mr-1" /> Add person</Button>}
              />
            </Card>
          ) : (
            <>
              <div className="flex items-center gap-2 px-1">
                <Checkbox id="select-all" checked={allSelected} onCheckedChange={toggleSelectAll} data-testid="select-all" />
                <Label htmlFor="select-all" className="text-sm text-slate-500 cursor-pointer">Select all</Label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((p) => {
                  const theyOwe = p.net > 0.005;
                  const iOwe = p.net < -0.005;
                  const selected = selectedIds.has(p.id);
                  return (
                    <Card
                      key={p.id}
                      data-testid={`person-card-${p.id}`}
                      onClick={() => openDetail(p.id)}
                      className={cn(
                        "p-5 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 border",
                        selected ? "border-emerald-400 ring-1 ring-emerald-400" : "border-border",
                        theyOwe ? "hover:border-emerald-300" : iOwe ? "hover:border-red-300" : "hover:border-slate-300"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div onClick={(e) => e.stopPropagation()} className="pt-1">
                          <Checkbox checked={selected} onCheckedChange={() => toggleSelection(p.id)} />
                        </div>
                        <Avatar name={p.name} photo={p.photo} size="h-12 w-12" />
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold truncate">{p.name}</h3>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {theyOwe ? "Owes you" : iOwe ? "You owe" : "Settled up"}
                          </p>
                        </div>
                        <div className={cn("text-right shrink-0", theyOwe ? "text-emerald-600" : iOwe ? "text-red-500" : "text-slate-400")}>
                          <p className="text-xl font-bold">{theyOwe ? "+" : ""}{eur(p.net)}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
                        <span>Owed: {eur(p.owes_me)}</span>
                        <span className="text-slate-300">·</span>
                        <span>You owe: {eur(p.i_owe)}</span>
                      </div>

                      <div className="mt-4 flex gap-2">
                        <Button variant="outline" size="sm" className="h-8 flex-1" onClick={(e) => startEdit(p, e)} data-testid={`person-edit-${p.id}`}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                        </Button>
                        <Button variant="outline" size="sm" className="h-8 flex-1 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); if (window.confirm("Delete this person permanently? Their splits and payments will also be removed.")) deletePerson(p.id); }} data-testid={`person-delete-${p.id}`}>
                          <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* Add/Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit person" : "Add person"}</DialogTitle>
            <DialogDescription>Keep notes and a payment preference to make reimbursements easier.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Ferreira" data-testid="person-name-input" />
            </div>
            <div>
              <Label>Payment preference</Label>
              <Input value={form.payment_preference} onChange={(e) => setForm((f) => ({ ...f, payment_preference: e.target.value }))} placeholder="e.g. Revolut / MB WAY" data-testid="person-payment-input" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." data-testid="person-notes-input" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFormOpen(false)} data-testid="person-form-cancel">Cancel</Button>
              <Button onClick={savePerson} className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={!form.name.trim()} data-testid="person-form-save">
                {editing ? "Save changes" : "Add person"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} people?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected people and remove their splits and payments from your ledger. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setBulkDeleteOpen(false)} data-testid="bulk-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const ids = Array.from(selectedIds); if (ids.length === 1) { deletePerson(ids[0]); } else { bulkDelete(); } }} className="bg-red-500 hover:bg-red-600 text-white" data-testid="bulk-delete-confirm">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PersonDetailModal
        personId={selectedId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onEdit={() => { setDetailOpen(false); const p = allPeople.find((x) => x.id === selectedId); if (p) { setEditing(p); setForm({ name: p.name, notes: p.notes || "", payment_preference: p.payment_preference || "" }); setFormOpen(true); } }}
        onDelete={(id) => { setDetailOpen(false); deletePerson(id); }}
      />
    </div>
  );
}
