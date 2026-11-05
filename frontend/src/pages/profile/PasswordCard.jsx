import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Eye, EyeOff, KeyRound, ShieldCheck, Sparkles, X } from "lucide-react";
import { api, replacingSession, setAccessToken } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Input } from "@/components/ui/input";
import { StepUpDialog } from "@/components/twofactor/StepUpDialog";
import { Section } from "@/components/settings/controls";
import { checksFor, strength, suggestPassword } from "@/lib/passwordStrength";
import { useTwoFactorStatus } from "./useTwoFactorStatus";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const BAR = ["var(--mny-neg)", "var(--mny-neg)", "var(--mny-amber)", "var(--mny-green)", "var(--mny-green)"];   // weak is the spend colour, so-so the locked one, strong the gain one

/** Four segments that fill as the password gets stronger, with a word for it. */
function Meter({ score, label, tip }) {
  return (
    <div data-testid="pw-strength" aria-live="polite">
      <div className="flex gap-1.5" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="mny-bar !h-1.5 flex-1">
            <motion.span initial={false} animate={{ width: score >= i ? "100%" : "0%" }} transition={{ duration: 0.3, ease: [0.2, 0, 0, 1] }} style={{ background: BAR[score] }} />
          </span>
        ))}
      </div>
      <p className="mt-1.5 text-xs">
        <span className="mny-title font-medium">{label}</span>
        {tip && <span className="mny-muted"> · {tip}</span>}
      </p>
    </div>
  );
}

export function PasswordCard({ index }) {
  const { user } = useAuth();
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const status = useTwoFactorStatus(open);

  // "Different from the current password" is checked by the server when the current one is entered in the dialog, so it is not listed here.
  const checks = checksFor(next, { email: user?.email }).filter((c) => c.id !== "different");
  const s = strength(next, { email: user?.email });
  const matches = again.length > 0 && again === next;
  const ready = checks.every((c) => c.ok) && matches;
  const type = show ? "text" : "password";

  const suggest = () => { const p = suggestPassword(); setNext(p); setAgain(p); setShow(true); };

  const change = async (proof) => {
    const { data } = await replacingSession(api.post("/auth/change-password", { current_password: proof.password, new_password: next, ...(proof.code ? { code: proof.code } : {}), ...(proof.passkey ? { passkey: proof.passkey } : {}) }));
    // Changing the password ends every other session; this device carries on with the fresh tokens.
    if (data.token) setAccessToken(data.token);
    setNext(""); setAgain(""); setShow(false); 
    toast.success("Password changed", { description: "Every other device was signed out, and we emailed you a notice." });
  };

  return (
    <Section id="password" index={index} className="h-full" icon={KeyRound} title="Password" description="Choose a new one. Other devices are signed out when it changes.">
      <form onSubmit={(e) => { e.preventDefault(); if (ready) setOpen(true); }} data-testid="change-password-form" className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
        <div>
            <label htmlFor="pw-new" className="mny-title text-sm font-medium">New password</label>
            <div className="relative mt-1">
              <Input id="pw-new" type={type} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="mny-field h-11 pr-11" data-testid="pw-new" aria-describedby="pw-rules" />
              <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide passwords" : "Show passwords"} aria-pressed={show} className="mny-icon-btn absolute right-1.5 top-1.5">
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <AnimatePresence initial={false}>
              {next && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="pt-2"><Meter {...s} /></div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
  
          <div>
            <label htmlFor="pw-confirm" className="mny-title text-sm font-medium">Repeat it</label>
            <Input id="pw-confirm" type={type} autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className="mny-field mt-1 h-11" data-testid="pw-confirm" />
            <p aria-live="polite" className={cn("mt-1.5 h-4 text-xs", matches ? "mny-green" : "mny-neg")}>
              {again && (matches ? "The two match." : "The two do not match yet.")}
            </p>
          </div>
        </div>

        <ul id="pw-rules" className="grid gap-1.5 sm:grid-cols-2" aria-label="What a new password needs">
          {checks.map((c) => (
            <li key={c.id} className={cn("flex items-center gap-2 text-xs transition-colors", c.ok ? "mny-green" : "mny-muted")}>
              <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-full border", c.ok ? "border-transparent text-[var(--mny-on-grad)]" : "border-[var(--mny-line)]")} style={c.ok ? { background: "var(--mny-grad)" } : undefined}>
                {c.ok ? <Check className="h-2.5 w-2.5" aria-hidden="true" /> : <X className="h-2.5 w-2.5 opacity-40" aria-hidden="true" />}
              </span>
              {c.label}<span className="sr-only">{c.ok ? " (done)" : " (not yet)"}</span>
            </li>
          ))}
        </ul>
        <p className="mny-muted text-xs">We also refuse passwords that appear in known data leaks, and ones that are too common.</p>

        <div className="mny-tile flex gap-3 p-3.5">
          <ShieldCheck className="mny-green mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="mny-muted text-sm">
            To change it we ask for your <span className="mny-title font-medium">current password</span>{status.enabled && <> and <span className="mny-title font-medium">a code from your second step</span></>}.
            Then every other phone, tablet and browser is signed out, and we email you a notice.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="mny-pill sm" onClick={suggest} data-testid="pw-suggest"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />Suggest a strong one</button>
          <button type="submit" disabled={!ready} className="mny-pill mny-cta" data-testid="pw-save"><KeyRound className="h-4 w-4" aria-hidden="true" />Change password</button>
        </div>
      </form>

      <StepUpDialog open={open} onOpenChange={setOpen} status={status} submitLabel="Change password" danger={false}
        title="Confirm it is you"
        description="Enter your current password. When you confirm, every other device is signed out. Keep this tab open until it finishes."
        onConfirm={change} />
    </Section>
  );
}
