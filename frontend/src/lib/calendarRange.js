import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";

export const WEEK_STARTS_ON = 1; // Monday
export const iso = (d) => format(d, "yyyy-MM-dd");

/** The weeks a month grid shows: Monday before the 1st to Sunday after the last day. */
export function monthGridRange(anchor) {
  return { start: startOfWeek(startOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON }), end: endOfWeek(endOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON }) };
}

export function weekRange(anchor) {
  const start = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON });
  return { start, end: addDays(start, 6) };
}

/** API path for a range; the Calendar page and the route prefetch must build it the same way. */
export const calendarPath = ({ start, end }) => `/calendar?start=${iso(start)}&end=${iso(end)}`;
