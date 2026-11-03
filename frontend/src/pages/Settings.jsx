import { useMemo, useState } from "react";
import { Sun, Moon, Monitor, Sparkles, Plus, Trash2, Pencil, Lock } from "lucide-react";
import { api, eur } from "@/lib/api";
import { useSettings } from "@/context/SettingsContext";
import { useFetch, refreshAll } from "@/lib/useFetch";
import { Card, SectionHeading, Label } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AccountDialog, buildAccountTree, canHaveSubPlaces } from "@/components/AccountDialog";
import { AccountTabs } from "@/components/AccountTabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

function Accounts({ accounts }) {
  const [dialog, setDialog] = useState({ open: false, account: null, parent: null });
  const [deleteId, setDeleteId] = useState(null);
  const { roots } = useMemo(() => buildAccountTree((accounts || []).filter((a) => a.type !== "owed" && a.type !== "owed_person")), [accounts]);
  const toDelete = (accounts || []).find((a) => a.id === deleteId);

  const remove = async (id) => {
    try {
      await api.delete(`/accounts/${id}`);
      toast.success("Deleted");
      refreshAll();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not delete account");
    } finally {
      setDeleteId(null);
    }
  };

  const row = (a, child) => (
    <div key={a.id} className={cn("flex items-center gap-2 text-sm py-1.5", child && "pl-5")} data-testid={`settings-account-${a.id}`}>
      <span className={cn("flex-1 flex items-center gap-1.5", child ? "text-slate-600 dark:text-slate-300" : "font-medium")}>
        {a.name}{a.is_locked && <Lock className="h-3 w-3 text-amber-600" aria-label="Locked" />}
      </span>
      <span className="stat-num font-semibold">{eur(a.balance)}</span>
      <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${a.name}`} onClick={() => setDialog({ open: true, account: a, parent: null })}><Pencil className="h-3.5 w-3.5" /></Button>
      {child
        ? <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600" aria-label={`Delete ${a.name}`} onClick={() => setDeleteId(a.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
        : <span className="h-7 w-7" aria-hidden="true" />}
    </div>
  );

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <Label>Accounts</Label>
        <Button variant="outline" size="sm" onClick={() => setDialog({ open: true, account: null, parent: roots.find(canHaveSubPlaces) || null })} data-testid="settings-add-place"><Plus className="h-4 w-4 mr-1" />Add place</Button>
      </div>
      <div className="mt-3 divide-y divide-border">
        {accounts === null && [0, 1, 2].map((i) => <div key={i} className="skeleton h-8 my-1.5 rounded-lg" aria-hidden="true" />)}
        {roots.map((r) => (
          <div key={r.id} className="py-1">
            {row(r, false)}
            {r.children.map((c) => row(c, true))}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">Deleting a place gives its money back to its main account. Transfers are on the Money page.</p>
      <AccountDialog open={dialog.open} setOpen={(o) => setDialog((d) => ({ ...d, open: o }))} account={dialog.account} parent={dialog.parent} parents={roots.filter(canHaveSubPlaces)} />
      <ConfirmDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }} title="Delete place?"
        description={toDelete ? `"${toDelete.name}" will be removed. The ${eur(toDelete.balance)} in it goes back to its main account.` : "This place will be removed."}
        onConfirm={() => deleteId && remove(deleteId)} confirmText="Delete" variant="danger" />
    </Card>
  );
}

export default function Settings() {
  const { theme, setTheme, animations, setAnimations } = useSettings();
  const { data: cats } = useFetch("/categories");
  const { data: accounts } = useFetch("/accounts");
  const [newCat, setNewCat] = useState("");
  const [deleteCatId, setDeleteCatId] = useState(null);
  const [deleteCatOpen, setDeleteCatOpen] = useState(false);

  const addCat = async () => { if (!newCat.trim()) return; await api.post("/categories", { name: newCat }); setNewCat(""); refreshAll(); toast.success("Category added"); };
  const delCat = async (id) => { await api.delete(`/categories/${id}`); refreshAll(); };
  const catToDelete = (cats || []).find((c) => c.id === deleteCatId);

  const themes = [{ k: "light", i: Sun, l: "Light" }, { k: "dark", i: Moon, l: "Dark" }, { k: "system", i: Monitor, l: "System" }];

  return (
    <div className="space-y-6 max-w-5xl">
      <SectionHeading title="Settings" sub="Appearance, money places, categories and the assistant" action={<AccountTabs />} />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="space-y-6 min-w-0">
          <Card className="p-5">
            <Label>Appearance</Label>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {themes.map((t) => (
                <button key={t.k} data-testid={`theme-${t.k}`} onClick={() => setTheme(t.k)}
                  className={cn("flex flex-col items-center gap-2 rounded-xl border p-4 transition-colors", theme === t.k ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-500/15" : "border-border hover:bg-slate-50 dark:hover:bg-slate-800/50")}>
                  <t.i className={cn("h-5 w-5", theme === t.k ? "text-emerald-600" : "text-slate-500")} />
                  <span className="text-sm font-medium">{t.l}</span>
                </button>
              ))}
            </div>
            <div className="mt-5 flex items-center justify-between">
              <div><p className="font-medium text-sm">Animations</p><p className="text-xs text-slate-500">Entry and transition motion</p></div>
              <Switch checked={animations} onCheckedChange={setAnimations} aria-label="Animations" data-testid="anim-toggle" />
            </div>
          </Card>

          <Card className="p-5">
            <Label>Finance categories</Label>
            <div className="mt-3 flex gap-2">
              <Input placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCat()} data-testid="category-input" />
              <Button onClick={addCat} aria-label="Add category" className="bg-emerald-700 hover:bg-emerald-800 text-white" data-testid="category-add"><Plus className="h-4 w-4" /></Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {cats === null && [0, 1, 2, 3].map((i) => <span key={i} className="skeleton h-7 w-24 rounded-full" aria-hidden="true" />)}
              {(cats || []).map((c) => (
                <span key={c.id} className="group inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm">
                  <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />{c.name}
                  <button onClick={() => { setDeleteCatId(c.id); setDeleteCatOpen(true); }} aria-label={`Delete ${c.name} category`} className="text-slate-300 hover:text-red-500"><Trash2 className="h-3 w-3" /></button>
                </span>
              ))}
            </div>
          </Card>

          <Card className="p-5 flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-emerald-600" />
            <div><p className="font-medium text-sm">AI assistant</p><p className="text-xs text-slate-500">Chat, voice and receipt photos. API keys are kept on the server and never sent to your browser.</p></div>
          </Card>
        </div>

        <div className="min-w-0">
          <Accounts accounts={accounts} />
        </div>
      </div>

      <ConfirmDialog
        open={deleteCatOpen}
        onOpenChange={setDeleteCatOpen}
        title="Delete category?"
        description={catToDelete ? `This will permanently delete the "${catToDelete.name}" category.` : "This will permanently delete the category."}
        onConfirm={() => { const id = deleteCatId; if (id) delCat(id); }}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
