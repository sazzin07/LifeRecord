import { useEffect, useRef, useState } from "react";
import { Loader2, ScanBarcode } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

// Product barcodes only (EAN-13 covers Europe, UPC-A North America, EAN-8 small packs). Fewer formats = faster, fewer false reads.
const HINTS = new Map([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A]],
  [DecodeHintType.TRY_HARDER, true],
]);

/** What went wrong with the camera, in words a person can act on. */
export function cameraProblem(err) {
  if (!window.isSecureContext) return "The camera only works on a secure (https) page. Type the barcode instead.";
  if (!navigator.mediaDevices?.getUserMedia) return "This browser cannot open the camera. Type the barcode instead.";
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError": return "Camera access was blocked. Allow it for this site in your browser's settings, or type the barcode instead.";
    case "NotFoundError":
    case "OverconstrainedError": return "No camera was found on this device. Type the barcode instead.";
    case "NotReadableError": return "The camera is being used by another app. Close it and try again, or type the barcode.";
    default: return "The camera could not be started. Type the barcode instead.";
  }
}

/**
 * Reads a product barcode with the camera and reports its digits. The camera is released as soon as a code is read, the dialog
 * is closed or the page is left. Nothing is recorded or uploaded: frames are decoded in the browser.
 */
export default function BarcodeScanner({ open, onOpenChange, onDetected }) {
  const [video, setVideo] = useState(null);
  const [state, setState] = useState("starting"); // starting | scanning | error
  const [message, setMessage] = useState("");
  const done = useRef(false);

  useEffect(() => {
    if (!open || !video) return undefined;
    done.current = false;
    setState("starting"); setMessage("");
    let controls = null;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader(HINTS, { delayBetweenScanAttempts: 120 });
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState("error"); setMessage(cameraProblem());
      return undefined;
    }
    reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, video, (result) => {
      if (!result || done.current) return;
      const code = result.getText();
      if (!/^\d{8,14}$/.test(code)) return; // ignore anything that is not a product number
      done.current = true;
      controls?.stop();
      onDetected(code);
      onOpenChange(false);
    }).then((c) => {
      if (cancelled) { c.stop(); return; }
      controls = c; setState("scanning");
    }).catch((err) => {
      if (cancelled) return;
      setState("error"); setMessage(cameraProblem(err));
    });
    return () => { cancelled = true; controls?.stop(); };
  }, [open, video]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="barcode-scanner">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanBarcode className="h-5 w-5" aria-hidden="true" />Scan a barcode</DialogTitle>
          <DialogDescription>Hold the barcode inside the frame, steady and well lit. The picture stays on your device.</DialogDescription>
        </DialogHeader>
        <div className="relative overflow-hidden rounded-xl bg-slate-900" style={{ aspectRatio: "4 / 3" }}>
          <video ref={setVideo} className="h-full w-full object-cover" playsInline muted aria-label="Camera view" />
          {state === "scanning" && <div className="pointer-events-none absolute inset-x-8 top-1/2 h-px bg-emerald-400/80 shadow-[0_0_8px_2px_rgba(52,211,153,0.6)]" aria-hidden="true" />}
          {state === "starting" && <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-300"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Starting the camera…</div>}
        </div>
        <p role={state === "error" ? "alert" : "status"} className={state === "error" ? "text-sm text-red-700 dark:text-red-300" : "text-sm text-slate-500 dark:text-slate-400"} data-testid="scanner-status">
          {state === "error" ? message : state === "scanning" ? "Looking for a barcode…" : ""}
        </p>
      </DialogContent>
    </Dialog>
  );
}
