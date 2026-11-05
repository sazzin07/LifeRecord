import { useState } from "react";
import { CalendarDays, Laptop, RotateCcw } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
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

export function DeviceSettings({ index }) {
  const { sync, setSync, resetAll } = useSettings();
  const [resetOpen, setResetOpen] = useState(false);
  return (
    <Section id="device" index={index} icon={Laptop} title="This device" description="Choices that belong to this screen, and how the rest follow you.">
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
