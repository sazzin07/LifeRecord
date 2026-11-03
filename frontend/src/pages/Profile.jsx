import { useState } from "react";
import { LogOut, KeyRound, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { api, errorMessage, setAccessToken } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card, SectionHeading, Label, Avatar } from "@/components/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { AccountTabs } from "@/components/AccountTabs";
import { YourData } from "@/components/YourData";
import { Sessions } from "@/components/Sessions";
import { TwoFactor } from "@/components/twofactor/TwoFactor";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const strongEnough = (p) => p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

function ChangePassword() {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const problem = !f.next ? null : !strongEnough(f.next) ? "At least 8 characters, with a letter and a number."
    : f.next === f.current ? "Choose a password different from the current one."
    : f.confirm && f.confirm !== f.next ? "The two new passwords do not match." : null;
  const ready = f.current && f.next && f.confirm === f.next && !problem;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    try {
      const { data } = await api.post("/auth/change-password", { current_password: f.current, new_password: f.next });
      // Changing the password ends every other session; this device continues on the fresh tokens.
      if (data.token) setAccessToken(data.token);
      toast.success("Password changed", { description: "Other devices were signed out." });
      setF({ current: "", next: "", confirm: "" });
    } catch (err) {
      toast.error(err.response?.status === 429 ? "Too many attempts. Wait a minute and try again." : err.response?.data?.detail || "Could not change password");
    } finally {
      setSaving(false);
    }
  };

  const type = show ? "text" : "password";
  return (
    <Card className="p-5">
      <Label>Password</Label>
      <form onSubmit={submit} className="mt-3 space-y-3" data-testid="change-password-form">
        <Input type={type} autoComplete="current-password" placeholder="Current password" aria-label="Current password" value={f.current} onChange={set("current")} data-testid="pw-current" />
        <div className="grid sm:grid-cols-2 gap-2">
          <Input type={type} autoComplete="new-password" placeholder="New password" aria-label="New password" value={f.next} onChange={set("next")} data-testid="pw-new" />
          <Input type={type} autoComplete="new-password" placeholder="Repeat new password" aria-label="Repeat new password" value={f.confirm} onChange={set("confirm")} data-testid="pw-confirm" />
        </div>
        <p className={cn("text-xs", problem ? "text-red-600 dark:text-red-400" : "text-slate-500")} aria-live="polite">{problem || "At least 8 characters, with a letter and a number."}</p>
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => setShow((v) => !v)} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
            {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}{show ? "Hide passwords" : "Show passwords"}
          </button>
          <Button type="submit" disabled={!ready || saving} className="bg-emerald-700 hover:bg-emerald-800 text-white" data-testid="pw-save"><KeyRound className="h-4 w-4 mr-1" />Change password</Button>
        </div>
      </form>
    </Card>
  );
}

export default function Profile() {
  const { user, logout } = useAuth();
  const [signOutAllOpen, setSignOutAllOpen] = useState(false);

  const signOutEverywhere = async () => {
    try {
      await api.post("/auth/logout-all");
      logout();
    } catch (err) {
      setSignOutAllOpen(false);
      toast.error(errorMessage(err, "Could not sign out on all devices"));
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <SectionHeading title="Profile" sub="You, your sign-in and how it is protected" action={<AccountTabs />} />

      <Card className="p-5 flex flex-wrap items-center gap-4">
        <Avatar name={user?.name || "?"} size="h-14 w-14" />
        <div className="flex-1 min-w-[10rem]">
          <p className="text-lg font-semibold">{user?.name || "User"}</p>
          <p className="text-sm text-slate-500 break-all">{user?.email}</p>
          {user?.email_verified && <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />Email verified</p>}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button variant="outline" onClick={logout} data-testid="settings-logout"><LogOut className="h-4 w-4 mr-1" />Sign out</Button>
          <Button variant="ghost" onClick={() => setSignOutAllOpen(true)} data-testid="settings-logout-all" className="text-slate-500">Sign out on all devices</Button>
        </div>
      </Card>

      <ConfirmDialog
        open={signOutAllOpen}
        onOpenChange={setSignOutAllOpen}
        title="Sign out on all devices?"
        description="Every phone, tablet and browser signed in to your account, including this one, will have to sign in again. Use this if you lost a device or think someone else had access."
        onConfirm={signOutEverywhere}
        confirmText="Sign out everywhere"
        variant="danger"
      />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="space-y-6 min-w-0">
          <ChangePassword />
          <TwoFactor />
        </div>
        <div className="space-y-6 min-w-0">
          <Sessions />
          <YourData />
        </div>
      </div>
    </div>
  );
}
