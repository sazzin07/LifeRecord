import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Box, Plus, Rows3 } from "lucide-react";
import { api } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Busy } from "@/components/skeletons";
import { KitchenScene } from "./KitchenScene";
import { StoragePanel } from "./StoragePanel";
import { ELSEWHERE_ID, groupByLocation } from "./shared";

// three.js is large: it loads only when this tab opens, in a chunk of its own.
const StorageStage = lazy(() => import("./StorageStage"));
const FLAT_KEY = "lr-groceries-flat";
const readFlat = () => { try { return localStorage.getItem(FLAT_KEY) === "1"; } catch { return false; } };

/** Same box as the room, so nothing moves when the room arrives. */
function StageSkeleton() {
  return (
    <Busy label="Loading the kitchen">
      <div className="gt-stage" data-skeleton="" aria-hidden="true">
        <div className="gt-scene"><div className="gt-k3d"><span className="sk-ph" style={{ position: "absolute", inset: 0 }} /></div><div className="gt-chipbar"><span className="gt-chip sk-ph">Fridge 0</span></div><div className="gt-cap"><span className="sk-ph">Your kitchen</span></div></div>
        <div className="gt-side"><div className="gt-card"><p className="gt-eyebrow"><span className="sk-ph">Open a unit</span></p></div></div>
      </div>
    </Busy>
  );
}

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
export function StorageTab({ locations, inventory, selectedId, setSelectedId, detailsOpen, setDetailsOpen, onAddItem, onEditItem, selectedListId }) {
  const [locDialog, setLocDialog] = useState({ open: false, location: null });
  const [flat, setFlat] = useState(readFlat);          // the flat view: chosen, or because the room could not start
  const [issue, setIssue] = useState(null);       // "failed": no WebGL or the context was lost; "slow": the room cannot keep up here
  const [tried, setTried] = useState(false);       // after "3D room" is pressed on purpose the speed check stays out of the way
  const showFlat = flat || !!issue;
  const setFlatView = (v) => { setFlat(v); setTried(!v && !!issue); setIssue(null); try { localStorage.setItem(FLAT_KEY, v ? "1" : "0"); } catch { /* storage may be blocked */ } };
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
    if (!showFlat || !selectedId) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"],[role="alertdialog"],[data-radix-popper-content-wrapper]')) {
        setSelectedId(null);
        setDetailsOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showFlat, selectedId, setSelectedId, setDetailsOpen]);

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
    <div className="gt space-y-4">
      <div className="gt-store-head">
        <p className="text-sm text-slate-500">
          {showFlat ? (selected ? "Tap a chip for quick actions, or another space to switch." : "Tap a door to step inside.") : "Open a door, drag food between units, or pick a space below."}
          {issue === "failed" && " The 3D room could not start here, so this is the flat view."}
          {issue === "slow" && " The 3D room was too slow on this device, so this is the flat view."}
        </p>
        <div className="flex items-center gap-2">
          {issue !== "failed" && (
            <Button size="sm" variant="outline" className="gt-tap" onClick={() => setFlatView(!showFlat)} aria-pressed={showFlat}>
              {showFlat ? <><Box className="h-4 w-4 mr-1" />3D room</> : <><Rows3 className="h-4 w-4 mr-1" />Flat view</>}
            </Button>
          )}
          <Button size="sm" variant="outline" className="gt-tap" onClick={() => setLocDialog({ open: true, location: null })}><Plus className="h-4 w-4 mr-1" />Add space</Button>
        </div>
      </div>

      {showFlat ? (
        <>
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
        </>
      ) : (
        <Suspense fallback={<StageSkeleton />}>
          <StorageStage
            units={units}
            selectedId={selectedId}
            onSelect={setSelectedId}
            detailsOpen={detailsOpen}
            onToggleDetails={() => setDetailsOpen((v) => !v)}
            onEditItem={onEditItem}
            onAddItem={onAddItem}
            onFailed={() => setIssue("failed")}
            onSlow={() => setIssue("slow")}
            noProbe={tried}
            selectedListId={selectedListId}
          />
        </Suspense>
      )}

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
