import { useEffect, useId, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";
import { useSettings } from "@/context/SettingsContext";
import { cn } from "@/lib/utils";
import "@/styles/money.css";

/** One choice out of a few. The chosen option is a solid pill that slides to the next one (a shared layout animation). */
export function Segmented({ value, onChange, options, label, testid, className }) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} data-testid={testid} className={cn("inline-flex max-w-full flex-wrap gap-1 rounded-full border border-[var(--mny-line)] bg-[var(--mny-surface-2)] p-1", className)}>
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} data-testid={testid ? `${testid}-${o.value}` : undefined} onClick={() => !on && onChange(o.value)}
            className={cn("relative inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--mny-green)]",
              on ? "text-[var(--mny-on-grad)]" : "text-[var(--mny-muted)] hover:text-[var(--mny-text)]")}>
            {on && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full" style={{ background: "var(--mny-grad)" }} transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="relative inline-flex items-center gap-1.5">{Icon && <Icon className="h-4 w-4" aria-hidden="true" />}{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A card for one group of settings: an icon and a title, what it is for, and its rows. */
export function SectionHead({ id, icon: Icon, title, description, aside }) {
  return (
    <header className="flex items-start gap-3">
      <span className="mny-badge">{Icon && <Icon className="h-5 w-5" aria-hidden="true" />}</span>
      <div className="min-w-0 flex-1">
        <h3 id={`${id}-h`} className="mny-title text-lg font-semibold leading-7 tracking-tight">{title}</h3>
        {description && <p className="mny-muted mt-0.5 text-sm">{description}</p>}
      </div>
      {aside}
    </header>
  );
}

export function Section({ id, icon, title, description, children, index = 0, aside, testid, className }) {
  return (
    <motion.section id={id} aria-labelledby={`${id}-h`} data-testid={testid} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.2, 0, 0, 1], delay: Math.min(index, 6) * 0.05 }} className={`mny-card flex scroll-mt-24 flex-col p-5 sm:p-6 ${className || ""}`}>
      <SectionHead id={id} icon={icon} title={title} description={description} aside={aside} />
      <div className="mt-4 flex-1">{children}</div>
    </motion.section>
  );
}

/** A label and what it does on the left, its control on the right (under it on a narrow screen). */
export function Row({ title, description, children, htmlFor, danger }) {
  return (
    <div className="mny-hair flex flex-col gap-3 border-t py-4 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className={cn("text-sm font-medium", danger ? "mny-neg" : "mny-title")}>{title}</label>
        {description && <p className="mny-muted mt-0.5 max-w-prose text-sm">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** "Saved" for two seconds after a choice reached the account, so a change never leaves the person wondering. */
export function SavedBadge() {
  const { savedAt, saving, sync, saveError, retrySave } = useSettings();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!savedAt) return undefined;
    setShow(true);
    const t = setTimeout(() => setShow(false), 2200);
    return () => clearTimeout(t);
  }, [savedAt]);
  return (
    <div role="status" aria-live="polite" className="min-h-7 min-w-[5.5rem] text-right">
      <AnimatePresence mode="wait" initial={false}>
        {saveError && !saving ? (
          <motion.span key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mny-state neg" data-testid="settings-save-error" role="alert">
            Not saved to your account
            <button type="button" onClick={retrySave} className="ml-1 underline underline-offset-2" data-testid="settings-save-retry">Try again</button>
          </motion.span>
        ) : saving ? (
          <motion.span key="saving" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mny-muted text-xs">Saving…</motion.span>
        ) : show ? (
          <motion.span key="saved" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="mny-state" data-testid="settings-saved">
            <Check className="h-3 w-3" aria-hidden="true" />{sync ? "Saved to your account" : "Saved"}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
