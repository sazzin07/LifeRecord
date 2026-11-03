import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, ImagePlus, Loader2, Minus, Plus, Trash2, Undo2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const BOX = 260;                 // the size of the round window the photo is placed in, in pixels on screen
const OUT = 512;                 // the size of the picture that is saved
const MAX_FILE = 15 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_ZOOM = 4;

const Tool = ({ label, onClick, disabled, danger, testid, children }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} data-testid={testid}
    className={`grid h-10 w-10 place-items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 ${danger ? "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40" : "border-border hover:bg-slate-100 dark:hover:bg-slate-800"}`}>
    {children}
  </button>
);

/** The photo, as it is and as it could be: the current one opens in the same round window a new one does, to move and zoom; a button
 *  replaces it with another file; another undoes every change since the dialog opened; another removes it. Cropping is done here, so what
 *  is stored is small, square, and exactly what was seen. */
export function PhotoDialog({ open, onOpenChange, currentUrl, onChanged }) {
  const hasPhoto = !!currentUrl;
  const [src, setSrc] = useState(null);          // what is in the window now
  const [fromFile, setFromFile] = useState(false);   // true: a file chosen in this dialog (its address is ours to release); false: the saved photo
  const [nat, setNat] = useState(null);          // its real size
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);   // "Remove your photo?" is showing
  const [over, setOver] = useState(false);
  const file = useRef(null);
  const img = useRef(null);
  const drag = useRef(null);
  const start = useRef({ zoom: 1, pos: { x: 0, y: 0 } });   // how the picture sat when it was put in the window: "revert" goes back to it

  const base = nat ? Math.max(BOX / nat.w, BOX / nat.h) : 1;   // the smallest size that still fills the window
  const scale = base * zoom;
  const clamp = useCallback((p, s) => ({ x: Math.min(0, Math.max(BOX - nat.w * s, p.x)), y: Math.min(0, Math.max(BOX - nat.h * s, p.y)) }), [nat]);

  // What is in the window, mirrored in refs so the callbacks below decide at once (a state updater runs later, after these have changed). The address of
  // the SAVED photo is shared with the rest of the page and must never be released here; only an address made from a chosen file is ours.
  const fromFileRef = useRef(false);
  const srcRef = useRef(null);
  const dropOurs = () => { if (srcRef.current && fromFileRef.current) URL.revokeObjectURL(srcRef.current); };
  const release = useCallback(() => { dropOurs(); srcRef.current = null; fromFileRef.current = false; setSrc(null); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  /** Put a picture in the window, centred and fitted. `ours` marks an address made from a chosen file. */
  const place = useCallback((url, ours, onFail) => {
    const probe = new Image();
    probe.onload = () => {
      const b = Math.max(BOX / probe.naturalWidth, BOX / probe.naturalHeight);
      const centred = { x: (BOX - probe.naturalWidth * b) / 2, y: (BOX - probe.naturalHeight * b) / 2 };
      if (srcRef.current !== url) dropOurs();
      srcRef.current = url;
      fromFileRef.current = ours;
      setSrc(url);
      setFromFile(ours);
      setNat({ w: probe.naturalWidth, h: probe.naturalHeight });
      setZoom(1);
      setPos(centred);
      start.current = { zoom: 1, pos: centred };
    };
    probe.onerror = () => { if (ours) URL.revokeObjectURL(url); onFail?.(); };
    probe.src = url;
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  // Opening: the saved photo goes straight into the window (nothing to choose first); no photo yet: the choice screen.
  useEffect(() => {
    if (!open) { release(); setNat(null); setFromFile(false); setZoom(1); setProblem(""); setBusy(false); setAsking(false); return; }
    if (currentUrl) place(currentUrl, false);
  }, [open, currentUrl, place, release]);

  const choose = (f) => {
    setProblem("");
    if (!f) return;
    if (!TYPES.includes(f.type)) { setProblem("Use a JPEG, PNG or WebP photo."); return; }
    if (f.size > MAX_FILE) { setProblem("That photo is larger than 15 MB. Choose a smaller one."); return; }
    place(URL.createObjectURL(f), true, () => setProblem("This browser cannot read that file as a photo. Try a JPEG or PNG."));
  };

  const dirty = !!src && !!nat && (fromFile || zoom !== start.current.zoom || pos.x !== start.current.pos.x || pos.y !== start.current.pos.y);

  const revert = () => {
    setProblem(""); setAsking(false);
    if (fromFile) {                                          // back to what was there when the dialog opened
      if (hasPhoto) place(currentUrl, false);
      else { release(); setNat(null); setFromFile(false); setZoom(1); }
    } else { setZoom(start.current.zoom); setPos(start.current.pos); }
  };

  const rezoom = (next) => {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const s2 = base * z;
    const cx = (BOX / 2 - pos.x) / scale, cy = (BOX / 2 - pos.y) / scale;     // keep the middle of the window where it is
    setZoom(z);
    setPos(clamp({ x: BOX / 2 - cx * s2, y: BOX / 2 - cy * s2 }, s2));
  };

  const down = (e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, p: pos }; };
  const move = (e) => { const d = drag.current; if (d) setPos(clamp({ x: d.p.x + e.clientX - d.x, y: d.p.y + e.clientY - d.y }, scale)); };
  const up = () => { drag.current = null; };
  const key = (e) => {
    const step = 14;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (moves) { e.preventDefault(); setPos((p) => clamp({ x: p.x + moves[0], y: p.y + moves[1] }, scale)); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); rezoom(zoom + 0.2); }
    else if (e.key === "-") { e.preventDefault(); rezoom(zoom - 0.2); }
  };

  const save = async () => {
    if (!dirty || busy) return;
    setBusy(true); setProblem("");
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = OUT;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff";                                  // a PNG with see-through parts is not left black in a JPEG
      ctx.fillRect(0, 0, OUT, OUT);
      ctx.drawImage(img.current, -pos.x / scale, -pos.y / scale, BOX / scale, BOX / scale, 0, 0, OUT, OUT);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("export");
      const form = new FormData();
      form.append("file", blob, "photo.jpg");
      const { data } = await api.put("/auth/me/photo", form);
      onChanged(data.photo_version);
      toast.success("Photo updated");
      onOpenChange(false);
    } catch (err) {
      setProblem(errorMessage(err, "Could not save the photo. Nothing was changed."));
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setProblem("");
    try {
      await api.delete("/auth/me/photo");
      onChanged(null);
      toast.success("Photo removed");
      onOpenChange(false);
    } catch (err) { setProblem(errorMessage(err, "Could not remove the photo.")); } finally { setBusy(false); }
  };

  const editing = !!src && !!nat;
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-md" data-testid="photo-dialog">
        <DialogHeader>
          <DialogTitle>Profile photo</DialogTitle>
          <DialogDescription>It shows next to your name in the app. Only you can see it.</DialogDescription>
        </DialogHeader>

        <input ref={file} type="file" accept={TYPES.join(",")} className="sr-only" tabIndex={-1} aria-label="Choose a photo file" data-testid="photo-file"
          onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />

        <AnimatePresence mode="wait" initial={false}>
          {editing ? (
            <motion.div key="adjust" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }} className="flex flex-col items-center gap-4">
              <div role="group" tabIndex={0} aria-label="Photo position. Drag it, or use the arrow keys to move it and plus and minus to zoom." onKeyDown={key}
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="photo-crop"
                className="relative cursor-grab touch-none select-none overflow-hidden rounded-full bg-slate-200 ring-4 ring-emerald-600/70 focus-visible:outline-none focus-visible:ring-emerald-500 active:cursor-grabbing"
                style={{ width: BOX, height: BOX }}>
                <img ref={img} src={src} alt="" draggable={false} className="pointer-events-none absolute left-0 top-0 max-w-none"
                  style={{ width: nat.w * scale, height: nat.h * scale, transform: `translate(${pos.x}px, ${pos.y}px)` }} />
              </div>
              <div className="flex w-full max-w-xs items-center gap-3">
                <button type="button" aria-label="Zoom out" onClick={() => rezoom(zoom - 0.25)} className="grid h-8 w-8 place-items-center rounded-full border border-border hover:bg-slate-100 dark:hover:bg-slate-800"><Minus className="h-4 w-4" /></button>
                <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => rezoom(parseFloat(e.target.value))} aria-label="Zoom" className="h-2 flex-1 accent-emerald-600" data-testid="photo-zoom" />
                <button type="button" aria-label="Zoom in" onClick={() => rezoom(zoom + 0.25)} className="grid h-8 w-8 place-items-center rounded-full border border-border hover:bg-slate-100 dark:hover:bg-slate-800"><Plus className="h-4 w-4" /></button>
              </div>
              <div className="flex items-center gap-2" role="toolbar" aria-label="Photo actions">
                <Tool label="Replace with another photo" onClick={() => file.current?.click()} testid="photo-replace"><ImagePlus className="h-4 w-4" aria-hidden="true" /></Tool>
                <Tool label="Revert changes" onClick={revert} disabled={!dirty || busy} testid="photo-revert"><Undo2 className="h-4 w-4" aria-hidden="true" /></Tool>
                {hasPhoto && <Tool label="Remove photo" onClick={() => setAsking(true)} disabled={busy} danger testid="photo-remove"><Trash2 className="h-4 w-4" aria-hidden="true" /></Tool>}
              </div>
              <AnimatePresence initial={false}>
                {asking && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="w-full overflow-hidden">
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-red-300 p-3 dark:border-red-900">
                      <p className="text-sm">Remove your photo? Your initials show instead.</p>
                      <div className="flex shrink-0 gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setAsking(false)} disabled={busy}>Keep it</Button>
                        <Button type="button" size="sm" onClick={remove} disabled={busy} className="bg-red-700 text-white hover:bg-red-800" data-testid="photo-remove-yes">Remove</Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div key="choose" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }} className="space-y-3">
              <button type="button" onClick={() => file.current?.click()} data-testid="photo-choose"
                onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); choose(e.dataTransfer.files?.[0]); }}
                className={`flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${over ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-900/20" : "border-border hover:bg-slate-50 dark:hover:bg-slate-800/50"}`}>
                <span className="grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"><ImagePlus className="h-6 w-6" aria-hidden="true" /></span>
                <span className="text-sm font-medium">Choose a photo, or drop one here</span>
                <span className="text-xs text-slate-600 dark:text-slate-400">JPEG, PNG or WebP. You can move and zoom it next.</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <p role="alert" className="min-h-[1.25rem] text-sm text-red-700 dark:text-red-400" data-testid="photo-error">{problem}</p>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy} data-testid="photo-cancel">{dirty ? "Cancel" : "Close"}</Button>
          <Button type="button" onClick={save} disabled={!dirty || busy} className="bg-emerald-700 text-white hover:bg-emerald-800" data-testid="photo-save">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <><Camera className="mr-1.5 h-4 w-4" aria-hidden="true" />Save photo</>}
            {busy && <span className="sr-only">Saving</span>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
