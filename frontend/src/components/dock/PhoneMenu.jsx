import { NavLink } from "react-router-dom";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DOCK } from "./dockData";
import { DockTile } from "./DockTile";
import { cn } from "@/lib/utils";

/** The phone's menu of pages: a panel that slides in from the left (the button is in the top bar) and folds away when a page is chosen or the panel is dismissed. The same groups as the dock, so the app is organised the same way on every screen. */
export function PhoneMenu({ open, onOpenChange, opener }) {
  const link = (p) => (
    <NavLink key={p.to} to={p.to} end={p.to === "/"} data-testid={`nav-${p.label.toLowerCase()}`} onClick={() => onOpenChange(false)}
      className={({ isActive }) => cn("flex items-center gap-3 rounded-full px-2 py-1.5 pr-4 text-sm font-medium transition-colors duration-200 active:scale-[0.98]",
        isActive ? "pill-fill" : "text-foreground hover:bg-hover")}>
      {() => (<><DockTile tile={p.tile} className="h-9 w-9" />{p.label}</>)}
    </NavLink>
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[18.5rem] overflow-y-auto p-5 sm:hidden" data-testid="side-menu"
        onCloseAutoFocus={(e) => { e.preventDefault(); opener?.current?.focus(); }}>
        <SheetHeader>
          <SheetTitle>Life Record</SheetTitle>
          <SheetDescription className="sr-only">Every page, grouped</SheetDescription>
        </SheetHeader>
        <nav aria-label="Pages" className="mt-4 space-y-4">
          {DOCK.map((entry) => entry.items ? (
            <div key={entry.id}>
              <p className="mb-1.5 px-2 text-xs font-semibold text-muted-foreground">{entry.label}</p>
              <div className="space-y-1" role="group" aria-label={entry.label}>{entry.items.map(link)}</div>
            </div>
          ) : (
            <div key={entry.id} className="space-y-1">{link({ to: entry.to, label: entry.label, tile: entry.tile })}</div>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
