import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Themed replacement for the browser's native `title` tooltip. Wraps a single focusable child. */
export function Hint({ label, children, side = "top" }) {
  if (!label) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
