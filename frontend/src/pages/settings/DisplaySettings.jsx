import { useState } from "react";
import { CalendarDays, Laptop, MessageSquareText, RotateCcw, ShieldAlert, Sparkles, Utensils } from "lucide-react";
import { Link } from "react-router-dom";
import { useSettings } from "@/context/SettingsContext";
import { openAI } from "@/components/AppShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Switch } from "@/components/ui/switch";
import { Row, SavedBadge, Section, Segmented } from "@/components/settings/controls";
import { toast } from "sonner";

export function CalendarSettings({ index }) {
  const { weekStart, setWeekStart } = useSettings();
  return (
    <Section id="calendar" index={index} icon={CalendarDays} title="Calendar" description="How weeks are laid out." aside={<SavedBadge />}>
      <Row title="Weeks start on" description="The first column of the month grid and the week view.">
        <Segmented label="Weeks start on" value={weekStart} onChange={setWeekStart} testid="week-start"
          options={[{ value: "monday", label: "Monday" }, { value: "sunday", label: "Sunday" }]} />
      </Row>
    </Section>
  );
}

const EXAMPLES = ["Switch to dark mode", "Turn animations off", "Start my weeks on Sunday", "Open Money on today", "Call me Alex"];

export function AssistantSettings({ index }) {
  return (
    <Section id="assistant" index={index} icon={Sparkles} title="Assistant" description="Chat, voice and receipt photos. Your API keys stay on the server and never reach your browser.">
      <p className="mny-title text-sm font-medium">You can ask it to change the everyday settings</p>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label="Examples">
        {EXAMPLES.map((e) => (
          <li key={e}>
            <button type="button" className="mny-pill sm" onClick={() => openAI(e)} data-testid="assistant-example"><MessageSquareText className="h-3 w-3" aria-hidden="true" />{e}</button>
          </li>
        ))}
      </ul>
      <p className="mny-muted mt-2 text-xs">Pick one to open the assistant with it ready to send.</p>
      <div className="mny-tile mt-4 flex gap-3 p-3.5">
        <ShieldAlert className="mny-amber mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="mny-muted text-sm">
          <span className="mny-title font-medium">It cannot touch your sign-in.</span> Your email address, password, two-step methods, devices and your data are only changed on the{" "}
          <Link to="/profile" className="mny-green font-medium underline underline-offset-2">Profile page</Link>, where they ask for your password.
        </p>
      </div>
    </Section>
  );
}

export function NutritionLink({ index }) {
  return (
    <Section id="nutrition" index={index} icon={Utensils} title="Nutrition" description="Your profile, daily targets and meal reminders live next to your food diary.">
      <Link to="/nutrition?tab=goals" className="mny-pill mny-cta" data-testid="settings-nutrition-link">Open nutrition goals</Link>
    </Section>
  );
}

export function DeviceSettings({ index }) {
  const { sideMenu, setSideMenu, sync, setSync, resetAll } = useSettings();
  const [resetOpen, setResetOpen] = useState(false);
  return (
    <Section id="device" index={index} icon={Laptop} title="This device" description="Choices that belong to this screen, and how the rest follow you.">
      <Row title="Side menu" description="A thin strip of icons that opens when you point at it, or the full menu always open. Phones use the bottom bar.">
        <Segmented label="Side menu" value={sideMenu} onChange={setSideMenu} testid="side-menu"
          options={[{ value: "auto", label: "Thin strip" }, { value: "open", label: "Always open" }]} />
      </Row>
      <Row title="Use my choices on all my devices" description="Theme, animations, week start and what Money opens on follow your account, and the assistant can change them. Turn this off to keep this device's own." htmlFor="sync-toggle">
        <Switch id="sync-toggle" checked={sync} onCheckedChange={setSync} aria-label="Use my choices on all my devices" data-testid="sync-toggle" />
      </Row>
      <Row title="Reset the look and display choices" description="Back to theme System, animations on, weeks from Monday, Money on the last 7 days. Your data is not touched.">
        <button type="button" className="mny-pill" onClick={() => setResetOpen(true)} data-testid="settings-reset"><RotateCcw className="h-4 w-4" aria-hidden="true" />Reset</button>
      </Row>
      <ConfirmDialog open={resetOpen} onOpenChange={setResetOpen} title="Reset these choices?" variant="primary" confirmText="Reset"
        description="Theme, animations, week start and what Money opens on go back to their defaults on this device and, if it syncs, on your account. Nothing you recorded changes."
        onConfirm={async () => { await resetAll(); toast.success("Choices reset"); }} />
    </Section>
  );
}
