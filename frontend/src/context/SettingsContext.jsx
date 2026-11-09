import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { setWeekStartsOn } from "@/lib/calendarRange";
import { setDefaultMoneyPeriod } from "@/lib/periods";

const SettingsCtx = createContext(null);
export const useSettings = () => useContext(SettingsCtx);

const load = (k, d) => {
  try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); }
  catch { return d; }
};
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* the choice just is not remembered here */ } };

// The choices that follow the person to every device (and that the assistant can change), with the name each has on the server.
const SERVER_KEY = { theme: "theme", animations: "animations", weekStart: "week_start", moneyPeriod: "money_period" };
const DEFAULTS = { theme: "system", animations: true, weekStart: "monday", moneyPeriod: "week" };
const fromServer = (p) => ({ theme: p.theme, animations: p.animations, weekStart: p.week_start, moneyPeriod: p.money_period });

export function SettingsProvider({ children }) {
  const [theme, setThemeState] = useState(() => load("lm_theme", DEFAULTS.theme));
  const [animations, setAnimationsState] = useState(() => load("lm_anim", DEFAULTS.animations));
  const [weekStart, setWeekStartState] = useState(() => load("lm_week_start", DEFAULTS.weekStart));
  const [moneyPeriod, setMoneyPeriodState] = useState(() => load("lm_money_period", DEFAULTS.moneyPeriod));
  const [sync, setSyncState] = useState(() => load("lm_sync", true));
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);
  const [saveError, setSaveError] = useState(false);   // the last attempt to reach the account failed: shown in Settings, with a way to try again
  const bound = useRef(false);            // a signed-in screen is attached: choices can be saved to the server
  const lastPull = useRef(0);
  const changedAt = useRef(0);          // when this person last changed a choice here: an answer from the server that left earlier is out of date

  const syncRef = useRef(sync);
  syncRef.current = sync;

  // Set during render, before any page reads it: the calendar's first day of the week.
  setWeekStartsOn(weekStart === "sunday" ? 0 : 1);
  setDefaultMoneyPeriod(moneyPeriod);

  // What is really on screen: "system" resolves to the device's own light or dark, so a control can show the right one.
  const [resolvedTheme, setResolvedTheme] = useState(() => (typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light"));

  useEffect(() => {
    const root = document.documentElement;
    const apply = (t) => {
      if (t === "dark") root.classList.add("dark");
      else if (t === "light") root.classList.remove("dark");
      else root.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
      setResolvedTheme(root.classList.contains("dark") ? "dark" : "light");
    };
    apply(theme);
    store("lm_theme", theme);
    if (theme !== "system" || typeof window.matchMedia !== "function") return undefined;
    // "System" follows the device as it changes (evening, a switch in the OS), not only at load.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle("no-anim", !animations);
    store("lm_anim", animations);
  }, [animations]);
  useEffect(() => { store("lm_week_start", weekStart); }, [weekStart]);
  useEffect(() => { store("lm_money_period", moneyPeriod); }, [moneyPeriod]);
  useEffect(() => { store("lm_sync", sync); }, [sync]);

  const setters = { theme: setThemeState, animations: setAnimationsState, weekStart: setWeekStartState, moneyPeriod: setMoneyPeriodState };

  // Saving to the account is a queue of one: choices made while a save is on its way are merged and sent together afterwards, and a
  // failure keeps what was not saved so "Try again" (or the next time the server answers) sends it. No pop-up: the state is shown where
  // the choices are made. Being signed out or having no such server route is not this device's problem to announce.
  const queued = useRef({});
  const sending = useRef(false);
  const flush = useCallback(async () => {
    if (sending.current || Object.keys(queued.current).length === 0) return;
    sending.current = true;
    setSaving(true);
    try {
      while (Object.keys(queued.current).length > 0) {
        const body = queued.current;
        queued.current = {};
        try {
          await api.put("/preferences", body);
          setSaveError(false);
          setSavedAt(Date.now());
        } catch (err) {
          const status = err?.response?.status;
          if (status === 401 || status === 403) return;              // signed out: the app is taking care of that
          queued.current = { ...body, ...queued.current };            // keep it, newer choices win
          setSaveError(true);
          return;
        }
      }
    } finally { sending.current = false; setSaving(false); }
  }, []);
  const push = useCallback((body) => { queued.current = { ...queued.current, ...body }; return flush(); }, [flush]);
  const retrySave = useCallback(() => flush(), [flush]);

  /** Change one synced choice: here at once, and on the account when this device syncs. */
  const setPref = useCallback((key, value) => {
    changedAt.current = Date.now();
    setters[key](value);   // eslint-disable-line react-hooks/exhaustive-deps -- the setters never change
    if (syncRef.current && bound.current) push({ [SERVER_KEY[key]]: value });
  }, [push]);  // eslint-disable-line react-hooks/exhaustive-deps

  /** Ask the account what it has saved. The first time (nothing saved yet) this device's choices become the account's. */
  const pull = useCallback(async ({ force = false } = {}) => {
    if (!bound.current || !syncRef.current) return;
    if (!force && Date.now() - lastPull.current < 1500) return;
    const started = Date.now();
    lastPull.current = started;
    try {
      const { data } = await api.get("/preferences");
      if (changedAt.current >= started) return;   // a choice was made here while this was on its way: that one is newer
      if (!data.saved) {
        await api.put("/preferences", { theme, animations, week_start: weekStart, money_period: moneyPeriod });
        return;
      }
      if (Object.keys(queued.current).length > 0) { flush(); return; }   // the server is reachable again: send what was kept first
      const next = fromServer(data.preferences);
      Object.entries(next).forEach(([k, v]) => setters[k](v));
    } catch { /* offline or signed out: this device's choices stay as they are */ }
  }, [theme, animations, weekStart, moneyPeriod, flush]);  // eslint-disable-line react-hooks/exhaustive-deps

  const bindServer = useCallback((on) => { bound.current = on; }, []);
  const setSync = (on) => {
    setSyncState(on);
    syncRef.current = on;
    if (on) pull({ force: true });
  };
  const resetAll = async () => {
    Object.entries(DEFAULTS).forEach(([k, v]) => setters[k](v));
    if (syncRef.current && bound.current) await push({ theme: DEFAULTS.theme, animations: DEFAULTS.animations, week_start: DEFAULTS.weekStart, money_period: DEFAULTS.moneyPeriod });
  };

  const value = useMemo(() => ({
    theme, resolvedTheme, setTheme: (v) => setPref("theme", v),
    animations, setAnimations: (v) => setPref("animations", v),
    weekStart, setWeekStart: (v) => setPref("weekStart", v),
    moneyPeriod, setMoneyPeriod: (v) => setPref("moneyPeriod", v),
    sync, setSync, saving, savedAt, saveError, retrySave, bindServer, pull, resetAll, DEFAULTS,
  }), [theme, resolvedTheme, animations, weekStart, moneyPeriod, sync, saving, savedAt, saveError, retrySave, setPref, pull, bindServer]);  // eslint-disable-line react-hooks/exhaustive-deps

  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}
