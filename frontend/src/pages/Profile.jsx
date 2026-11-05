import { useState } from "react";
import { followPointer } from "@/lib/pointerLight";
import { MotionConfig } from "framer-motion";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { AccountTabs } from "@/components/AccountTabs";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { YourData } from "@/components/YourData";
import { Sessions } from "@/components/Sessions";
import { TwoFactor } from "@/components/twofactor/TwoFactor";
import { IdentityCard } from "@/pages/profile/IdentityCard";
import { PasswordCard } from "@/pages/profile/PasswordCard";
import { toast } from "sonner";
import "@/styles/money.css";

export default function Profile() {
  const { logout } = useAuth();
  const { animations } = useSettings();
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
    <MotionConfig reducedMotion={animations ? "user" : "always"}>
      <div className="mny-theme mny-stage space-y-4 sm:space-y-5" onPointerMove={followPointer}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-1">
          <div className="min-w-0">
            <h2 className="mx-title">Profile</h2>
            <p className="mny-muted mt-0.5 text-sm">You, your sign-in and how it is protected. Anything that could lock you out asks for your password first.</p>
          </div>
          <AccountTabs />
        </div>

        <IdentityCard index={0} onSignOutAll={() => setSignOutAllOpen(true)} />

        <ConfirmDialog
          open={signOutAllOpen}
          onOpenChange={setSignOutAllOpen}
          title="Sign out on all devices?"
          description="Every phone, tablet and browser signed in to your account, including this one, will have to sign in again. Use this if you lost a device or think someone else had access."
          onConfirm={signOutEverywhere}
          confirmText="Sign out everywhere"
          variant="danger"
        />

        {/* Password and two-step: two cards of one height. Devices and your data: horizontal, full width, their items side by side. */}
        <div className="grid items-stretch gap-4 sm:gap-5 lg:grid-cols-2">
          <PasswordCard index={1} />
          <TwoFactor />
        </div>
        <Sessions />
        <YourData />
      </div>
    </MotionConfig>
  );
}
