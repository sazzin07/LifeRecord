import * as React from "react";
import { CalendarDays, X } from "lucide-react";
import { addDays, format, isValid, parseISO } from "date-fns";

import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const toIso = (d) => format(d, "yyyy-MM-dd");

/**
 * Themed replacement for <input type="date">. Value is an ISO "YYYY-MM-DD" string ("" when empty).
 * `presets` are quick picks as day offsets from today, e.g. [{ label: "Tomorrow", days: 1 }].
 */
export function DatePicker({ value, onChange, placeholder = "Pick a date", presets, clearable = true, className, disabled, "aria-label": ariaLabel, id, ...rest }) {
  const [open, setOpen] = React.useState(false);
  const closing = React.useRef(0);
  React.useEffect(() => () => clearTimeout(closing.current), []);
  const selected = value ? parseISO(value) : undefined;
  const valid = selected && isValid(selected);
  // The change is reported at once; the popover stays for a breath so the chosen day is seen settling before it closes.
  const pick = (d) => { onChange(d ? toIso(d) : ""); clearTimeout(closing.current); closing.current = setTimeout(() => setOpen(false), d ? 170 : 0); };
  // The accessible name must contain the visible text (WCAG 2.5.3), so the label says what the field is and the button shows its value.
  const shown = valid ? format(selected, "EEE d MMM yyyy") : placeholder;
  const name = !ariaLabel ? shown : ariaLabel.toLowerCase().includes(shown.toLowerCase()) ? ariaLabel : `${ariaLabel}: ${shown}`;
  const link = "rounded-full px-3 py-1 text-xs font-medium text-muted-foreground outline-none transition-colors duration-200 hover:bg-field hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={name}
          className={cn(
            "flex h-10 w-full items-center gap-2 rounded-xl border border-input bg-background px-3 text-left text-sm transition-colors",
            "hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:border-primary",
            !valid && "text-muted-foreground",
            className,
          )}
          {...rest}
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="flex-1 truncate">{shown}</span>
          {valid && clearable && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear date"
              className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onChange(""); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onChange(""); } }}
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto rounded-3xl p-0" align="start" sideOffset={8} data-testid="date-popover">
        {presets?.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 pt-3">
            {presets.map((p) => <button key={p.label} type="button" className={cn(link, "border border-line")} onClick={() => pick(addDays(new Date(), p.days))}>{p.label}</button>)}
          </div>
        )}
        <Calendar selected={valid ? selected : undefined} defaultMonth={valid ? selected : undefined} onSelect={(d) => pick(d)} autoFocus />
        <div className="flex items-center justify-between border-t border-line px-3 py-2">
          <button type="button" className={link} onClick={() => pick(new Date())} data-testid="calendar-today">Today</button>
          {clearable && valid && <button type="button" className={link} onClick={() => pick(null)}>Clear</button>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
