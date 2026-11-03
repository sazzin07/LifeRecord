import { Copy, Download, LifeBuoy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** The one-time recovery codes, shown once. Clicking beside the box or pressing Escape does not dismiss it: a code that was never
 *  written down is a lockout waiting for a lost phone. */
export function RecoveryCodesDialog({ codes, onClose }) {
  const copy = async () => {
    try { await navigator.clipboard.writeText(codes.join("\n")); toast.success("Recovery codes copied"); } catch { toast.error("Could not copy: write them down instead"); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Life Record recovery codes\nEach works once.\n\n${codes.join("\n")}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = "life-record-recovery-codes.txt"; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Dialog open={codes.length > 0} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="recovery-codes-dialog"
        onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogHeader>
          <div className="mb-1 grid h-11 w-11 place-items-center rounded-full bg-amber-100 dark:bg-amber-900/30 mx-auto sm:mx-0">
            <LifeBuoy className="h-5 w-5 text-amber-800 dark:text-amber-300" aria-hidden="true" />
          </div>
          <DialogTitle>Save your recovery codes</DialogTitle>
          <DialogDescription>
            They are shown only this once. If you ever lose your phone or key, each code signs you in one time. Keep them somewhere safe, apart from your password.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid grid-cols-2 gap-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-3 font-mono text-base" data-testid="two-factor-recovery-codes">
          {codes.map((c) => <li key={c} className="select-all">{c}</li>)}
        </ul>
        <div className="flex gap-2">
          <Button variant="outline" onClick={copy} className="flex-1" data-testid="two-factor-copy"><Copy className="h-4 w-4 mr-1" aria-hidden="true" />Copy</Button>
          <Button variant="outline" onClick={download} className="flex-1" data-testid="two-factor-download"><Download className="h-4 w-4 mr-1" aria-hidden="true" />Download</Button>
        </div>
        <Button onClick={onClose} data-testid="two-factor-saved" className="w-full bg-emerald-700 hover:bg-emerald-800 text-white">I have saved them</Button>
      </DialogContent>
    </Dialog>
  );
}
