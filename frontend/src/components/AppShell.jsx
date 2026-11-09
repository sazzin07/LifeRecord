import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { warmAllRoutes } from "@/lib/routes";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, LogOut, Sun, Moon, UserRound, PanelLeft } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NavDock } from "@/components/dock/NavDock";
import { PhoneBall } from "@/components/dock/PhoneBall";
import { PhoneMenu } from "@/components/dock/PhoneMenu";
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
import { useMediaQuery } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";

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
  const { resolvedTheme, setTheme, bindServer, pull } = useSettings();
  const nav = useNavigate();
  const loc = useLocation();
  const [intro, setIntro] = useState(true);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [offline, setOffline] = useState(false);
  const phone = useMediaQuery("(max-width: 639px)");   // a phone has the ball (assistant and quick actions) and a side menu of pages instead of the dock
  const [menuOpen, setMenuOpen] = useState(false);
  const [quickStart, setQuickStart] = useState(null);
  const menuButton = useRef(null);
  const openQuick = (key = null) => { setQuickStart(key); setQuickOpen(true); };
  const [currencyTick, setCurrencyTick] = useState(0);   // bumped when the main currency changes, so every amount is drawn again
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

      {/* Top bar */}
      <header className="glass sticky top-0 z-20 h-16 border-b border-line">
        {/* The same width as the page below, so the bar lines up with the content. */}
        <div className="mx-auto flex h-full max-w-7xl items-center gap-3 px-4 sm:px-6">
          {phone && (
            <button ref={menuButton} type="button" data-testid="menu-toggle" aria-label="Open the menu of pages" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}
              className="-ml-1 grid h-11 w-11 place-items-center rounded-full text-foreground transition-[background-color,transform] duration-200 hover:bg-hover active:scale-95">
              <PanelLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-xl bg-[linear-gradient(135deg,#e2b6ea,#a679b2)] text-[#2a1433]"><Sparkles className="h-4 w-4" /></div>
            <span className="font-bold tracking-tight">Life Record</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!phone && (
            <button type="button" data-testid="ai-trigger" aria-label="Open the assistant" aria-haspopup="dialog" onClick={() => openAI()}
              className="group flex h-11 min-w-[2.75rem] items-center justify-center gap-2 rounded-full sm:h-10 [@media(pointer:coarse)]:h-11 sm:min-w-0 border border-line-strong bg-field px-3 text-sm font-semibold text-foreground transition-[background-color,border-color,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-line-strong hover:bg-hover active:scale-[0.96] motion-reduce:transition-colors motion-reduce:active:scale-100 sm:pl-3.5 sm:pr-4">
              <Sparkles className="h-4 w-4 text-accent-ink transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:rotate-[18deg] group-hover:scale-110 motion-reduce:transition-none motion-reduce:group-hover:transform-none" aria-hidden="true" />
              <span className="hidden sm:inline">Assistant</span>
            </button>
            )}
            <button data-testid="theme-toggle" aria-label={resolvedTheme === "dark" ? "Switch to the light theme" : "Switch to the dark theme"} onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="grid h-11 w-11 place-items-center rounded-full border border-line-strong bg-field text-foreground transition-[border-color,background-color,transform] duration-200 hover:bg-hover active:scale-95 sm:h-10 sm:w-10 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
              {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" data-testid="header-menu" aria-label={`Account menu${user?.name ? `, ${user.name}` : ""}`}
                  className="grid h-11 w-11 place-items-center overflow-hidden rounded-full border border-line-strong bg-field text-sm font-semibold text-accent-ink transition-[border-color,transform] duration-200 hover:border-line-strong active:scale-95 sm:h-10 sm:w-10 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                  {/* Decorative: the button's label already names the person (the initials would not match it). A fixed size, so a large photo is scaled, not cropped by its own size. */}
                  <span aria-hidden="true" className="block h-[38px] w-[38px] overflow-hidden rounded-full"><UserAvatar size="h-[38px] w-[38px]" className="text-xs" decorative /></span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[11rem]">
                <DropdownMenuItem asChild>
                  <NavLink to="/profile" data-testid="header-profile" className="cursor-pointer gap-2"><UserRound className="h-4 w-4" aria-hidden="true" />Your profile</NavLink>
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="logout-btn" onSelect={() => logout()} className="cursor-pointer gap-2"><LogOut className="h-4 w-4" aria-hidden="true" />Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Content */}
      <main>
        {offline && (
          <div data-testid="offline-banner" className="bg-amber-700 text-white text-sm font-medium text-center py-2 px-4">
            ⚠️ Offline / fallback mode — backend unavailable. Showing last known data; changes won't save until reconnected.
          </div>
        )}
        <div key={`${loc.pathname}:${currencyTick}`} className="lm-page max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-32">{children}</div>
      </main>

      {phone ? <PhoneBall onChoose={(key) => (key === "assistant" ? openAI() : openQuick(key === "more" ? null : key))} /> : <NavDock />}
      {phone && <PhoneMenu open={menuOpen} onOpenChange={setMenuOpen} opener={menuButton} />}

      {!phone && <QuickAddFab onClick={() => openQuick()} />}
      <RecurringNotice />
      <AIAssistant />
      <CommandBar open={cmdOpen} setOpen={setCmdOpen} onQuickAdd={() => openQuick()} />
      <QuickAdd open={quickOpen} setOpen={setQuickOpen} start={quickStart} />
    </div>
  );
}
