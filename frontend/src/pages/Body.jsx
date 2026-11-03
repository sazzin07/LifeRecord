import { useState, useRef, useEffect } from "react";
import { Busy, ErrorBlock, Sk, SkChart } from "@/components/skeletons";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { Plus, Trash2, Scale, Camera, GitCompare, X, Pencil } from "lucide-react";
import { api, API, errorMessage, getAccessToken } from "@/lib/api";
import { useFetch, refreshAll } from "@/lib/useFetch";
import { Card, StatCard, SectionHeading, EmptyState, Label } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function SecurePhoto({ src, alt, className }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let objectUrl = null;
    const load = async () => {
      try {
        const token = getAccessToken();
        const res = await fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!res.ok) return;
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        setUrl(null);
      }
    };
    load();
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);
  if (!url) return <div className={cn("bg-slate-100 dark:bg-slate-800 animate-pulse", className)} />;
  return <img src={url} alt={alt} className={className} />;
}

const photoSrc = (p) => `${API}/photos/file/${p.storage_path}`;

/** Edit a weight check-in (`kind` "weight") or a progress photo's date and note (`kind` "photo"). */
function EditEntryDialog({ entry, kind, onClose }) {
  const [form, setForm] = useState({ weight: "", date: "", note: "" });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (entry) setForm({ weight: entry.weight != null ? String(entry.weight) : "", date: entry.date || "", note: entry.note || "" });
  }, [entry]);

  const save = async () => {
    const weight = parseFloat(form.weight);
    if (kind === "weight" && !(weight > 0)) { toast.error("Enter a weight in kg"); return; }
    setSaving(true);
    try {
      if (kind === "weight") await api.put(`/weight/${entry.id}`, { weight, date: form.date, note: form.note });
      else await api.put(`/photos/${entry.id}`, { date: form.date, note: form.note });
      toast.success(kind === "weight" ? "Check-in updated" : "Photo updated");
      refreshAll();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, "Could not save changes"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!entry} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm" data-testid="body-edit-dialog">
        <DialogHeader>
          <DialogTitle>{kind === "weight" ? "Edit check-in" : "Edit photo"}</DialogTitle>
          <DialogDescription className="sr-only">{kind === "weight" ? "Change the weight, date or note" : "Change the photo's date or note"}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {kind === "weight" && (
            <div><Label>Weight (kg)</Label><Input type="number" step="0.1" value={form.weight} onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))} className="mt-1" data-testid="body-edit-weight" /></div>
          )}
          <div><Label>Date</Label><DatePicker value={form.date} onChange={(v) => v && setForm((f) => ({ ...f, date: v }))} clearable={false} className="mt-1" aria-label="Date" /></div>
          <div><Label>Note</Label><Input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Optional" className="mt-1" data-testid="body-edit-note" /></div>
          <Button onClick={save} disabled={saving} className="w-full bg-emerald-700 hover:bg-emerald-800 text-white" data-testid="body-edit-save">Save changes</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Body() {
  const { data: weight, loading, error: weightError, reload: reloadWeight } = useFetch("/weight");
  const { data: photos, error: photosError, reload: reloadPhotos } = useFetch("/photos");
  const [w, setW] = useState("");
  const [compare, setCompare] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [deleteWeightId, setDeleteWeightId] = useState(null);
  const [deletePhotoId, setDeletePhotoId] = useState(null);
  const [deleteWeightOpen, setDeleteWeightOpen] = useState(false);
  const [deletePhotoOpen, setDeletePhotoOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const fileRef = useRef(null);

  const add = async () => { if (!parseFloat(w)) return; await api.post("/weight", { weight: parseFloat(w) }); setW(""); toast.success("Weight recorded"); refreshAll(); };
  const del = async (id) => { await api.delete(`/weight/${id}`); refreshAll(); };
  const delPhoto = async (id) => { await api.delete(`/photos/${id}`); setCompare((c) => c.filter((x) => x !== id)); refreshAll(); };

  const upload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploading(true);
    const fd = new FormData();
    fd.append("file", f);
    try { await api.post("/photos", fd); toast.success("Photo added"); refreshAll(); }
    catch (err) { toast.error(errorMessage(err, "Could not upload photo")); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const toggleCompare = (id) => setCompare((c) => c.includes(id) ? c.filter((x) => x !== id) : c.length >= 2 ? [c[1], id] : [...c, id]);

  const arr = weight || [];
  const last = arr.length ? arr[arr.length - 1] : null;
  const first = arr.length ? arr[0] : null;
  const delta = last && first ? (last.weight - first.weight).toFixed(1) : null;
  const pics = photos || [];
  const comparePics = compare.map((id) => pics.find((p) => p.id === id)).filter(Boolean);

  return (
    <div className="space-y-6">
      <SectionHeading title="Body" sub="Weekly weight check-ins, trend and progress photos" />
      <div className="grid grid-cols-2 gap-4">
        <StatCard testid="body-current" label="Current" value={last ? `${last.weight} kg` : "—"} icon={Scale} hint={last ? last.date : "No check-in"} />
        <StatCard testid="body-delta" label="Total change" value={delta ? `${delta > 0 ? "+" : ""}${delta} kg` : "—"} accent="text-emerald-600 dark:text-emerald-400" hint="Since first entry" />
      </div>
      <Card className="p-4">
        <div className="flex gap-2">
          <Input placeholder="Weight in kg" type="number" step="0.1" value={w} onChange={(e) => setW(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} data-testid="body-weight-input" />
          <Button onClick={add} className="bg-emerald-700 hover:bg-emerald-800 text-white" data-testid="body-weight-add"><Plus className="h-4 w-4 mr-1" />Check in</Button>
        </div>
      </Card>

      {weightError ? <ErrorBlock what="your weight log" onRetry={reloadWeight} /> : loading ? (
        <Card className="p-5"><Busy label="Loading weight trend"><Sk className="h-3 w-24" /><SkChart className="mt-3" height={200} /></Busy></Card>
      ) : arr.length === 0 ? (
        <Card><EmptyState icon={Scale} title="Your body log starts here" sub="Record your weight to see your trend over time." /></Card>
      ) : (
        <Card className="p-5">
          <Label>Weight trend</Label>
          <ResponsiveContainer width="100%" height={200} className="mt-3">
            <LineChart data={arr}>
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} stroke="#94A3B8" />
              <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 10 }} stroke="#94A3B8" width={30} />
              <Tooltip formatter={(v) => `${v} kg`} contentStyle={{ borderRadius: 12, fontSize: 12 }} />
              <Line type="monotone" dataKey="weight" stroke="#10B981" strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Progress photos */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2"><Camera className="h-4 w-4 text-emerald-600" /><h3 className="font-semibold">Progress photos</h3><span className="text-xs text-slate-400">private</span></div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={upload} data-testid="photo-input" />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} data-testid="photo-upload-btn"><Plus className="h-4 w-4 mr-1" />{uploading ? "Uploading…" : "Add photo"}</Button>
        </div>

        {comparePics.length === 2 && (
          <div className="mb-4 rounded-xl border border-emerald-200 dark:border-emerald-500/30 p-3" data-testid="compare-view">
            <div className="flex items-center gap-2 mb-2 text-sm font-medium text-emerald-700 dark:text-emerald-300"><GitCompare className="h-4 w-4" />Comparison</div>
            <div className="grid grid-cols-2 gap-3">
              {comparePics.map((p) => (
                <div key={p.id}>
                  <SecurePhoto src={photoSrc(p)} alt={p.date} className="rounded-lg w-full aspect-[3/4] object-cover" />
                  <p className="text-xs text-center text-slate-500 mt-1">{p.date}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {photosError && photos === null ? (
          <ErrorBlock what="your photos" onRetry={reloadPhotos} />
        ) : photos === null ? (
          <Busy label="Loading photos" className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }, (_, i) => <Sk key={i} className="aspect-[3/4] w-full !rounded-lg" />)}
          </Busy>
        ) : pics.length === 0 ? (
          <EmptyState icon={Camera} title="No progress photos yet" sub="Add a photo to start tracking your progress visually. Tap two photos to compare them." />
        ) : (
          <>
            <p className="text-xs text-slate-500 mb-3">Tap photos to compare (up to 2)</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
              {pics.map((p) => (
                <div key={p.id} data-testid={`photo-${p.id}`} className="relative group">
                  <button onClick={() => toggleCompare(p.id)} className={cn("block w-full rounded-lg overflow-hidden border-2 transition-colors", compare.includes(p.id) ? "border-emerald-500" : "border-transparent")}>
                    <SecurePhoto src={photoSrc(p)} alt={p.date} className="w-full aspect-[3/4] object-cover" />
                  </button>
                  <span className="absolute bottom-1 left-1 right-1 text-[10px] text-white bg-black/50 rounded px-1 text-center">{p.date}</span>
                  <button onClick={() => setEditing({ kind: "photo", entry: p })} aria-label={`Edit photo from ${p.date}`} className="absolute top-1 left-1 h-6 w-6 grid place-items-center rounded-full bg-black/50 text-white sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100" data-testid={`photo-edit-${p.id}`}><Pencil className="h-3 w-3" /></button>
                  <button onClick={() => { setDeletePhotoId(p.id); setDeletePhotoOpen(true); }} aria-label={`Delete photo from ${p.date}`} className="absolute top-1 right-1 h-6 w-6 grid place-items-center rounded-full bg-black/50 text-white sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100" data-testid={`photo-del-${p.id}`}><X className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {arr.length > 0 && (
        <Card>
          <div className="divide-y divide-border">
            {[...arr].reverse().map((e) => (
              <div key={e.id} data-testid={`weight-${e.id}`} className="flex items-center gap-3 px-5 py-3 group">
                <span className="stat-num font-semibold">{e.weight} kg</span>
                <span className="text-sm text-slate-500">{e.date}</span>
                <span className="text-xs text-slate-400 flex-1 truncate">{e.note}</span>
                <button onClick={() => setEditing({ kind: "weight", entry: e })} aria-label={`Edit check-in from ${e.date}`} data-testid={`weight-edit-${e.id}`} className="sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-slate-400 hover:text-emerald-600"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => { setDeleteWeightId(e.id); setDeleteWeightOpen(true); }} aria-label={`Delete check-in from ${e.date}`} className="sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 text-slate-400 hover:text-red-500"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <EditEntryDialog entry={editing?.entry} kind={editing?.kind} onClose={() => setEditing(null)} />

      <ConfirmDialog
        open={deleteWeightOpen}
        onOpenChange={setDeleteWeightOpen}
        title="Delete weight entry?"
        description="This will permanently delete this weight check-in."
        onConfirm={() => { const id = deleteWeightId; if (id) del(id); }}
        confirmText="Delete"
        variant="danger"
      />

      <ConfirmDialog
        open={deletePhotoOpen}
        onOpenChange={setDeletePhotoOpen}
        title="Delete progress photo?"
        description="This will permanently delete this progress photo. This action cannot be undone."
        onConfirm={() => { const id = deletePhotoId; if (id) delPhoto(id); }}
        confirmText="Delete"
        variant="danger"
      />
    </div>
  );
}
