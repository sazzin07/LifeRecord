import { MotionConfig, motion } from "framer-motion";
import { followPointer } from "@/lib/pointerLight";
import { useSearchParams } from "react-router-dom";
import { CalendarDays, Laptop, Palette, Wallet } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { useFetch } from "@/lib/useFetch";
import { AccountTabs } from "@/components/AccountTabs";
import { Appearance } from "@/pages/settings/Appearance";
import { MoneySettings } from "@/pages/settings/MoneySettings";
import { CalendarSettings, DeviceSettings } from "@/pages/settings/DisplaySettings";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "money", label: "Money", icon: Wallet },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  { id: "device", label: "This device", icon: Laptop },
];

export default function Settings() {
  const { animations } = useSettings();
  const { data: cats } = useFetch("/categories");
  const { data: accounts } = useFetch("/accounts");
  // The tab lives in the address (?section=money), so a reload, Back and a shared link land on the same one.
  const [params, setParams] = useSearchParams();
  const active = TABS.some((t) => t.id === params.get("section")) ? params.get("section") : TABS[0].id;
  const pick = (id) => setParams(id === TABS[0].id ? {} : { section: id }, { replace: true });

  const panel = {
    appearance: <Appearance index={0} />,
    money: <MoneySettings index={0} accounts={accounts} cats={cats} />,
    calendar: <CalendarSettings index={0} />,
    device: <DeviceSettings index={0} />,
  }[active];

  const onKey = (e) => {
    // From the tab that has focus (a click may not have been drawn yet), not from the one the address names.
    const from = e.target.closest?.('[role="tab"]')?.id?.replace("settings-tab-", "") || active;
    const i = TABS.findIndex((t) => t.id === from);
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = TABS[(i + step + TABS.length) % TABS.length];
    pick(next.id);
    document.getElementById(`settings-tab-${next.id}`)?.focus();
  };

  return (
    <MotionConfig reducedMotion={animations ? "user" : "always"}>
      <div className="mny-theme mny-stage" onPointerMove={followPointer}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 px-1">
          <div className="min-w-0">
            <h2 className="mx-title">Settings</h2>
            <p className="mny-muted mt-0.5 text-sm">How Life Record looks and works for you. Changes apply at once.</p>
          </div>
          <AccountTabs />
        </div>

        <div className="mt-5 grid items-start gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <div role="tablist" aria-label="Settings" aria-orientation="vertical" onKeyDown={onKey}
            className="scrollbar-hide -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:sticky lg:top-24 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
            {TABS.map((t) => {
              const on = active === t.id;
              return (
                <button key={t.id} id={`settings-tab-${t.id}`} type="button" role="tab" aria-selected={on} aria-controls="settings-panel" tabIndex={on ? 0 : -1}
                  onClick={() => pick(t.id)} data-testid={`settings-tab-${t.id}`}
                  className={cn("relative flex shrink-0 items-center gap-2.5 rounded-full px-4 py-2 text-sm font-medium transition-colors lg:rounded-xl",
                    on ? "text-[var(--mny-on-grad)]" : "mny-muted hover:bg-[var(--mny-surface-2)] hover:text-[var(--mny-text)]")}>
                  {on && <motion.span layoutId="settings-tab-pill" className="absolute inset-0 rounded-full lg:rounded-xl" style={{ background: "var(--mny-grad)" }} transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                  <t.icon className="relative h-4 w-4" aria-hidden="true" /><span className="relative whitespace-nowrap">{t.label}</span>
                </button>
              );
            })}
          </div>

          <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${active}`} className="min-w-0">
            {/* The new page fades in from the side. (No exit animation: waiting for one left the panel empty.) */}
            <motion.div key={active} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}>
              {panel}
            </motion.div>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
