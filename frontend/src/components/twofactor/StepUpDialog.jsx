import { useEffect, useMemo, useState } from "react";
import { Fingerprint, KeyRound, LifeBuoy, Loader2, MessageSquareText, Smartphone } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { getPasskey, passkeyBlocker } from "@/lib/webauthn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CodeInput } from "./CodeInput";
import { useCountdown } from "./useCountdown";

const CHOICES = {
  passkey: { label: "Passkey", icon: Fingerprint },
  totp: { label: "Authenticator app", icon: Smartphone },
  sms: { label: "Text message", icon: MessageSquareText },
  recovery: { label: "Recovery code", icon: LifeBuoy },
};

/** Every change to someone's sign-in protection asks for the password and, when two-step is on, ONE proof of the second step:
 *  a passkey, a code from the app or by text, or a recovery code. This dialog gathers both and hands them to `onConfirm(body)`,
 *  which makes the call (it may throw: the words go inside the dialog). `extra` is any field the action itself needs. */
export function StepUpDialog({ open, onOpenChange, title, description, status, submitLabel = "Continue", danger = false, extra = null, canSubmit = true, onConfirm }) {
  const proofNeeded = !!status?.enabled;
  const choices = useMemo(() => {
    const have = (status?.methods || []).filter((m) => m !== "passkey" || !passkeyBlocker());
    return [...have, "recovery"];
  }, [status]);
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState(choices[0]);
  const [code, setCode] = useState("");
  const [texted, setTexted] = useState(false);
  const [wait, startWait] = useCountdown();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (!open) { setPassword(""); setCode(""); setTexted(false); setProblem(""); setBusy(false); startWait(0); }
    else setMethod(choices[0]);
  }, [open, choices, startWait]);

  const pick = (next) => { setMethod(next); setCode(""); setProblem(""); };

  const sendText = async () => {
    setBusy(true); setProblem("");
    try {
      const { data } = await api.post("/auth/2fa/proof/sms-send");
      setTexted(true); startWait(data.resend_in || 60);
    } catch (err) {
      setProblem(errorMessage(err, "Could not send the text message."));
    } finally { setBusy(false); }
  };

  const codeReady = method === "recovery" ? code.trim().length >= 6 : code.length === 6;
  const ready = !!password && canSubmit && (!proofNeeded || method === "passkey" || codeReady) && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setProblem("");
    try {
      const body = { password };
      if (proofNeeded) {
        if (method === "passkey") {
          const { data } = await api.post("/auth/2fa/proof/passkey-options");
          body.passkey = { challenge_id: data.challenge_id, credential: await getPasskey(data.options) };
        } else {
          body.code = code.trim();
        }
      }
      await onConfirm(body);
      onOpenChange(false);
    } catch (err) {
      setProblem(err?.name === "PasskeyError" ? err.message : errorMessage(err, "That did not work. Nothing was changed."));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md" data-testid="stepup-dialog">
        <DialogHeader>
          <div className="mb-1 grid h-11 w-11 place-items-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 mx-auto sm:mx-0">
            <KeyRound className="h-5 w-5 text-emerald-800 dark:text-emerald-300" aria-hidden="true" />
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {extra}
          <div>
            <label htmlFor="stepup-password" className="text-sm font-medium">Your password</label>
            <Input id="stepup-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)}
              className="mt-1" data-testid="stepup-password" />
          </div>

          {proofNeeded && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Then confirm with your second step</legend>
              {choices.length > 1 && (
                <div role="radiogroup" aria-label="How to confirm" className="flex flex-wrap gap-1.5">
                  {choices.map((c) => {
                    const Icon = CHOICES[c].icon;
                    return (
                      <button key={c} type="button" role="radio" aria-checked={method === c} onClick={() => pick(c)} data-testid={`stepup-method-${c}`}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          method === c ? "border-emerald-700 bg-emerald-700 text-white" : "border-border text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"}`}>
                        <Icon className="h-4 w-4" aria-hidden="true" />{CHOICES[c].label}
                      </button>
                    );
                  })}
                </div>
              )}
              {method === "passkey" && (
                <p className="text-sm text-slate-600 dark:text-slate-400" data-testid="stepup-passkey-note">Your browser will ask for your passkey when you continue.</p>
              )}
              {method === "totp" && (
                <div>
                  <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">The 6-digit code your authenticator app shows now.</p>
                  <CodeInput value={code} onChange={setCode} label="Code from your authenticator app" testId="stepup-code" />
                </div>
              )}
              {method === "sms" && (
                <div>
                  {!texted ? (
                    <Button type="button" variant="outline" onClick={sendText} disabled={busy} data-testid="stepup-send-sms">
                      <MessageSquareText className="mr-1.5 h-4 w-4" aria-hidden="true" />Text me a code to {status?.sms?.hint}
                    </Button>
                  ) : (
                    <>
                      <p className="mb-2 text-sm text-slate-600 dark:text-slate-400">We texted a code to {status?.sms?.hint}.</p>
                      <CodeInput value={code} onChange={setCode} label="Code from the text message" testId="stepup-code" autoFocus />
                      <button type="button" onClick={sendText} disabled={busy || wait > 0} data-testid="stepup-resend-sms"
                        className="mt-2 text-sm font-medium text-emerald-800 hover:underline disabled:text-slate-500 disabled:no-underline dark:text-emerald-300">
                        {wait > 0 ? `Send again in ${wait}s` : "Send again"}
                      </button>
                    </>
                  )}
                </div>
              )}
              {method === "recovery" && (
                <div>
                  <label htmlFor="stepup-recovery" className="mb-1 block text-sm text-slate-600 dark:text-slate-400">One of your recovery codes. Each works once.</label>
                  <Input id="stepup-recovery" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={20} placeholder="xxxxx-xxxxx"
                    value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" data-testid="stepup-recovery" />
                </div>
              )}
            </fieldset>
          )}

          <p role="alert" className="min-h-[1.25rem] text-sm text-red-700 dark:text-red-400" data-testid="stepup-error">{problem}</p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={!ready} data-testid="stepup-submit"
              className={danger ? "bg-red-700 hover:bg-red-800 text-white" : "bg-emerald-700 hover:bg-emerald-800 text-white"}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : submitLabel}
              {busy && <span className="sr-only">Working</span>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
