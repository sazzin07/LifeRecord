import { Suspense, lazy, useEffect, useState } from "react";
import { Loader2, Smartphone } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CodeInput } from "./CodeInput";

// Drawn in the browser from the same link, so the secret goes nowhere; loaded only when this screen is opened.
const QrCode = lazy(() => import("qrcode.react").then((m) => ({ default: m.QRCodeSVG })));

/** Step two of adding the authenticator app: scan the picture (or type the key), then prove it works with the code it shows. */
export function AuthenticatorDialog({ setup, onClose, onDone }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  useEffect(() => { setCode(""); setProblem(""); }, [setup]);

  const confirm = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true); setProblem("");
    try {
      const { data } = await api.post("/auth/2fa/enable", { code: value });
      await onDone(data);
    } catch (err) {
      setProblem(errorMessage(err, "That code did not work."));
      setCode("");
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={!!setup} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="authenticator-dialog">
        <DialogHeader>
          <div className="mb-1 grid h-11 w-11 place-items-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 mx-auto sm:mx-0">
            <Smartphone className="h-5 w-5 text-emerald-800 dark:text-emerald-300" aria-hidden="true" />
          </div>
          <DialogTitle>Add your authenticator app</DialogTitle>
          <DialogDescription>Scan the picture with an app such as Google Authenticator, Microsoft Authenticator, Aegis or 1Password.</DialogDescription>
        </DialogHeader>
        {setup && (
          <form onSubmit={(e) => { e.preventDefault(); confirm(); }} className="space-y-4">
            <div className="flex justify-center sm:justify-start">
              <Suspense fallback={<div className="h-44 w-44 rounded bg-slate-100 dark:bg-slate-800" aria-hidden="true" />}>
                {/* always black on white, with a quiet margin, even in the dark theme: a scanner needs the contrast */}
                <QrCode value={setup.uri} size={176} level="M" marginSize={2} bgColor="#FFFFFF" fgColor="#000000" role="img"
                  aria-label="QR code for your authenticator app" data-testid="two-factor-qr" className="rounded-lg border border-border" />
              </Suspense>
            </div>
            <details className="text-sm" data-testid="two-factor-manual">
              <summary className="cursor-pointer font-medium text-emerald-800 dark:text-emerald-300">Cannot scan it?</summary>
              <p className="mt-2">
                In the app, add an account and type in this key (or open{" "}
                <a href={setup.uri} data-testid="two-factor-link" className="underline font-medium text-emerald-800 dark:text-emerald-300">this link</a> on the phone that has the app):
              </p>
              <p className="mt-2 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 font-mono text-base tracking-wider break-all select-all" data-testid="two-factor-secret">{setup.secret}</p>
            </details>
            <div>
              <p className="mb-2 text-sm font-medium">Then type the 6-digit code the app shows now</p>
              <CodeInput value={code} onChange={setCode} onComplete={confirm} label="6-digit code from your authenticator app" testId="two-factor-code" disabled={busy} />
            </div>
            <p role="alert" className="min-h-[1.25rem] text-sm text-red-700 dark:text-red-400" data-testid="two-factor-error">{problem}</p>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={code.length !== 6 || busy} data-testid="two-factor-confirm" className="bg-emerald-700 hover:bg-emerald-800 text-white">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Turn on"}
                {busy && <span className="sr-only">Working</span>}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
