import { useRef } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { Card } from "@/components/common";
import { cn } from "@/lib/utils";

/* One skeleton system for the whole app.
   - `Sk`        a placeholder block. Give it the size of what it stands for (a text line is h-4, a figure is the figure's own height).
   - `Busy`      the group around placeholders: ONE polite announcement ("Loading balances"), and aria-busy for tools; the blocks are hidden from them.
   - `Resolve`   one section's life: skeleton while it has nothing, an error with Retry if the request failed, the content (faded in only if a
                 skeleton was shown, so cached or instant content never flickers) when it has data.
   A section decides for ITSELF from its own data; nothing here waits for another section. */

export function Sk({ className, style }) {
  return <span aria-hidden="true" className={cn("skeleton block", className)} style={style} />;
}

/** `n` lines of text; the last is shorter, the way a paragraph ends. `widths` overrides them (Tailwind width classes). */
export function SkLines({ n = 3, className, line = "h-3.5", widths }) {
  const w = widths || Array.from({ length: n }, (_, i) => (i === n - 1 ? "w-3/5" : i % 2 ? "w-11/12" : "w-full"));
  return <div className={cn("space-y-2", className)}>{w.map((x, i) => <Sk key={i} className={cn(line, x)} />)}</div>;
}

/** Rows with a round or square lead, a title and a figure: lists of people, transactions, accounts, devices. */
export function SkRows({ n = 4, lead = "round", className, rowClass = "py-2.5", figure = true }) {
  return (
    <div className={cn("divide-y divide-border/60", className)}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={cn("flex items-center gap-3", rowClass)}>
          {lead && <Sk className={cn("h-10 w-10 shrink-0", lead === "round" ? "rounded-full" : "rounded-xl")} />}
          <div className="min-w-0 flex-1 space-y-1.5"><Sk className={cn("h-3.5", i % 2 ? "w-2/5" : "w-1/2")} /><Sk className="h-3 w-1/3" /></div>
          {figure && <Sk className="h-4 w-16 shrink-0" />}
        </div>
      ))}
    </div>
  );
}

/** A card of the same padding the real ones use, with a title line. */
export function SkCard({ children, className, title = true }) {
  return (
    <Card className={cn("p-5", className)}>
      {title && <Sk className="mb-4 h-4 w-32" />}
      {children}
    </Card>
  );
}

/** A chart's place: axis ticks on the left, faint grid, and a soft area shape so the eye reads "chart", not "box". */
export function SkChart({ className, height = 220 }) {
  return (
    <div className={cn("relative", className)} style={{ height }} aria-hidden="true">
      <div className="absolute inset-y-2 left-0 flex w-8 flex-col justify-between">{[0, 1, 2, 3].map((i) => <Sk key={i} className="h-2.5 w-6" />)}</div>
      <div className="absolute inset-y-2 left-10 right-0 flex flex-col justify-between">{[0, 1, 2, 3].map((i) => <span key={i} className="h-px w-full bg-border/60" />)}</div>
      <Sk className="absolute bottom-2 left-10 right-0 rounded-t-3xl" style={{ height: "55%" }} />
    </div>
  );
}

/** A form: a label and a field per row (the profile forms, the goals). `cols` puts two fields side by side from `sm`. */
export function SkForm({ n = 4, cols = 2, className }) {
  return (
    <div className={cn("grid gap-4", cols === 2 && "sm:grid-cols-2", className)} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <div key={i} className="space-y-1.5"><Sk className="h-3 w-24" /><Sk className="h-10 w-full !rounded-md" /></div>)}
    </div>
  );
}

export function Busy({ label = "Loading", children, className }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** What replaces a section whose request failed: the words, and a way to try again. Same height as a short card so the page does not jump. */
export function ErrorBlock({ what = "this", onRetry, className }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-5 py-8 text-center", className)} data-testid="section-error">
      <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">Could not load {what}.</p>
      <p className="max-w-xs text-xs text-slate-600 dark:text-slate-400">Nothing is lost. Check your connection and try again.</p>
      {onRetry && (
        <button type="button" onClick={onRetry} data-testid="section-retry"
          className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800">
          <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />Try again
        </button>
      )}
    </div>
  );
}

/** `loading`/`error` come from useFetch (or any state with the same meaning). `skeleton` is what the finished section will look like, empty.
 *  `as` is the element around the content ("div" by default; pass `contents`-style layouts by giving className). */
export function Resolve({ loading, error, onRetry, skeleton, label = "Loading", what, children, className, errorClassName }) {
  const waited = useRef(false);
  if (loading) waited.current = true;
  if (loading) return <Busy label={label} className={className}>{skeleton}</Busy>;
  if (error) return <div className={className}><ErrorBlock what={what || label.replace(/^Loading /i, "")} onRetry={onRetry} className={errorClassName} /></div>;
  return <div className={cn(className, waited.current && "sk-reveal")}>{children}</div>;
}
