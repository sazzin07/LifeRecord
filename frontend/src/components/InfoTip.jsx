import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Secondary words kept out of the way: a small (i) that opens a short note on hover, on keyboard focus and on a tap.
 * Use it for the caveat, the source or the "how to read this" that most people do not need on every visit.
 */
export function InfoTip({ label = "More about this", children, className, align = "start" }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  const kind = useRef("mouse");
  const show = () => { clearTimeout(timer.current); setOpen(true); };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 140); };
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label}
          onPointerDown={(e) => { kind.current = e.pointerType || "mouse"; }}
          onPointerEnter={(e) => { if (e.pointerType === "mouse") show(); }}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") hide(); }}
          onClick={(e) => { e.preventDefault(); if (kind.current === "mouse") show(); else setOpen((o) => !o); }}
          className={cn("inline-grid h-6 w-6 shrink-0 place-items-center rounded-full align-middle text-muted-foreground outline-none transition-colors duration-200 hover:bg-field hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:text-foreground", className)}>
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} sideOffset={6} onOpenAutoFocus={(e) => e.preventDefault()} onPointerEnter={show} onPointerLeave={hide}
        className="w-64 max-w-[calc(100vw-2rem)] p-3 text-xs leading-relaxed text-muted-foreground">
        {children}
      </PopoverContent>
    </Popover>
  );
}
