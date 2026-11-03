import { useEffect, useState } from "react";
import { Loader2, MessageSquareText } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CodeInput } from "./CodeInput";
import { useCountdown } from "./useCountdown";

/** Step two of adding text messages: the code that just arrived on the phone proves the number is theirs. */
export function SmsCodeDialog({ pending, onClose, onDone }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [wait, startWait] = useCountdown();
  useEffect(() => { setCode(""); setProblem(""); if (pending) startWait(pending.resend_in || 60); }, [pending, startWait]);

  const confirm = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true); setProblem("");
    try {
      const { data } = await api.post("/auth/2fa/sms/confirm", { code: value });
      await onDone(data);
    } catch (err) {
      setProblem(errorMessage(err, "That code did not work."));
      setCode("");
    } finally { setBusy(false); }
  };

  const resend = async () => {
    setBusy(true); setProblem("");
    try {
      const { data } = await api.post("/auth/2fa/sms/resend");
      startWait(data.resend_in || 60); setCode("");
    } catch (err) {
      setProblem(errorMessage(err, "Could not send another code."));
      const retry = Number(err?.response?.headers?.["retry-after"]);
      if (retry > 0) startWait(retry);
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={!!pending} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-w-md" data-testid="sms-code-dialog">
        <DialogHeader>
          <div className="mb-1 grid h-11 w-11 place-items-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 mx-auto sm:mx-0">
            <MessageSquareText className="h-5 w-5 text-emerald-800 dark:text-emerald-300" aria-hidden="true" />
          </div>
          <DialogTitle>Check your phone</DialogTitle>
          <DialogDescription>We texted a 6-digit code to {pending?.hint}. It works for 5 minutes.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); confirm(); }} className="space-y-4">
          <CodeInput value={code} onChange={setCode} onComplete={confirm} label="6-digit code from the text message" testId="sms-code" disabled={busy} autoFocus />
          <button type="button" onClick={resend} disabled={busy || wait > 0} data-testid="sms-resend"
            className="text-sm font-medium text-emerald-800 hover:underline disabled:text-slate-500 disabled:no-underline dark:text-emerald-300">
            {wait > 0 ? `Send another in ${wait}s` : "Send another code"}
          </button>
          <p role="alert" className="min-h-[1.25rem] text-sm text-red-700 dark:text-red-400" data-testid="sms-error">{problem}</p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" disabled={code.length !== 6 || busy} data-testid="sms-confirm" className="bg-emerald-700 hover:bg-emerald-800 text-white">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Turn on"}
              {busy && <span className="sr-only">Working</span>}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
