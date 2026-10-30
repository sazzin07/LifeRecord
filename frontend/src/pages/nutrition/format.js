// Pure helpers for the Nutrition page: meals, dates and numbers. No network or React, so they can be unit-tested.

export const MEALS = [
  { key: "breakfast", label: "Breakfast", color: "#F59E0B" },
  { key: "lunch", label: "Lunch", color: "#10B981" },
  { key: "dinner", label: "Dinner", color: "#6366F1" },
  { key: "snack", label: "Snacks", color: "#EC4899" },
  { key: "other", label: "Other", color: "#94A3B8" },
];
export const MEAL_BY_KEY = Object.fromEntries(MEALS.map((m) => [m.key, m]));
export const MACRO_COLORS = { protein_g: "#6366F1", carbs_available_g: "#F59E0B", fat_g: "#EF4444" };

/** YYYY-MM-DD in the browser's own time zone (toISOString() would give the UTC day). */
export const localISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const shiftDate = (iso, days) => {
  const [y, m, d] = iso.split("-").map(Number);
  return localISO(new Date(y, m - 1, d + days));
};
/** "Fri, 30 Oct" for an ISO day, in the browser's language. */
export const shortDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};
export const prettyDate = (iso, today) => {
  if (!today) return iso;
  if (iso === today) return "Today";
  if (iso === shiftDate(today, -1)) return "Yesterday";
  if (iso === shiftDate(today, 1)) return "Tomorrow";
  return shortDate(iso);
};
/** Monday of the week that contains `iso` (weeks start on Monday, like the plan). */
export const weekStart = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return shiftDate(iso, -dow);
};
/** The meal that fits the current hour (the server uses the same cut-offs for the assistant and for cooking). */
export const mealForHour = (h) => (h < 11 ? "breakfast" : h < 15 ? "lunch" : h < 18 ? "snack" : "dinner");
export const defaultMeal = () => mealForHour(new Date().getHours());

/** What a swap can improve (and the plain words for it). Shared by the food swaps and the recipe form. */
export const SWAP_NUTRIENTS = [["sodium_mg", "less sodium"], ["sat_fat_g", "less saturated fat"], ["sugars_g", "less sugar"], ["fiber_g", "more fibre"], ["protein_g", "more protein"],
  ["calcium_mg", "more calcium"], ["iron_mg", "more iron"], ["potassium_mg", "more potassium"]];

export const shortName = (name) => (name || "").split(",").slice(0, 2).join(",");

/** The amount to log on a single tap: what was used last time, else the food's first portion, else 100 g. */
export function defaultAmount(food) {
  if (food.last_quantity && food.last_unit) return { quantity: food.last_quantity, unit: food.last_unit };
  const p = food.portions?.[0];
  return p ? { quantity: 1, unit: typeof p === "string" ? p : p.label } : { quantity: 100, unit: "g" };
}

export function fmt(n, digits) {
  if (n == null || Number.isNaN(n)) return "–";
  const d = digits ?? (Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2);
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: d });
}
