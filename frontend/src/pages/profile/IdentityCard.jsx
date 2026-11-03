import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, LogOut, Mail, Pencil, ShieldCheck, X } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Avatar } from "@/components/common";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

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

/** Who you are. The address is how you sign in and where security notices go: it is shown here and cannot be edited. */
export function IdentityCard({ index, onSignOutAll }) {
  const { user, logout } = useAuth();
  return (
    <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.2, 0, 0, 1], delay: index * 0.05 }}
      className="mny-card mny-hero flex flex-wrap items-center gap-x-5 gap-y-4 p-5 sm:p-6" aria-label="Your profile">
      <Avatar name={user?.name || "?"} size="h-16 w-16" />
      <div className="min-w-[12rem] flex-1 space-y-0.5">
        <NameEditor />
        <p className="mny-muted flex flex-wrap items-center gap-x-2 text-sm"><Mail className="h-3.5 w-3.5" aria-hidden="true" /><span className="break-all" data-testid="profile-email">{user?.email}</span>
          {user?.email_verified && <span className="mny-state"><ShieldCheck className="h-3 w-3" aria-hidden="true" />Verified</span>}
        </p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
        <button type="button" className="mny-pill" onClick={logout} data-testid="settings-logout"><LogOut className="h-4 w-4" aria-hidden="true" />Sign out</button>
        <button type="button" className="mny-pill" onClick={onSignOutAll} data-testid="settings-logout-all">Sign out on all devices</button>
      </div>
    </motion.section>
  );
}
