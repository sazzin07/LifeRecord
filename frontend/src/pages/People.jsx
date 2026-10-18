import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users, Plus, Search, ArrowUpDown, UserX, Pencil, HandCoins, TrendingDown,
  TrendingUp, Minus,
} from "lucide-react";
import { api, eur } from "@/lib/api";
import { useFetch, refreshAll } from "@/lib/useFetch";
import { Card, StatCard, SectionHeading, EmptyState, Avatar, SkeletonCard } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [archiveId, setArchiveId] = useState(null);

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
    if (!showArchived) rows = rows.filter((p) => !p.archived);
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
  }, [allPeople, search, sort, showArchived]);

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

  const archivePerson = async (id) => {
    await api.delete(`/people/${id}`);
    toast.success("Person archived");
    setArchiveId(null);
    refreshAll();
  };

  const unarchivePerson = async (p, e) => {
    e.stopPropagation();
    await api.put(`/people/${p.id}`, { name: p.name, notes: p.notes || "", payment_preference: p.payment_preference || "", archived: false });
    toast.success("Person restored");
    refreshAll();
  };

  return (
    <div className="space-y-6">
      <SectionHeading
        title="People"
        sub="Shared expenses, balances and reimbursements"
        action={
          <Button onClick={startAdd} className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white">
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
              <Input placeholder="Search people..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <div className="flex gap-2">
              <Select value={sort} onValueChange={setSort}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SORTS.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant={showArchived ? "default" : "outline"} onClick={() => setShowArchived((v) => !v)} className="shrink-0">
                {showArchived ? "Active" : "Archived"}
              </Button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <Card>
              <EmptyState
                icon={Users}
                title={showArchived ? "No archived people" : "No people yet"}
                sub={showArchived ? "Archived people will appear here." : "Add people to split expenses and track who owes what."}
                action={!showArchived && <Button onClick={startAdd} className="bg-emerald-600 hover:bg-emerald-700 text-white"><Plus className="h-4 w-4 mr-1" /> Add person</Button>}
              />
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((p) => {
                const theyOwe = p.net > 0.005;
                const iOwe = p.net < -0.005;
                const settled = !theyOwe && !iOwe;
                return (
                  <Card
                    key={p.id}
                    onClick={() => openDetail(p.id)}
                    className={cn(
                      "p-5 cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 border",
                      p.archived ? "opacity-70 border-dashed" : "border-border",
                      theyOwe ? "hover:border-emerald-300" : iOwe ? "hover:border-red-300" : "hover:border-slate-300"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Avatar name={p.name} photo={p.photo} size="h-12 w-12" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="font-semibold truncate">{p.name}</h3>
                          {p.archived && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Archived</span>}
                        </div>
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
                      {!p.archived && (
                        <>
                          <Button variant="outline" size="sm" className="h-8 flex-1" onClick={(e) => startEdit(p, e)}>
                            <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                          </Button>
                          <Button variant="outline" size="sm" className="h-8 flex-1 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); setArchiveId(p.id); }}>
                            <UserX className="h-3.5 w-3.5 mr-1" /> Archive
                          </Button>
                        </>
                      )}
                      {p.archived && (
                        <Button variant="outline" size="sm" className="h-8 flex-1" onClick={(e) => unarchivePerson(p, e)}>
                          Restore
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
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
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Ferreira" />
            </div>
            <div>
              <Label>Payment preference</Label>
              <Input value={form.payment_preference} onChange={(e) => setForm((f) => ({ ...f, payment_preference: e.target.value }))} placeholder="e.g. Revolut / MB WAY" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button onClick={savePerson} className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={!form.name.trim()}>
                {editing ? "Save changes" : "Add person"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation */}
      <AlertDialog open={!!archiveId} onOpenChange={(v) => !v && setArchiveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this person?</AlertDialogTitle>
            <AlertDialogDescription>
              Their transaction history will be preserved and their balance will remain visible. You can restore them later from the Archived view.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => archiveId && archivePerson(archiveId)} className="bg-red-500 hover:bg-red-600 text-white">Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PersonDetailModal
        personId={selectedId}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onEdit={() => { setDetailOpen(false); const p = allPeople.find((x) => x.id === selectedId); if (p) { setEditing(p); setForm({ name: p.name, notes: p.notes || "", payment_preference: p.payment_preference || "" }); setFormOpen(true); } }}
        onArchive={(id) => { setDetailOpen(false); setArchiveId(id); }}
      />
    </div>
  );
}
