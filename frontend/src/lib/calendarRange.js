import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";

// 1 = Monday, 0 = Sunday. Set from the person's setting (SettingsContext) before the pages that read it render.
let weekStartsOn = 1;
export const setWeekStartsOn = (day) => { weekStartsOn = day === 0 ? 0 : 1; };
export const getWeekStartsOn = () => weekStartsOn;
export const iso = (d) => format(d, "yyyy-MM-dd");

/** The weeks a month grid shows: first day of the week before the 1st to the last day of the week after the last day. */
export function monthGridRange(anchor) {
  return { start: startOfWeek(startOfMonth(anchor), { weekStartsOn }), end: endOfWeek(endOfMonth(anchor), { weekStartsOn }) };
}

export function weekRange(anchor) {
  const start = startOfWeek(anchor, { weekStartsOn });
  return { start, end: addDays(start, 6) };
}

/** API path for a range; the Calendar page and the route prefetch must build it the same way. */
export const calendarPath = ({ start, end }) => `/calendar?start=${iso(start)}&end=${iso(end)}`;
