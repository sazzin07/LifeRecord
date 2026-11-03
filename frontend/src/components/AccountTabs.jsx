import { NavLink } from "react-router-dom";
import { cn } from "@/lib/utils";

/** The two halves of "your account": who you are and how you are protected (Profile), and how the app looks and works (Settings). */
export function AccountTabs() {
  const items = [{ to: "/profile", label: "Profile", testid: "tab-profile" }, { to: "/settings", label: "Settings", testid: "tab-settings" }];
  return (
    <nav aria-label="Account" className="inline-flex gap-1 rounded-full border border-border bg-card p-1">
      {items.map((i) => (
        <NavLink key={i.to} to={i.to} data-testid={i.testid}
          className={({ isActive }) => cn("rounded-full px-5 py-1.5 text-sm font-medium transition-colors",
            isActive ? "bg-emerald-700 text-white" : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800")}>
          {i.label}
        </NavLink>
      ))}
    </nav>
  );
}
