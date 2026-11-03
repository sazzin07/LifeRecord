import { useCallback, useEffect, useState } from "react";
import { Busy } from "@/components/skeletons";
import { Check, Fingerprint, LifeBuoy, MessageSquareText, Pencil, Plus, ShieldCheck, ShieldOff, Smartphone, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { createPasskey, passkeyBlocker } from "@/lib/webauthn";
import { Card, Label } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StepUpDialog } from "./StepUpDialog";
import { AuthenticatorDialog } from "./AuthenticatorDialog";
import { SmsCodeDialog } from "./SmsCodeDialog";
import { RecoveryCodesDialog } from "./RecoveryCodesDialog";

const when = (ms) => (ms ? new Date(ms).toLocaleDateString(undefined, { dateStyle: "medium" }) : "");

/** A name for the passkey that says where it lives, so a list of several is easy to read. */
function suggestName(credential) {
  if (credential?.authenticatorAttachment === "cross-platform") return "Security key";
  const ua = navigator.userAgent || "";
  if (/iPhone|iPad/.test(ua)) return "iPhone or iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux PC";
  return "";
}

function Method({ icon: Icon, title, hint, state, action, testId, children }) {
  return (
    <li className="rounded-xl border border-border p-3.5" data-testid={testId}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 dark:bg-slate-800">
            <Icon className="h-[18px] w-[18px] text-slate-700 dark:text-slate-300" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {title}
              {state && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" data-testid={`${testId}-state`}>{state}</span>}
            </p>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{hint}</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 sm:justify-end">{action}</div>
      </div>
      {children}
    </li>
  );
}

function PasskeyItem({ item, onRename, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(item.name);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    const next = name.trim();
    if (!next || next === item.name) { setEditing(false); setName(item.name); return; }
    setBusy(true);
    try { await onRename(item, next); setEditing(false); } finally { setBusy(false); }
  };
  return (
    <li className="flex items-center gap-2 py-2" data-testid={`passkey-${item.id}`}>
      <Fingerprint className="h-4 w-4 shrink-0 text-slate-500" aria-hidden="true" />
      {editing ? (
        <form onSubmit={save} className="flex min-w-0 flex-1 items-center gap-1.5">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus aria-label="Name for this passkey" className="h-8" data-testid="passkey-name-input" />
          <Button type="submit" size="icon" variant="outline" className="h-8 w-8 shrink-0" disabled={busy} aria-label="Save name" data-testid="passkey-name-save"><Check className="h-4 w-4" /></Button>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => { setEditing(false); setName(item.name); }} aria-label="Cancel renaming"><X className="h-4 w-4" /></Button>
        </form>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{item.name}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">Added {when(item.created_ms)} · {item.last_used_ms ? `last used ${when(item.last_used_ms)}` : "not used yet"}</p>
          </div>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setEditing(true)} aria-label={`Rename ${item.name}`} data-testid={`passkey-rename-${item.id}`}><Pencil className="h-4 w-4" /></Button>
          <Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-red-700 hover:text-red-800 dark:text-red-400" onClick={() => onRemove(item)}
            aria-label={`Remove ${item.name}`} data-testid={`passkey-remove-${item.id}`}><Trash2 className="h-4 w-4" /></Button>
        </>
      )}
    </li>
  );
}

/** Two-step sign-in: a second proof on top of the password, by any mix of an authenticator app, passkeys or security keys, and text
 *  messages. Off until the person adds one; every change asks for the password and, once it is on, for a proof of the second step. */
export function TwoFactor() {
  const [status, setStatus] = useState(null);   // { enabled, methods, passkeys, sms, recovery_codes_left }
  const [flow, setFlow] = useState(null);       // the change being confirmed: { kind, passkey? }
  const [phone, setPhone] = useState("");
  const [setup, setSetup] = useState(null);     // authenticator secret + link, while it is being scanned
  const [smsPending, setSmsPending] = useState(null);
  const [codes, setCodes] = useState([]);
  const blocker = passkeyBlocker();

  const load = useCallback(() => api.get("/auth/2fa").then((r) => setStatus(r.data)).catch(() => setStatus({ enabled: false, methods: [], passkeys: [], sms: { enabled: false, available: false }, recovery_codes_left: 0 })), []);
  useEffect(() => { load(); }, [load]);

  const closeFlow = (open) => { if (!open) { setFlow(null); setPhone(""); } };
  const on = !!status?.enabled;
  const has = (m) => !!status?.methods?.includes(m);
  const lastOne = (m) => on && status.methods.length === 1 && (m !== "passkey" || status.passkeys.length === 1);
  const lastWarning = " This is your last sign-in method, so two-step sign-in will turn off and your recovery codes stop working.";

  const finished = async (data, message) => {
    await load();
    if (data?.recovery_codes?.length) setCodes(data.recovery_codes);   // the codes dialog says it all: no toast on top of it
    else if (message) toast.success(message);
  };

  const FLOWS = {
    "totp-add": { title: "Add an authenticator app", description: "Confirm it is you, then scan a picture with your authenticator app.", submit: "Continue" },
    "passkey-add": { title: "Add a passkey", description: "Confirm it is you, then your device or security key creates the passkey.", submit: "Continue" },
    "sms-add": { title: "Add text messages", description: "Confirm it is you, then we text a code to your phone.", submit: "Send the code" },
    "totp-remove": { title: "Remove the authenticator app", description: `Codes from the app will no longer work.${lastOne("totp") ? lastWarning : ""}`, submit: "Remove", danger: true },
    "sms-remove": { title: "Remove text messages", description: `Codes by text will no longer work.${lastOne("sms") ? lastWarning : ""}`, submit: "Remove", danger: true },
    "passkey-remove": { title: `Remove ${flow?.passkey?.name || "this passkey"}`, description: `This passkey will no longer sign you in.${lastOne("passkey") ? lastWarning : ""}`, submit: "Remove", danger: true },
    disable: { title: "Turn off two-step sign-in", description: "Every method and every recovery code will be removed. Your password alone will protect the account.", submit: "Turn off", danger: true },
    "new-codes": { title: "Get new recovery codes", description: "You will get a fresh set. The old codes stop working.", submit: "Make new codes" },
  };
  const current = flow ? FLOWS[flow.kind] : null;

  const confirm = async (body) => {
    switch (flow.kind) {
      case "totp-add": {
        const { data } = await api.post("/auth/2fa/setup", body);
        setSetup(data);
        return;
      }
      case "passkey-add": {
        const { data } = await api.post("/auth/2fa/passkeys/options", body);
        const credential = await createPasskey(data.options);
        const done = await api.post("/auth/2fa/passkeys", { challenge_id: data.challenge_id, credential, name: suggestName(credential) });
        await finished(done.data, "Passkey added");
        return;
      }
      case "sms-add": {
        const { data } = await api.post("/auth/2fa/sms/start", { ...body, phone: phone.trim() });
        setSmsPending(data);
        return;
      }
      case "totp-remove":
        await api.post("/auth/2fa/totp/remove", body);
        await finished(null, "Authenticator app removed");
        return;
      case "sms-remove":
        await api.post("/auth/2fa/sms/remove", body);
        await finished(null, "Text messages removed");
        return;
      case "passkey-remove":
        await api.post(`/auth/2fa/passkeys/${flow.passkey.id}/remove`, body);
        await finished(null, "Passkey removed");
        return;
      case "disable":
        await api.post("/auth/2fa/disable", body);
        await finished(null, "Two-step sign-in is off");
        return;
      default: {
        const { data } = await api.post("/auth/2fa/recovery-codes", body);
        await finished(data);
      }
    }
  };

  const rename = async (item, name) => {
    try {
      await api.post(`/auth/2fa/passkeys/${item.id}/rename`, { name });
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Could not rename it"));
      throw err;
    }
  };

  const smsHint = on && has("sms") ? `Codes are texted to ${status.sms.hint}.` : "A 6-digit code sent to your phone. Handy as a back-up; the other two are safer.";
  const left = status?.recovery_codes_left ?? 0;

  return (
    <Card className="p-5" data-testid="two-factor">
      <div className="flex items-start gap-3">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${on ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-slate-100 dark:bg-slate-800"}`}>
          {on ? <ShieldCheck className="h-5 w-5 text-emerald-800 dark:text-emerald-300" aria-hidden="true" /> : <ShieldOff className="h-5 w-5 text-slate-600 dark:text-slate-400" aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <Label>Two-step sign-in</Label>
          <p className="mt-1 text-sm font-semibold" data-testid="two-factor-status" role="status">
            {status === null ? "Checking…" : on ? `On · ${left} recovery code${left === 1 ? "" : "s"} left` : "Off"}
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
        {on ? "Signing in needs your password and one of these. Add a second way so losing one phone never locks you out."
          : "Ask for a second proof as well as your password, so a stolen password alone cannot open your account. Choose any way below."}
      </p>

      {status === null ? (
        <Busy label="Loading sign-in methods" className="mt-4 space-y-2">{[0, 1, 2].map((i) => <div key={i} aria-hidden="true" className="skeleton h-[68px] rounded-xl" />)}</Busy>
      ) : (
        <ul className="mt-4 space-y-2.5">
          <Method icon={Fingerprint} title="Passkeys and security keys" testId="method-passkey" state={has("passkey") ? `${status.passkeys.length} added` : ""}
            hint={blocker || "Your fingerprint, face or screen lock, or a USB key. The safest way: nothing to type, and it only works on the real site."}
            action={<Button variant="outline" disabled={!!blocker || status.passkeys.length >= 10} onClick={() => setFlow({ kind: "passkey-add" })} data-testid="passkey-add">
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" />Add</Button>}>
            {status.passkeys.length > 0 && (
              <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100 dark:divide-slate-800 dark:border-slate-800" data-testid="passkey-list">
                {status.passkeys.map((p) => <PasskeyItem key={p.id} item={p} onRename={rename} onRemove={(item) => setFlow({ kind: "passkey-remove", passkey: item })} />)}
              </ul>
            )}
          </Method>

          <Method icon={Smartphone} title="Authenticator app" testId="method-totp" state={has("totp") ? "On" : ""}
            hint="A 6-digit code from an app on your phone, such as Google Authenticator, Microsoft Authenticator or Aegis."
            action={has("totp")
              ? <Button variant="outline" onClick={() => setFlow({ kind: "totp-remove" })} data-testid="totp-remove">Remove</Button>
              : <Button variant="outline" onClick={() => setFlow({ kind: "totp-add" })} data-testid={on ? "totp-add" : "two-factor-open"}><Plus className="mr-1 h-4 w-4" aria-hidden="true" />{on ? "Add" : "Set up"}</Button>} />

          <Method icon={MessageSquareText} title="Text message" testId="method-sms" state={has("sms") ? "On" : ""}
            hint={status.sms.available ? smsHint : "Needs a text-message provider, which this server does not have yet (see the README)."}
            action={has("sms")
              ? <Button variant="outline" onClick={() => setFlow({ kind: "sms-remove" })} data-testid="sms-remove">Remove</Button>
              : <Button variant="outline" disabled={!status.sms.available} onClick={() => setFlow({ kind: "sms-add" })} data-testid="sms-add"><Plus className="mr-1 h-4 w-4" aria-hidden="true" />{on ? "Add" : "Set up"}</Button>} />

          {on && (
            <Method icon={LifeBuoy} title="Recovery codes" testId="method-recovery" hint={left <= 2 ? `Only ${left} left. Make a new set before you run out.` : "One-time codes for the day you lose your phone. Keep them apart from your password."}
              action={<Button variant="outline" onClick={() => setFlow({ kind: "new-codes" })} data-testid="two-factor-new-codes">New codes</Button>} />
          )}
        </ul>
      )}

      {on && (
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Button variant="ghost" className="text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-400 dark:hover:bg-red-950/30" onClick={() => setFlow({ kind: "disable" })} data-testid="two-factor-turn-off-open">
            Turn off two-step sign-in
          </Button>
        </div>
      )}

      {current && (
        <StepUpDialog open onOpenChange={closeFlow} status={status} title={current.title} description={current.description} submitLabel={current.submit} danger={current.danger}
          canSubmit={flow.kind !== "sms-add" || phone.trim().length >= 8} onConfirm={confirm}
          extra={flow.kind === "sms-add" ? (
            <div>
              <label htmlFor="sms-phone" className="text-sm font-medium">Mobile number, with country code</label>
              <Input id="sms-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+351 912 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" data-testid="sms-phone" />
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Standard message rates may apply. We only use it for sign-in codes.</p>
            </div>
          ) : null} />
      )}

      <AuthenticatorDialog setup={setup} onClose={() => { setSetup(null); load(); }}
        onDone={async (data) => { setSetup(null); await finished(data, "Authenticator app added"); }} />
      <SmsCodeDialog pending={smsPending} onClose={() => { setSmsPending(null); load(); }}
        onDone={async (data) => { setSmsPending(null); await finished(data, "Text messages added"); }} />
      <RecoveryCodesDialog codes={codes} onClose={() => setCodes([])} />
    </Card>
  );
}
