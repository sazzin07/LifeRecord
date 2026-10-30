import { useEffect } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { STATUS_LABEL, fmt, prettyDate, useNutrientMeta } from "./shared";

const SRC = { efsa2017: "EFSA 2017", who2026: "WHO", eu1169: "EU labelling" };
const refText = (p) => (p.min != null && p.max != null ? `${fmt(p.min)}–${fmt(p.max)}` : p.target != null ? `${fmt(p.target)}` : p.max != null ? `limit ${fmt(p.max)}` : "–");

/**
 * A plain, printable summary of the period shown on the Trends tab. It is a page to print or save as PDF from the browser; nothing
 * is uploaded and no link is created, because this is health information that should stay with the person.
 */
export function WeeklySummary({ open, onOpenChange, t, today, energyTarget }) {
  const { byKey } = useNutrientMeta();
  useEffect(() => {
    const done = () => document.body.classList.remove("printing-summary");
    window.addEventListener("afterprint", done);
    return () => { window.removeEventListener("afterprint", done); done(); };
  }, []);
  const print = () => { document.body.classList.add("printing-summary"); window.print(); };
  if (!t) return null;
  const rows = Object.values(t.progress).filter((p) => p.status !== "no_data");
  const avg = t.daily_average;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto" data-testid="weekly-summary" data-print-area>
        <DialogHeader>
          <DialogTitle>Nutrition summary</DialogTitle>
          <DialogDescription>{prettyDate(t.start, today)} to {prettyDate(t.end, today)} · {t.days_logged} of {t.days} days logged</DialogDescription>
        </DialogHeader>
        {t.days_logged === 0 ? <p className="text-sm text-slate-500">Nothing was logged in this period.</p> : (
          <div className="space-y-4 text-sm">
            <p>
              On the days you logged, you averaged <strong className="stat-num">{fmt(avg.energy_kcal)} kcal</strong>
              {energyTarget ? <> against a reference of about <strong className="stat-num">{fmt(energyTarget)} kcal</strong></> : null}
              {avg.protein_g != null ? <>, <strong className="stat-num">{fmt(avg.protein_g)} g</strong> protein</> : null}
              {avg.fiber_g != null ? <> and <strong className="stat-num">{fmt(avg.fiber_g)} g</strong> fibre</> : null}.
            </p>
            <table className="w-full border-collapse text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-border text-slate-500"><th className="py-1.5 pr-2 font-medium">Nutrient</th><th className="px-2 font-medium">Average per logged day</th><th className="px-2 font-medium">Reference</th><th className="px-2 font-medium">Compared</th><th className="pl-2 text-right font-medium">Days with data</th></tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.key} className="border-b border-border/60">
                    <td className="py-1.5 pr-2">{byKey[p.key]?.name || p.key}</td>
                    <td className="stat-num px-2">{fmt(p.intake)} {p.unit}</td>
                    <td className="stat-num px-2">{refText(p)} {p.unit} <span className="text-slate-400">{SRC[p.source] || ""}</span></td>
                    <td className="px-2">{p.percent != null ? `${Math.round(p.percent)}% · ` : ""}{STATUS_LABEL[p.status]}</td>
                    <td className="stat-num pl-2 text-right">{t.days_reporting[p.key]}/{t.days_logged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-slate-500">
              Each nutrient is averaged over the logged days that reported it; a day without data is not counted as zero, and typed-in or estimated entries may lack
              vitamins and minerals, so a low average can reflect missing data. Reference values describe healthy adults (EFSA 2017 and WHO) and are not medical advice;
              a low recorded intake is not a diagnosis. Created {new Date().toLocaleDateString()} from LifeRecord.
            </p>
          </div>
        )}
        <div className="flex justify-end print:hidden"><Button onClick={print} disabled={t.days_logged === 0} data-testid="summary-print"><Printer className="mr-1.5 h-4 w-4" />Print or save as PDF</Button></div>
      </DialogContent>
    </Dialog>
  );
}
