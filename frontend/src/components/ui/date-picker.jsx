import * as React from "react";
import { CalendarDays, X } from "lucide-react";
import { addDays, format, isValid, parseISO } from "date-fns";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const toIso = (d) => format(d, "yyyy-MM-dd");

/**
 * Themed replacement for <input type="date">. Value is an ISO "YYYY-MM-DD" string ("" when empty).
 * `presets` are quick picks as day offsets from today, e.g. [{ label: "Tomorrow", days: 1 }].
 */
export function DatePicker({ value, onChange, placeholder = "Pick a date", presets, clearable = true, className, disabled, "aria-label": ariaLabel, id, ...rest }) {
  const [open, setOpen] = React.useState(false);
  const selected = value ? parseISO(value) : undefined;
  const valid = selected && isValid(selected);
  const pick = (d) => { onChange(d ? toIso(d) : ""); setOpen(false); };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel || placeholder}
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
          <span className="flex-1 truncate">{valid ? format(selected, "EEE d MMM yyyy") : placeholder}</span>
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
      <PopoverContent className="w-auto rounded-2xl p-0" align="start">
        {presets?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-border p-3 pb-2.5">
            {presets.map((p) => (
              <Button key={p.label} type="button" size="sm" variant="outline" className="h-7 rounded-full px-3 text-xs"
                onClick={() => pick(addDays(new Date(), p.days))}>{p.label}</Button>
            ))}
          </div>
        )}
        <Calendar mode="single" selected={valid ? selected : undefined} defaultMonth={valid ? selected : undefined}
          onSelect={(d) => d && pick(d)} initialFocus />
      </PopoverContent>
    </Popover>
  );
}
