import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import { Copy, Download, Loader2, ShieldCheck } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Card, Label } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

// Drawn in the browser from the same link, so the secret goes nowhere; loaded only when this screen is opened.
const QrCode = lazy(() => import("qrcode.react").then((m) => ({ default: m.QRCodeSVG })));

/** Two-step sign-in: a code from an authenticator app (and one-time recovery codes) on top of the password. Off until the person
 *  turns it on; nothing is switched on until a code from their app has been typed in. */
export function TwoFactor() {
  const [status, setStatus] = useState(null);       // { enabled, recovery_codes_left }
  const [stage, setStage] = useState("idle");       // idle | password | scan | codes
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState(null);         // { secret, uri }
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [manage, setManage] = useState(false);
  const [mPassword, setMPassword] = useState("");
  const [mCode, setMCode] = useState("");
  const [mProblem, setMProblem] = useState("");

  const load = useCallback(() => api.get("/auth/2fa").then((r) => setStatus(r.data)).catch(() => setStatus({ enabled: false, recovery_codes_left: 0 })), []);
  useEffect(() => { load(); }, [load]);

  const cancel = () => { setStage("idle"); setPassword(""); setCode(""); setSetup(null); setProblem(""); };

  const start = async (e) => {
    e.preventDefault();
    setBusy(true); setProblem("");
    try {
      const { data } = await api.post("/auth/2fa/setup", { password });
      setSetup(data); setPassword(""); setStage("scan");
    } catch (err) {
      setProblem(errorMessage(err, "Could not start the setup."));
    } finally { setBusy(false); }
  };

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true); setProblem("");
    try {
      const { data } = await api.post("/auth/2fa/enable", { code: code.trim() });
      setCodes(data.recovery_codes); setSetup(null); setCode(""); setStage("codes");
    } catch (err) {
      setProblem(errorMessage(err, "That code did not work."));
    } finally { setBusy(false); }
  };

  const saved = async () => { setCodes([]); setStage("idle"); await load(); };

  const copyCodes = async () => {
    try { await navigator.clipboard.writeText(codes.join("\n")); toast.success("Recovery codes copied"); } catch { toast.error("Could not copy: write them down instead"); }
  };
  const downloadCodes = () => {
    const url = URL.createObjectURL(new Blob([`Life Record recovery codes\nEach works once.\n\n${codes.join("\n")}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = "life-record-recovery-codes.txt"; a.click();
    URL.revokeObjectURL(url);
  };

  const closeManage = (open) => { setManage(open); if (!open) { setMPassword(""); setMCode(""); setMProblem(""); } };
  const manageCall = async (path, onDone) => {
    setBusy(true); setMProblem("");
    try {
      const { data } = await api.post(path, { password: mPassword, code: mCode.trim() });
      closeManage(false);
      await onDone(data);
    } catch (err) {
      setMProblem(errorMessage(err, "That did not work. Nothing was changed."));
    } finally { setBusy(false); }
  };
  const turnOff = (e) => { e.preventDefault(); manageCall("/auth/2fa/disable", async () => { toast.success("Two-step sign-in is off"); await load(); }); };
  const newCodes = () => manageCall("/auth/2fa/recovery-codes", async (data) => { setCodes(data.recovery_codes); setStage("codes"); });

  const on = !!status?.enabled;
  const field = "mt-1";

  return (
    <Card className="p-5" data-testid="two-factor">
      <Label>Two-step sign-in</Label>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Asks for a code from an authenticator app as well as your password, so a stolen password alone cannot open your account.
      </p>
      <p className="mt-2 text-sm font-medium" data-testid="two-factor-status" role="status">
        {status === null ? "Checking…" : on ? `On · ${status.recovery_codes_left} recovery code${status.recovery_codes_left === 1 ? "" : "s"} left` : "Off"}
      </p>

      {stage === "idle" && status && (
        <div className="mt-3 flex flex-wrap gap-2">
          {on ? (
            <Button variant="outline" onClick={() => setManage(true)} data-testid="two-factor-manage-open"><ShieldCheck className="h-4 w-4 mr-1" aria-hidden="true" />Manage</Button>
          ) : (
            <Button variant="outline" onClick={() => setStage("password")} data-testid="two-factor-open"><ShieldCheck className="h-4 w-4 mr-1" aria-hidden="true" />Turn on</Button>
          )}
        </div>
      )}

      {stage === "password" && (
        <form onSubmit={start} className="mt-3 space-y-3 max-w-sm">
          <div>
            <label htmlFor="two-factor-password" className="text-sm font-medium">Your password</label>
            <Input id="two-factor-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} data-testid="two-factor-password" />
          </div>
          <p role="alert" className="min-h-[1.25rem] text-sm text-red-700 dark:text-red-400" data-testid="two-factor-error">{problem}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
            <Button type="submit" disabled={!password || busy} data-testid="two-factor-start" className="bg-emerald-700 hover:bg-emerald-800 text-white">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Continue"}
            </Button>
          </div>
        </form>
      )}

      {stage === "scan" && setup && (
        <form onSubmit={confirm} className="mt-3 space-y-3 max-w-md">
          <p className="text-sm">Scan this picture with your authenticator app:</p>
          <Suspense fallback={<div className="h-44 w-44 rounded bg-slate-100 dark:bg-slate-800" aria-hidden="true" />}>
            {/* always black on white, with a quiet margin, even in the dark theme: a scanner needs the contrast */}
            <QrCode value={setup.uri} size={176} level="M" marginSize={2} bgColor="#FFFFFF" fgColor="#000000" role="img"
              aria-label="QR code for your authenticator app" data-testid="two-factor-qr" className="rounded" />
          </Suspense>
          <p className="text-sm">
            Cannot scan it? In the app, add an account and type in this key (or open{" "}
            <a href={setup.uri} data-testid="two-factor-link" className="underline font-medium text-emerald-800 dark:text-emerald-300">this link</a> on the phone that has the app):
          </p>
          <p className="rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 font-mono text-base tracking-wider break-all select-all" data-testid="two-factor-secret">{setup.secret}</p>
          <div>
            <label htmlFor="two-factor-code" className="text-sm font-medium">The 6-digit code the app shows now</label>
            <Input id="two-factor-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} className={`${field} w-40 text-center tracking-widest`} data-testid="two-factor-code" />
          </div>
          <p role="alert" className="min-h-[1.25rem] text-sm text-red-700 dark:text-red-400" data-testid="two-factor-error">{problem}</p>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
            <Button type="submit" disabled={code.trim().length !== 6 || busy} data-testid="two-factor-confirm" className="bg-emerald-700 hover:bg-emerald-800 text-white">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Turn on"}
            </Button>
          </div>
        </form>
      )}

      {stage === "codes" && (
        <div className="mt-3 space-y-3 max-w-md">
          <p className="text-sm font-medium">Save these recovery codes now. They are shown only this once, and each works one time if you lose your phone.</p>
          <ul className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 dark:bg-slate-800 p-3 font-mono text-base" data-testid="two-factor-recovery-codes">
            {codes.map((c) => <li key={c} className="select-all">{c}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={copyCodes} data-testid="two-factor-copy"><Copy className="h-4 w-4 mr-1" aria-hidden="true" />Copy</Button>
            <Button variant="outline" onClick={downloadCodes} data-testid="two-factor-download"><Download className="h-4 w-4 mr-1" aria-hidden="true" />Download</Button>
            <Button onClick={saved} data-testid="two-factor-saved" className="bg-emerald-700 hover:bg-emerald-800 text-white">I have saved them</Button>
          </div>
        </div>
      )}

      <Dialog open={manage} onOpenChange={closeManage}>
        <DialogContent className="max-w-md" data-testid="two-factor-manage-dialog">
          <DialogHeader>
            <DialogTitle>Manage two-step sign-in</DialogTitle>
            <DialogDescription>Needs your password and a current code from your app (or one recovery code).</DialogDescription>
          </DialogHeader>
          <form onSubmit={turnOff} className="space-y-3">
            <div>
              <label htmlFor="two-factor-manage-password" className="text-sm font-medium">Your password</label>
              <Input id="two-factor-manage-password" type="password" autoComplete="current-password" value={mPassword} onChange={(e) => setMPassword(e.target.value)} className={field} data-testid="two-factor-manage-password" />
            </div>
            <div>
              <label htmlFor="two-factor-manage-code" className="text-sm font-medium">Code from your app, or a recovery code</label>
              <Input id="two-factor-manage-code" autoComplete="one-time-code" maxLength={20} value={mCode} onChange={(e) => setMCode(e.target.value)} className={field} data-testid="two-factor-manage-code" />
            </div>
            <p role="alert" className="min-h-[1.25rem] text-sm text-red-700 dark:text-red-400" data-testid="two-factor-manage-error">{mProblem}</p>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={newCodes} disabled={!mPassword || !mCode || busy} data-testid="two-factor-new-codes">New recovery codes</Button>
              <Button type="submit" disabled={!mPassword || !mCode || busy} data-testid="two-factor-turn-off" className="bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Turn off"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
