import { motion } from "framer-motion";
import { Check, Monitor, Moon, Palette, Sun, Zap } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { Switch } from "@/components/ui/switch";
import { Row, SavedBadge, Section } from "@/components/settings/controls";
import { cn } from "@/lib/utils";

const PALETTE = {
  light: { bg: "#eef3f0", card: "#ffffff", line: "#d3ded8", ink: "#0a2a1c", soft: "#9db5a9", accent: "#0b7a50" },
  dark: { bg: "#080d0b", card: "#111a16", line: "#25322c", ink: "#e8f1ed", soft: "#51655b", accent: "#34d399" },
};

/** A tiny picture of the app in one theme: the side strip, a card with a figure, a button. */
function Mini({ tone }) {
  const p = PALETTE[tone];
  return (
    <div className="absolute inset-0 flex gap-1.5 p-2" style={{ background: p.bg }} aria-hidden="true">
      <div className="w-3 shrink-0 rounded-md" style={{ background: p.card, border: `1px solid ${p.line}` }} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex gap-1.5">
          <div className="h-2 w-8 rounded-full" style={{ background: p.soft }} />
          <div className="ml-auto h-2 w-5 rounded-full" style={{ background: p.accent }} />
        </div>
        <div className="flex-1 rounded-lg p-1.5" style={{ background: p.card, border: `1px solid ${p.line}` }}>
          <div className="h-1.5 w-6 rounded-full" style={{ background: p.soft }} />
          <div className="mt-1 h-3 w-12 rounded" style={{ background: p.ink }} />
          <div className="mt-1.5 h-1.5 w-9 rounded-full" style={{ background: p.accent }} />
        </div>
      </div>
    </div>
  );
}

const THEMES = [
  { k: "light", icon: Sun, label: "Light", hint: "Bright surfaces" },
  { k: "dark", icon: Moon, label: "Dark", hint: "Easy on the eyes at night" },
  { k: "system", icon: Monitor, label: "System", hint: "Follows this device" },
];

export function Appearance({ index }) {
  const { theme, setTheme, animations, setAnimations } = useSettings();
  return (
    <Section id="appearance" index={index} icon={Palette} title="Appearance" description="How Life Record looks. It applies at once." aside={<SavedBadge />}>
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {THEMES.map((t) => {
          const on = theme === t.k;
          return (
            <button key={t.k} type="button" role="radio" aria-checked={on} data-testid={`theme-${t.k}`} onClick={() => setTheme(t.k)}
              className="group relative rounded-2xl p-1.5 text-left transition-transform duration-200 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mny-green)]">
              {on && <motion.span layoutId="theme-ring" className="absolute inset-0 rounded-2xl border-2 border-[var(--mny-green)]" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
              <span className={cn("relative block h-24 overflow-hidden rounded-xl border border-[var(--mny-line)]", on && "shadow-lg")}>
                {t.k === "system" ? (
                  <>
                    <Mini tone="light" />
                    <span className="absolute inset-0" style={{ clipPath: "polygon(55% 0, 100% 0, 100% 100%, 35% 100%)" }}><Mini tone="dark" /></span>
                  </>
                ) : <Mini tone={t.k} />}
              </span>
              <span className="mt-2 flex items-center gap-2 px-1 pb-1">
                <t.icon className={cn("h-4 w-4", on ? "mny-green" : "mny-muted")} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="mny-title block text-sm font-medium">{t.label}</span>
                  <span className="mny-muted block truncate text-xs">{t.hint}</span>
                </span>
                {on && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="grid h-5 w-5 place-items-center rounded-full" style={{ background: "var(--mny-grad)", color: "var(--mny-on-grad)" }}><Check className="h-3 w-3" aria-hidden="true" /></motion.span>}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-5">
        <Row title="Animations" description="Fades, slides and the small movements on every page. Turn them off for a calmer, faster feel." htmlFor="anim-toggle">
          <div className="flex items-center gap-2">
            <Zap className="mny-muted h-4 w-4" aria-hidden="true" />
            <Switch id="anim-toggle" checked={animations} onCheckedChange={setAnimations} aria-label="Animations" data-testid="anim-toggle" />
          </div>
        </Row>
      </div>
    </Section>
  );
}
