import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { prefetchRoute, warmAllRoutes } from "@/lib/routes";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Wallet, Users, ShoppingCart, Utensils, Dumbbell,
  HeartPulse, CheckSquare, Calendar, Settings as SettingsIcon,
  Plus, Search, Sparkles, LogOut, Sun, Moon, Ellipsis,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { useSettings } from "@/context/SettingsContext";
import { AIAssistant } from "@/components/AIAssistant";
import { CommandBar } from "@/components/CommandBar";
import { QuickAdd } from "@/components/QuickAdd";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Home", icon: LayoutDashboard },
  { to: "/money", label: "Money", icon: Wallet },
  { to: "/people", label: "People", icon: Users },
  { to: "/groceries", label: "Groceries", icon: ShoppingCart },
  { to: "/nutrition", label: "Nutrition", icon: Utensils },
  { to: "/fitness", label: "Fitness", icon: Dumbbell },
  { to: "/body", label: "Body", icon: HeartPulse },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/calendar", label: "Calendar", icon: Calendar },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

// The phone's bottom bar has room for four pages and the quick-add button; every other page is behind "More".
const BAR_PATHS = ["/", "/money", "/people", "/tasks"];
const MOBILE_NAV = [NAV[0], NAV[1], null, NAV[2], NAV[7]];
const MORE_NAV = NAV.filter((n) => !BAR_PATHS.includes(n.to));   // derived, so a page added to NAV can never be unreachable on a phone

export function openAI(prompt) {
  window.dispatchEvent(new CustomEvent("lm:openAI", { detail: { prompt } }));
}

function Intro({ name, onDone }) {
  useEffect(() => {
    const seen = sessionStorage.getItem("lm_intro");
    if (seen) { onDone(); return; }
    sessionStorage.setItem("lm_intro", "1");
    const t = setTimeout(onDone, 2100);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <motion.div exit={{ opacity: 0 }} transition={{ duration: 0.5 }}
      className="fixed inset-0 z-[100] grid place-items-center bg-slate-950 text-white">
      <div className="text-center px-6">
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="text-3xl sm:text-4xl font-extrabold tracking-tight">Welcome back{name ? `, ${name}` : ""}</motion.p>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9, duration: 0.6 }}
          className="mt-3 text-slate-400">Here's what's happening today.</motion.p>
      </div>
    </motion.div>
  );
}

export function AppShell({ children }) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useSettings();
  const nav = useNavigate();
  const loc = useLocation();
  const [intro, setIntro] = useState(true);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef(null);
  const inMore = MORE_NAV.some((n) => loc.pathname === n.to || loc.pathname.startsWith(n.to + "/"));

  // Once things are quiet after sign-in, download every page and warm its data, one page at a time.
  useEffect(() => {
    if (!user?.id) return undefined;
    const t = setTimeout(() => { stopWarm = warmAllRoutes(user.id); }, 1200);
    let stopWarm = () => {};
    return () => { clearTimeout(t); stopWarm(); };
  }, [user?.id]);
  // Moving towards a link is a strong hint: refresh that page's code and data before the click lands.
  const warm = (to) => { if (user?.id) prefetchRoute(to, user.id, { maxAgeMs: 15_000 }); };
  // New page: start at the top, like a real navigation.
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);

  useEffect(() => {
    const off = () => setOffline(true);
    const on = () => setOffline(false);
    window.addEventListener("lm:offline", off);
    window.addEventListener("lm:online", on);
    return () => { window.removeEventListener("lm:offline", off); window.removeEventListener("lm:online", on); };
  }, []);

  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <div className="App min-h-screen bg-background">
      <AnimatePresence>{intro && <Intro key="intro" name={user?.name} onDone={() => setIntro(false)} />}</AnimatePresence>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col fixed inset-y-0 left-0 w-60 border-r border-border bg-card/60 backdrop-blur-sm z-30">
        <div className="h-16 flex items-center gap-2 px-5 border-b border-border">
          <div className="h-8 w-8 rounded-xl bg-emerald-700 grid place-items-center text-white"><Sparkles className="h-4 w-4" /></div>
          <span className="font-bold tracking-tight text-slate-900 dark:text-slate-50">Life Record</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} data-testid={`nav-${n.label.toLowerCase()}`}
              onMouseEnter={() => warm(n.to)} onFocus={() => warm(n.to)} onTouchStart={() => warm(n.to)}
              className={({ isActive }) => cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                         : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60"
              )}>
              <n.icon className="h-[18px] w-[18px]" />{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <button data-testid="logout-btn" onClick={logout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60">
            <LogOut className="h-[18px] w-[18px]" />Sign out
          </button>
        </div>
      </aside>

      {/* Top bar */}
      <header className="glass sticky top-0 z-20 h-16 border-b border-border lg:pl-60 flex items-center px-4 sm:px-6 gap-3">
        <div className="lg:hidden flex items-center gap-2">
          <div className="h-8 w-8 rounded-xl bg-emerald-700 grid place-items-center text-white"><Sparkles className="h-4 w-4" /></div>
          <span className="font-bold tracking-tight">Life Record</span>
        </div>
        <button data-testid="command-bar-trigger" onClick={() => setCmdOpen(true)}
          className="ml-auto lg:ml-0 flex items-center gap-2 rounded-xl border border-border bg-card px-3 h-9 text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 min-w-[180px] max-w-[280px]">
          <Search className="h-4 w-4" aria-hidden="true" /><span className="sr-only sm:not-sr-only">Search or command…</span>
          <kbd className="ml-auto hidden sm:inline text-[10px] font-mono border border-border rounded px-1.5 py-0.5" aria-hidden="true">⌘K</kbd>
        </button>
        <div className="lg:ml-auto flex items-center gap-2">
          <button data-testid="theme-toggle" aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="h-9 w-9 grid place-items-center rounded-xl border border-border bg-card hover:bg-slate-100 dark:hover:bg-slate-800">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button data-testid="quick-add-trigger" onClick={() => setQuickOpen(true)}
            className="hidden sm:flex items-center gap-1.5 h-9 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white px-3.5 text-sm font-semibold">
            <Plus className="h-4 w-4" />Add
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="lg:pl-60">
        {offline && (
          <div data-testid="offline-banner" className="bg-amber-500 text-white text-sm font-medium text-center py-2 px-4">
            ⚠️ Offline / fallback mode — backend unavailable. Showing last known data; changes won't save until reconnected.
          </div>
        )}
        <div key={loc.pathname} className="lm-page max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-28 lg:pb-10">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden glass-strong fixed bottom-0 inset-x-0 z-30 border-t border-border h-16 flex items-center justify-around px-2">
        {MOBILE_NAV.map((n, i) =>
          n === null ? (
            <button key="qa" data-testid="mobile-quick-add" aria-label="Quick add" onClick={() => setQuickOpen(true)}
              className="h-12 w-12 -mt-6 rounded-full bg-emerald-700 text-white grid place-items-center shadow-lg shadow-emerald-600/30">
              <Plus className="h-6 w-6" aria-hidden="true" />
            </button>
          ) : (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} data-testid={`mnav-${n.label.toLowerCase()}`}
              onTouchStart={() => warm(n.to)} onFocus={() => warm(n.to)}
              className={({ isActive }) => cn("flex flex-col items-center gap-0.5 text-[10px] font-medium px-3 py-1.5 rounded-lg",
                isActive ? "text-emerald-700 dark:text-emerald-400" : "text-slate-600 dark:text-slate-400")}>
              <n.icon className="h-5 w-5" />{n.label}
            </NavLink>
          )
        )}
        <button ref={moreButton} type="button" data-testid="mnav-more" aria-haspopup="dialog" aria-expanded={moreOpen} aria-current={inMore ? "page" : undefined}
          onClick={() => setMoreOpen(true)}
          className={cn("flex flex-col items-center gap-0.5 text-[10px] font-medium px-3 py-1.5 rounded-lg",
            inMore ? "text-emerald-700 dark:text-emerald-400" : "text-slate-600 dark:text-slate-400")}>
          <Ellipsis className="h-5 w-5" aria-hidden="true" />More
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        {/* Opened from state rather than a Trigger, so Radix cannot return the focus by itself: put it back by hand. */}
        <SheetContent side="bottom" className="lg:hidden rounded-t-2xl pb-8" data-testid="more-sheet"
          onCloseAutoFocus={(e) => { e.preventDefault(); moreButton.current?.focus(); }}>
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
            <SheetDescription className="sr-only">The other pages, and sign out</SheetDescription>
          </SheetHeader>
          <nav aria-label="More pages" className="mt-4 grid grid-cols-3 gap-2">
            {MORE_NAV.map((n) => (
              <NavLink key={n.to} to={n.to} data-testid={`more-${n.label.toLowerCase()}`} onClick={() => setMoreOpen(false)}
                className={({ isActive }) => cn("flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-medium",
                  isActive ? "border-emerald-400 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                           : "border-border text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50")}>
                <n.icon className="h-5 w-5" aria-hidden="true" />{n.label}
              </NavLink>
            ))}
          </nav>
          <button type="button" data-testid="more-signout" onClick={logout}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-border py-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">
            <LogOut className="h-4 w-4" aria-hidden="true" />Sign out
          </button>
        </SheetContent>
      </Sheet>

      <AIAssistant />
      <CommandBar open={cmdOpen} setOpen={setCmdOpen} onQuickAdd={() => setQuickOpen(true)} />
      <QuickAdd open={quickOpen} setOpen={setQuickOpen} />
    </div>
  );
}
