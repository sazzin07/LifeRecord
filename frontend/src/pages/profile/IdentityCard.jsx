import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, Camera, Check, LogOut, Mail, Pencil, ShieldCheck, ShieldOff, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { UserAvatar, useProfilePhoto } from "@/components/UserAvatar";
import { PhotoDialog } from "./PhotoDialog";
import { useTwoFactorState } from "./useTwoFactorStatus";
import { Sk } from "@/components/skeletons";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import "@/styles/money.css";

/** The display name, edited where it is shown: pencil, type, Enter saves, Esc cancels. */
function NameEditor() {
  const { user, updateUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const input = useRef(null);
  useEffect(() => { if (editing) input.current?.select(); }, [editing]);

  const save = async () => {
    const clean = name.trim();
    if (!clean || clean === user?.name) { setEditing(false); setName(user?.name || ""); return; }
    setBusy(true); setProblem("");
    try {
      const { data } = await api.patch("/auth/me", { name: clean });
      updateUser({ name: data.name });
      setEditing(false);
      toast.success("Name saved");
    } catch (err) { setProblem(errorMessage(err, "Could not save your name")); } finally { setBusy(false); }
  };
  const cancel = () => { setEditing(false); setName(user?.name || ""); setProblem(""); };

  return (
    <div className="min-w-0">
      <AnimatePresence mode="wait" initial={false}>
        {editing ? (
          <motion.form key="edit" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onSubmit={(e) => { e.preventDefault(); save(); }} className="flex items-center gap-1.5">
            <Input ref={input} aria-label="Your name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && cancel()} className="mny-field h-10 w-56 max-w-full" data-testid="name-input" />
            <button type="submit" disabled={busy || !name.trim()} aria-label="Save name" className="mny-icon-btn" data-testid="name-save"><Check className="h-4 w-4" /></button>
            <button type="button" onClick={cancel} aria-label="Cancel" className="mny-icon-btn"><X className="h-4 w-4" /></button>
          </motion.form>
        ) : (
          <motion.div key="show" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-center gap-1.5">
            <p className="mny-title truncate text-xl font-semibold tracking-tight" data-testid="profile-name">{user?.name || "User"}</p>
            <button type="button" onClick={() => { setName(user?.name || ""); setEditing(true); }} aria-label="Edit your name" className="mny-icon-btn" data-testid="name-edit"><Pencil className="h-3.5 w-3.5" /></button>
          </motion.div>
        )}
      </AnimatePresence>
      <p role="alert" className="mny-neg text-xs">{problem}</p>
    </div>
  );
}

const since = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { month: "long", year: "numeric" }); };

/** Who you are, at a glance: photo, name (editable), address (shown, never edited: it is how you sign in and where security notices go),
 *  and three facts: verified, two-step on or off, member since. */
export function IdentityCard({ index, onSignOutAll }) {
  const { user, logout, updateUser } = useAuth();
  const [photoOpen, setPhotoOpen] = useState(false);
  const { status: twoStep, ready: twoStepReady } = useTwoFactorState(0);
  const photoUrl = useProfilePhoto();
  const member = since(user?.created_at);
  return (
    <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.2, 0, 0, 1], delay: index * 0.05 }}
      className="mny-card mny-hero flex flex-wrap items-center gap-x-6 gap-y-4 p-5 sm:p-6" aria-label="Your profile">
      <div className="relative shrink-0">
        <UserAvatar size="h-24 w-24" className="text-2xl" />
        <button type="button" onClick={() => setPhotoOpen(true)} aria-label={user?.photo_version ? "Change your profile photo" : "Add a profile photo"} data-testid="photo-open"
          className="absolute -bottom-1 -right-1 grid h-9 w-9 place-items-center rounded-full border-2 border-[var(--mny-surface)] shadow-md transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mny-green)]"
          style={{ background: "var(--mny-grad)", color: "var(--mny-on-grad)" }}>
          <Camera className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="min-w-[12rem] flex-1 space-y-1.5">
        <NameEditor />
        <p className="mny-muted flex flex-wrap items-center gap-x-2 text-sm"><Mail className="h-3.5 w-3.5" aria-hidden="true" /><span className="break-all" data-testid="profile-email">{user?.email}</span></p>
        <ul className="flex flex-wrap gap-1.5 pt-1" aria-label="About this account">
          {user?.email_verified && <li className="mny-state"><ShieldCheck className="h-3 w-3" aria-hidden="true" />Email verified</li>}
          {twoStepReady ? (
            <li className={twoStep.enabled ? "mny-state" : "mny-state amber"} data-testid="two-step-chip">
              {twoStep.enabled ? <ShieldCheck className="h-3 w-3" aria-hidden="true" /> : <ShieldOff className="h-3 w-3" aria-hidden="true" />}{twoStep.enabled ? "Two-step sign-in on" : "Two-step sign-in off"}
            </li>
          ) : <li aria-hidden="true"><Sk className="h-[1.375rem] w-36 !rounded-full" /></li>}
          {member && <li className="mny-state"><CalendarDays className="h-3 w-3" aria-hidden="true" />Member since {member}</li>}
        </ul>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <button type="button" className="mny-pill" onClick={logout} data-testid="settings-logout"><LogOut className="h-4 w-4" aria-hidden="true" />Sign out</button>
        <button type="button" className="mny-pill" onClick={onSignOutAll} data-testid="settings-logout-all">Sign out on all devices</button>
      </div>
      <PhotoDialog open={photoOpen} onOpenChange={setPhotoOpen} currentUrl={photoUrl} onChanged={(v) => updateUser({ photo_version: v })} />
    </motion.section>
  );
}
