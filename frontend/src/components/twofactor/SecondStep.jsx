import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ChevronRight, Fingerprint, LifeBuoy, Loader2, MessageSquareText, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { errorMessage } from "@/lib/api";
import { passkeyBlocker } from "@/lib/webauthn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CodeInput } from "./CodeInput";
import { useCountdown } from "./useCountdown";

const WAYS = {
  passkey: { icon: Fingerprint, name: "Passkey or security key", title: "Use your passkey", intro: "Confirm with your fingerprint, face, screen lock or security key." },
  totp: { icon: Smartphone, name: "Authenticator app", title: "Enter your code", intro: "Open your authenticator app and type the 6-digit code for Life Record." },
  sms: { icon: MessageSquareText, name: "Text message", title: "Check your phone", intro: "We can text a 6-digit code to your phone." },
  recovery: { icon: LifeBuoy, name: "Recovery code", title: "Use a recovery code", intro: "Type one of the codes you saved when you turned two-step sign-in on. Each works once." },
};

/** The second half of signing in, after a correct password: one way at a time, with the other ways one tap away. Calls
 *  `onSignedIn()` when the session has started and `onBack()` to return to the password. */
export function SecondStep({ challenge, methods, smsHint, onSignedIn, onBack }) {
  const { loginWithCode, loginWithPasskey, sendLoginText, loginWithText } = useAuth();
  const reduce = useReducedMotion();
  const ways = useMemo(() => [...methods.filter((m) => m !== "passkey" || !passkeyBlocker()), "recovery"], [methods]);
  const [way, setWay] = useState(ways[0]);
  const [code, setCode] = useState("");
  const [texted, setTexted] = useState(false);
  const [wait, startWait] = useCountdown();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const submitting = useRef(false);   // the last digit completes the code AND the form may be submitted: only one request goes out

  useEffect(() => { setCode(""); setProblem(""); setTexted(false); startWait(0); }, [way, startWait]);

  const run = async (call) => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setProblem("");
    try {
      await call();
      onSignedIn();
    } catch (err) {
      setProblem(err?.name === "PasskeyError" ? err.message : errorMessage(err, "Could not sign in. Try again."));
      setCode("");
    } finally { submitting.current = false; setBusy(false); }
  };

  const withPasskey = () => run(() => loginWithPasskey(challenge));
  const withCode = (value = code) => (value.trim().length >= 6 ? run(() => loginWithCode(challenge, value.trim())) : undefined);
  const withText = (value = code) => (value.length === 6 ? run(() => loginWithText(challenge, value)) : undefined);

  const sendText = async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setProblem("");
    try {
      const sent = await sendLoginText(challenge);
      setTexted(true); startWait(sent.resend_in || 60); setCode("");
    } catch (err) {
      setProblem(errorMessage(err, "Could not send the text message."));
      const retry = Number(err?.response?.headers?.["retry-after"]);
      if (retry > 0) startWait(retry);
    } finally { submitting.current = false; setBusy(false); }
  };

  const others = ways.filter((w) => w !== way);
  const info = WAYS[way];
  const motionProps = reduce ? {} : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.18 } };
  const blocker = methods.includes("passkey") ? passkeyBlocker() : null;

  return (
    <motion.div initial={reduce ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="w-full max-w-sm" data-testid="login-totp-form">
      <div className="lg:hidden flex items-center gap-2 mb-8">
        <div className="h-9 w-9 rounded-xl bg-emerald-700 grid place-items-center text-white"><Sparkles className="h-5 w-5" /></div>
        <span className="font-bold text-lg">Life Record</span>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-900/30 grid place-items-center">
          <ShieldCheck className="h-6 w-6 text-emerald-700 dark:text-emerald-300" aria-hidden="true" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Step 2 of 2 · Verify it is you</p>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={way} {...motionProps} data-testid={`login-way-${way}`}>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">{info.title}</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
            {way === "sms" && texted ? `We texted a code to ${smsHint}. It works for 5 minutes.` : info.intro}
          </p>
          {blocker && way !== "passkey" && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-900/20 dark:text-amber-100" data-testid="login-passkey-unsupported">
              Your passkey cannot be used here. {blocker}
            </p>
          )}

          {way === "passkey" && (
            <Button type="button" onClick={withPasskey} disabled={busy} data-testid="login-passkey-button"
              className="w-full h-12 mt-6 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <><Fingerprint className="mr-2 h-5 w-5" aria-hidden="true" />Continue with passkey</>}
              {busy && <span className="sr-only">Waiting for your passkey</span>}
            </Button>
          )}

          {way === "totp" && (
            <form onSubmit={(e) => { e.preventDefault(); withCode(); }}>
              <div className="mt-6"><CodeInput value={code} onChange={setCode} onComplete={withCode} label="6-digit code from your authenticator app" testId="login-totp-code" disabled={busy} autoFocus /></div>
              <Button data-testid="login-totp-submit" type="submit" disabled={busy || code.length !== 6} className="w-full h-11 mt-6 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Sign in"}
              </Button>
            </form>
          )}

          {way === "sms" && (
            texted ? (
              <form onSubmit={(e) => { e.preventDefault(); withText(); }}>
                <div className="mt-6"><CodeInput value={code} onChange={setCode} onComplete={withText} label="6-digit code from the text message" testId="login-sms-code" disabled={busy} autoFocus /></div>
                <Button data-testid="login-sms-submit" type="submit" disabled={busy || code.length !== 6} className="w-full h-11 mt-6 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Sign in"}
                </Button>
                <button type="button" onClick={sendText} disabled={busy || wait > 0} data-testid="login-sms-resend"
                  className="mt-3 w-full text-center text-sm font-medium text-emerald-800 hover:underline disabled:text-slate-500 disabled:no-underline dark:text-emerald-300">
                  {wait > 0 ? `Send another in ${wait}s` : "Send another code"}
                </button>
              </form>
            ) : (
              <Button type="button" onClick={sendText} disabled={busy || wait > 0} data-testid="login-sms-send"
                className="w-full h-12 mt-6 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <><MessageSquareText className="mr-2 h-5 w-5" aria-hidden="true" />{wait > 0 ? `Try again in ${wait}s` : `Text a code to ${smsHint}`}</>}
              </Button>
            )
          )}

          {way === "recovery" && (
            <form onSubmit={(e) => { e.preventDefault(); withCode(); }}>
              <label htmlFor="login-recovery" className="mt-6 block text-sm font-medium text-slate-700 dark:text-slate-300">Recovery code</label>
              <Input id="login-recovery" data-testid="login-recovery" autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={20} placeholder="xxxxx-xxxxx"
                value={code} onChange={(e) => setCode(e.target.value)} className="mt-1.5 h-12 text-center font-mono text-lg tracking-wider" />
              <Button data-testid="login-recovery-submit" type="submit" disabled={busy || code.trim().length < 6} className="w-full h-11 mt-6 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Sign in"}
              </Button>
            </form>
          )}
        </motion.div>
      </AnimatePresence>

      <p role="alert" className="mt-3 min-h-[1.5rem] text-sm text-red-700 dark:text-red-400" data-testid="login-second-error">{problem}</p>

      {others.length > 0 && (
        <nav aria-label="Other ways to verify" className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">Other ways to verify</p>
          <ul className="mt-2 space-y-2">
            {others.map((w) => {
              const Other = WAYS[w].icon;
              return (
                <li key={w}>
                  <button type="button" onClick={() => setWay(w)} disabled={busy} data-testid={`login-use-${w}`}
                    className="flex w-full items-center gap-3 rounded-xl border border-border px-3.5 py-3 text-left text-sm font-medium transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 dark:hover:bg-slate-800">
                    <Other className="h-[18px] w-[18px] shrink-0 text-slate-600 dark:text-slate-400" aria-hidden="true" />
                    <span className="flex-1">{WAYS[w].name}</span>
                    <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      <button type="button" onClick={onBack} disabled={busy} data-testid="login-back"
        className="mt-5 inline-flex w-full items-center justify-center gap-1.5 text-center text-sm font-medium text-emerald-700 hover:text-emerald-800 dark:text-emerald-300">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to the password
      </button>
    </motion.div>
  );
}
