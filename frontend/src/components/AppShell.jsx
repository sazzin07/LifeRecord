import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { prefetchRoute, warmAllRoutes } from "@/lib/routes";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard, Wallet, Users, ShoppingCart, Utensils, Dumbbell,
  HeartPulse, CheckSquare, Calendar, Settings as SettingsIcon,
  Sparkles, LogOut, Sun, Moon, Ellipsis, Pin, PinOff,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import { UserAvatar } from "@/components/UserAvatar";
import { useSettings } from "@/context/SettingsContext";
import { AIAssistant } from "@/components/AIAssistant";
import { CommandBar } from "@/components/CommandBar";
import { QuickAdd } from "@/components/QuickAdd";
import { QuickAddFab } from "@/components/QuickAddFab";
import { RecurringNotice } from "@/components/RecurringNotice";
import { api } from "@/lib/api";
import { mainCurrencyOf, setMainCurrency } from "@/lib/money";
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

// The phone's bottom bar has room for four pages and "More"; every other page is behind "More". Quick add floats above the bar.
const BAR_PATHS = ["/", "/money", "/people", "/tasks"];
const MOBILE_NAV = [NAV[0], NAV[1], NAV[2], NAV[7]];
const MORE_NAV = NAV.filter((n) => !BAR_PATHS.includes(n.to));   // derived, so a page added to NAV can never be unreachable on a phone

export function openAI(prompt) {
  window.dispatchEvent(new CustomEvent("lm:openAI", { detail: { prompt, opener: document.activeElement } }));
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
  const { theme, setTheme, sideMenu, setSideMenu, bindServer, pull } = useSettings();
  const nav = useNavigate();
  const loc = useLocation();
  const [intro, setIntro] = useState(true);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const [currencyTick, setCurrencyTick] = useState(0);   // bumped when the main currency changes, so every amount is drawn again
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButton = useRef(null);
  // On a wide screen the side menu is a thin strip of icons that widens over the page while the pointer (or keyboard focus) is
  // on it. A screen that cannot hover keeps it open, and the pin keeps it open for anyone who prefers that.
  const pinned = sideMenu === "open";
  const [canHover, setCanHover] = useState(() => (typeof window.matchMedia !== "function" ? true : window.matchMedia("(hover: hover)").matches));
  const [peek, setPeek] = useState(false);
  const peekTimer = useRef(null);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(hover: hover)");
    const on = () => setCanHover(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => () => clearTimeout(peekTimer.current), []);
  const docked = pinned || !canHover;
  const expanded = docked || peek;
  const showPeek = () => { clearTimeout(peekTimer.current); setPeek(true); };
  const hidePeek = () => { clearTimeout(peekTimer.current); peekTimer.current = setTimeout(() => setPeek(false), 220); };
  // Choosing a page folds the menu back to its strip, even while the pointer is still on it; it opens again when the pointer re-enters.
  const retract = () => { clearTimeout(peekTimer.current); setPeek(false); };
  const togglePin = () => setSideMenu(pinned ? "auto" : "open");

  // The person's saved choices (theme, animations, week start...) are asked for at sign-in, when the tab comes back to the front, and after
  // anything that refreshes the data (the assistant changing a setting is one). `pull` is read through a ref so a choice made here is never
  // answered by an older copy from the server.
  const pullRef = useRef(pull);
  pullRef.current = pull;
  useEffect(() => {
    if (!user?.id) return undefined;
    bindServer(true);
    pullRef.current({ force: true });
    const again = () => pullRef.current();
    const visible = () => { if (document.visibilityState === "visible") again(); };
    window.addEventListener("lm:refresh", again);
    document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("lm:refresh", again); document.removeEventListener("visibilitychange", visible); bindServer(false); };
  }, [user?.id, bindServer]);
  const inMore = MORE_NAV.some((n) => loc.pathname === n.to || loc.pathname.startsWith(n.to + "/"));

  // The main currency is the bank account's. Asked for at sign-in and after anything that refreshes the data.
  useEffect(() => {
    if (!user?.id) return undefined;
    let off = false;
    const sync = () => api.get("/accounts").then(({ data }) => { if (!off && setMainCurrency(mainCurrencyOf(data))) setCurrencyTick((t) => t + 1); }).catch(() => {});
    sync();
    window.addEventListener("lm:refresh", sync);
    return () => { off = true; window.removeEventListener("lm:refresh", sync); };
  }, [user?.id]);

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
    <div className="App min-h-screen">
      <AnimatePresence>{intro && <Intro key="intro" name={user?.name} onDone={() => setIntro(false)} />}</AnimatePresence>

      {/* Desktop sidebar */}
      <aside data-testid="sidebar" data-expanded={expanded}
        onMouseEnter={showPeek} onMouseLeave={hidePeek} onFocus={(e) => { if (e.target.matches(":focus-visible")) showPeek(); }}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) hidePeek(); }}
        className={cn("hidden lg:flex flex-col fixed inset-y-0 left-0 overflow-hidden border-r border-line backdrop-blur-xl transition-[width,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          expanded ? "w-60" : "w-16", docked ? "bg-sidebar z-30" : "bg-card z-40", expanded && !docked && "shadow-[var(--pop-shadow)]")}>
        <div className="h-16 flex shrink-0 items-center gap-2 border-b border-border px-4">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,#e2b6ea,#a679b2)] text-[#2a1433] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><Sparkles className="h-4 w-4" /></div>
          <span className={cn("whitespace-nowrap font-bold tracking-tight text-foreground transition-opacity duration-200", expanded ? "opacity-100" : "opacity-0")}>Life Record</span>
          {canHover && expanded && (
            <button type="button" data-testid="sidebar-pin" onClick={togglePin} aria-pressed={pinned} aria-label={pinned ? "Let the menu hide again" : "Keep the menu open"}
              className="ml-auto grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-hover hover:text-foreground">
              {pinned ? <PinOff className="h-4 w-4" aria-hidden="true" /> : <Pin className="h-4 w-4" aria-hidden="true" />}
            </button>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === "/"} data-testid={`nav-${n.label.toLowerCase()}`}
              onMouseEnter={() => warm(n.to)} onFocus={() => warm(n.to)} onTouchStart={() => warm(n.to)} onClick={retract}
              className={({ isActive }) => cn(
                "relative isolate flex items-center gap-3 whitespace-nowrap rounded-full px-[11px] py-2.5 text-sm font-medium transition-colors duration-200",
                isActive ? "text-white" : "text-muted-foreground hover:bg-hover hover:text-foreground"
              )}>
              {({ isActive }) => (<>
                {isActive && <motion.span layoutId="nav-pill" aria-hidden="true" className="absolute inset-0 -z-10 rounded-full pill-fill shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]" transition={{ type: "spring", stiffness: 420, damping: 38 }} />}
                <n.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" /><span className={cn("transition-opacity duration-200", expanded ? "opacity-100" : "opacity-0")}>{n.label}</span>
              </>)}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <button data-testid="logout-btn" onClick={() => { retract(); logout(); }}
            className="flex w-full items-center gap-3 whitespace-nowrap rounded-full px-[11px] py-2.5 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:bg-hover hover:text-foreground">
            <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" /><span className={cn("transition-opacity duration-200", expanded ? "opacity-100" : "opacity-0")}>Sign out</span>
          </button>
        </div>
      </aside>

      {/* Top bar */}
      <header className={cn("glass sticky top-0 z-20 h-16 border-b border-line", docked ? "lg:pl-60" : "lg:pl-16")}>
        {/* The same width as the page below, so the bar lines up with the content. */}
        <div className="mx-auto flex h-full max-w-7xl items-center gap-3 px-4 sm:px-6">
          <div className="lg:hidden flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-[linear-gradient(135deg,#e2b6ea,#a679b2)] text-[#2a1433]"><Sparkles className="h-4 w-4" /></div>
            <span className="font-bold tracking-tight">Life Record</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" data-testid="ai-trigger" aria-label="Open the assistant" aria-haspopup="dialog" onClick={() => openAI()}
              className="group flex h-11 min-w-[2.75rem] items-center justify-center gap-2 rounded-full sm:h-10 sm:min-w-0 border border-line-strong bg-field px-3 text-sm font-semibold text-foreground transition-[background-color,border-color,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-line-strong hover:bg-hover active:scale-[0.96] motion-reduce:transition-colors motion-reduce:active:scale-100 sm:pl-3.5 sm:pr-4">
              <Sparkles className="h-4 w-4 text-accent-ink transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:rotate-[18deg] group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:transform-none" aria-hidden="true" />
              <span className="hidden sm:inline">Assistant</span>
            </button>
            <button data-testid="theme-toggle" aria-label={theme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="grid h-11 w-11 place-items-center rounded-full border border-line-strong bg-field text-foreground transition-[border-color,background-color,transform] duration-200 hover:bg-hover active:scale-95 sm:h-10 sm:w-10">
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <NavLink to="/profile" data-testid="header-profile" aria-label={`Your profile${user?.name ? `, ${user.name}` : ""}`}
              className="grid h-11 w-11 place-items-center overflow-hidden rounded-full border border-line-strong bg-field text-sm font-semibold text-accent-ink transition-[border-color,transform] duration-200 hover:border-line-strong active:scale-95 sm:h-10 sm:w-10">
              {/* Decorative: the button's label already names the person (the initials would not match it). A fixed size, so a large photo is scaled, not cropped by its own size. */}
              <span aria-hidden="true" className="block h-[38px] w-[38px] overflow-hidden rounded-full"><UserAvatar size="h-[38px] w-[38px]" className="text-xs" decorative /></span>
            </NavLink>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className={docked ? "lg:pl-60" : "lg:pl-16"}>
        {offline && (
          <div data-testid="offline-banner" className="bg-amber-700 text-white text-sm font-medium text-center py-2 px-4">
            ⚠️ Offline / fallback mode — backend unavailable. Showing last known data; changes won't save until reconnected.
          </div>
        )}
        <div key={`${loc.pathname}:${currencyTick}`} className="lm-page max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-40 lg:pb-24">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden glass-strong fixed bottom-0 inset-x-0 z-30 flex h-16 items-center justify-around border-t border-line px-2">
        {MOBILE_NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"} data-testid={`mnav-${n.label.toLowerCase()}`}
            onTouchStart={() => warm(n.to)} onFocus={() => warm(n.to)}
            className={({ isActive }) => cn("relative isolate flex flex-col items-center gap-0.5 rounded-full px-4 py-1.5 text-[10px] font-medium transition-colors duration-200 active:scale-95",
              isActive ? "text-white" : "text-muted-foreground")}>
            {({ isActive }) => (<>
              {isActive && <motion.span layoutId="mnav-pill" aria-hidden="true" className="absolute inset-0 -z-10 rounded-full pill-fill shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]" transition={{ type: "spring", stiffness: 420, damping: 38 }} />}
              <n.icon className="h-5 w-5" />{n.label}
            </>)}
          </NavLink>
        ))}
        <button ref={moreButton} type="button" data-testid="mnav-more" aria-haspopup="dialog" aria-expanded={moreOpen} aria-current={inMore ? "page" : undefined}
          onClick={() => setMoreOpen(true)}
          className={cn("flex flex-col items-center gap-0.5 rounded-full px-4 py-1.5 text-[10px] font-medium transition-[color,background-color,transform] duration-200 active:scale-95",
            inMore ? "bg-hover text-foreground" : "text-muted-foreground")}>
          <Ellipsis className="h-5 w-5" aria-hidden="true" />More
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        {/* Opened from state rather than a Trigger, so Radix cannot return the focus by itself: put it back by hand. */}
        <SheetContent side="bottom" className="lg:hidden rounded-t-3xl pb-8" data-testid="more-sheet"
          onCloseAutoFocus={(e) => { e.preventDefault(); moreButton.current?.focus(); }}>
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
            <SheetDescription className="sr-only">The other pages, and sign out</SheetDescription>
          </SheetHeader>
          <nav aria-label="More pages" className="mt-4 grid grid-cols-3 gap-2">
            {MORE_NAV.map((n) => (
              <NavLink key={n.to} to={n.to} data-testid={`more-${n.label.toLowerCase()}`} onClick={() => setMoreOpen(false)}
                className={({ isActive }) => cn("flex flex-col items-center gap-1.5 rounded-2xl border p-3 text-xs font-medium transition-[background-color,border-color,transform] duration-200 active:scale-95",
                  isActive ? "border-transparent pill-fill"
                           : "border-line bg-field text-foreground hover:bg-hover")}>
                <n.icon className="h-5 w-5" aria-hidden="true" />{n.label}
              </NavLink>
            ))}
          </nav>
          <button type="button" data-testid="more-signout" onClick={logout}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-line-strong bg-field py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-hover">
            <LogOut className="h-4 w-4" aria-hidden="true" />Sign out
          </button>
        </SheetContent>
      </Sheet>

      <QuickAddFab onClick={() => setQuickOpen(true)} />
      <RecurringNotice />
      <AIAssistant />
      <CommandBar open={cmdOpen} setOpen={setCmdOpen} onQuickAdd={() => setQuickOpen(true)} />
      <QuickAdd open={quickOpen} setOpen={setQuickOpen} />
    </div>
  );
}
