export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const KINDS = [
  ["daily", "Every day"], ["weekly", "Certain weekdays"], ["monthly", "Every month"], ["interval", "Every few hours or days"], ["once", "Just once"],
];

export const TIME_PRESETS = ["07:00", "09:00", "12:00", "18:00", "21:00"];

export function detectTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

export function timezoneList() {
  const own = detectTimezone();
  let all = [];
  try { all = Intl.supportedValuesOf("timeZone"); } catch { all = ["UTC", "Europe/Lisbon", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"]; }
  return [own, ...all.filter((z) => z !== own)];
}

export const defaultSchedule = (kind = "weekly") => ({
  daily: { kind: "daily", time: "09:00" },
  weekly: { kind: "weekly", time: "09:00", weekdays: [0] },
  monthly: { kind: "monthly", time: "09:00", day_of_month: 1 },
  interval: { kind: "interval", every: 6, unit: "hours" },
  once: { kind: "once", time: "09:00", date: "" },
}[kind]);

/** "Mon 26 Oct, 09:00" in the task's own timezone. */
export function formatWhen(iso, timezone, { withZone = false } = {}) {
  if (!iso) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }).format(new Date(iso));
    return withZone ? `${parts} (${timezone})` : parts;
  } catch { return new Date(iso).toLocaleString(); }
}

export function clockOf(iso, timezone) {
  try { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }).format(new Date(iso)); } catch { return ""; }
}

export function dayOf(iso, timezone) {
  try { return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: timezone }).format(new Date(iso)); } catch { return ""; }
}

export function relative(iso, now = Date.now()) {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const unit = abs < 3600e3 ? [60e3, "minute"] : abs < 86400e3 ? [3600e3, "hour"] : [86400e3, "day"];
  const n = Math.max(1, Math.round(abs / unit[0]));
  const label = `${n} ${unit[1]}${n === 1 ? "" : "s"}`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

export const duration = (ms) => (ms == null ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export const TASK_STATUS = {
  draft: { label: "Needs review", tone: "slate" },
  active: { label: "Active", tone: "emerald" },
  paused: { label: "Paused", tone: "amber" },
  completed: { label: "Done", tone: "slate" },
};
export const RUN_STATUS = {
  queued: { label: "Waiting", tone: "sky" }, running: { label: "Running", tone: "sky" },
  succeeded: { label: "Succeeded", tone: "emerald" }, failed: { label: "Failed", tone: "red" }, missed: { label: "Missed", tone: "amber" },
};
export const DELIVERY = {
  none: { label: "Not emailed", tone: "slate" }, pending: { label: "Sending", tone: "sky" }, sending: { label: "Sending", tone: "sky" },
  sent: { label: "Emailed", tone: "emerald" }, failed: { label: "Not delivered", tone: "red" }, not_configured: { label: "Email not set up", tone: "amber" },
};

export const TONES = {
  slate: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  emerald: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  red: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200",
  sky: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200",
};

export function errorText(e, fallback = "Something went wrong. Please try again.") {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  if (Array.isArray(d) && d[0]?.msg) return String(d[0].msg).replace(/^Value error, /, "");
  if (!e?.response) return "You appear to be offline. Check your connection and try again.";
  return fallback;
}

export const isLive = (run) => run && (run.status === "queued" || run.status === "running");
