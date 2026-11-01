import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { KitchenScene, ELSEWHERE_ID } from "./KitchenScene";
import { StoragePanel } from "./StoragePanel";
import { groupByLocation } from "./shared";

const KIND_OPTIONS = [
  { value: "fridge", label: "Fridge" },
  { value: "freezer", label: "Freezer" },
  { value: "pantry", label: "Pantry cabinet" },
  { value: "custom", label: "Cupboard / other" },
];

function LocationDialog({ location, open, setOpen, onSave }) {
  const [f, setF] = useState({ name: "", kind: "custom" });
  useEffect(() => { setF(location ? { name: location.name, kind: location.kind } : { name: "", kind: "custom" }); }, [location, open]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{location ? "Edit storage space" : "Add storage space"}</DialogTitle>
          <DialogDescription>{location ? "Rename it or change how it looks in the kitchen." : "Give it a name and pick what it looks like."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSave(f); }} className="space-y-3 mt-2">
          <Input placeholder="Name, e.g. Garage fridge" aria-label="Name" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} required />
          <Select value={f.kind} onValueChange={(v) => setF((x) => ({ ...x, kind: v }))}>
            <SelectTrigger aria-label="Type"><SelectValue /></SelectTrigger>
            <SelectContent>{KIND_OPTIONS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent>
          </Select>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" className="bg-emerald-700 hover:bg-emerald-800 text-white">Save</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Selection lives in the page so it survives switching tabs (e.g. jumping in from the Overview).
export function StorageTab({ locations, inventory, selectedId, setSelectedId, detailsOpen, setDetailsOpen, onAddItem, onEditItem }) {
  const [locDialog, setLocDialog] = useState({ open: false, location: null });
  const panelRef = useRef(null);
  const { groups, elsewhere } = useMemo(() => groupByLocation(locations, inventory), [locations, inventory]);

  const units = useMemo(() => {
    const u = locations.map((l) => ({ id: l.id, name: l.name, kind: l.kind, items: groups.get(l.id) || [], location: l }));
    if (elsewhere.length) u.push({ id: ELSEWHERE_ID, name: "Out on the counter", kind: "custom", items: elsewhere, location: null });
    return u;
  }, [locations, groups, elsewhere]);
  const selected = units.find((u) => u.id === selectedId) || null;

  const back = () => { setSelectedId(null); setDetailsOpen(false); };

  // Esc zooms back out, unless a dialog or popover is open (they close themselves on Esc first).
  useEffect(() => {
    if (!selectedId) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"],[role="alertdialog"],[data-radix-popper-content-wrapper]')) {
        setSelectedId(null);
        setDetailsOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId, setSelectedId, setDetailsOpen]);

  useEffect(() => {
    if (detailsOpen && panelRef.current) {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      panelRef.current.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }, [detailsOpen]);

  const saveLocation = async (f) => {
    const editing = locDialog.location;
    try {
      if (editing) {
        // The backend keeps items attached to the space when it is renamed.
        await api.put(`/storage-locations/${editing.id}`, { name: f.name, kind: f.kind });
        toast.success("Storage space updated");
      } else {
        const { data } = await api.post("/storage-locations", { name: f.name, kind: f.kind, sort_order: locations.length });
        setSelectedId(data.id);
        toast.success("Storage space added");
      }
      setLocDialog({ open: false, location: null });
      refreshAll();
    } catch (err) { toast.error(err.response?.data?.detail || "Could not save storage space"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {selected ? "Tap a chip for quick actions, or another space to switch." : "Tap a door to step inside."}
        </p>
        <Button size="sm" variant="outline" onClick={() => setLocDialog({ open: true, location: null })}><Plus className="h-4 w-4 mr-1" />Add space</Button>
      </div>
      <p className="sr-only" aria-live="polite">{selected ? `${selected.name} open, ${selected.items.length} items` : "Showing all storage spaces"}</p>

      <KitchenScene
        units={units}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onBack={back}
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen((v) => !v)}
        onEditItem={onEditItem}
        onAddItem={() => onAddItem(selected?.location?.name)}
      />

      {selected && detailsOpen && (
        <div ref={panelRef} className="scroll-mt-4">
          <StoragePanel
              title={selected.name}
            kind={selected.location?.kind || null}
            items={selected.items}
            locations={locations}
            currentName={selected.location?.name}
            onAddItem={() => onAddItem(selected.location?.name)}
            onEditItem={onEditItem}
            onEditLocation={selected.location ? () => setLocDialog({ open: true, location: selected.location }) : null}
          />
        </div>
      )}
      <LocationDialog location={locDialog.location} open={locDialog.open} setOpen={(v) => setLocDialog((d) => ({ ...d, open: v }))} onSave={saveLocation} />
    </div>
  );
}
