import {
  Package, Beef, Fish, Egg, Milk, Wheat, Apple, Carrot, Snowflake, Cookie, Wine, MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Id of the pseudo space for food whose storage place is not one of the configured spaces. */
export const ELSEWHERE_ID = "__elsewhere";
export const CATS = ["Meat", "Fish", "Eggs", "Dairy", "Carbohydrates", "Fruit", "Vegetables", "Frozen", "Pantry", "Snacks", "Drinks", "Other"];
export const UNITS = ["unit", "kg", "g", "L", "ml", "pack", "bottle", "can", "box", "bag", "bunch", "jar"];

export const CAT_META = {
  Meat: { icon: Beef, color: "#EF4444" },
  Fish: { icon: Fish, color: "#0EA5E9" },
  Eggs: { icon: Egg, color: "#F59E0B" },
  Dairy: { icon: Milk, color: "#3B82F6" },
  Carbohydrates: { icon: Wheat, color: "#F97316" },
  Fruit: { icon: Apple, color: "#EC4899" },
  Vegetables: { icon: Carrot, color: "#10B981" },
  Frozen: { icon: Snowflake, color: "#06B6D4" },
  Pantry: { icon: Package, color: "#8B5CF6" },
  Snacks: { icon: Cookie, color: "#D946EF" },
  Drinks: { icon: Wine, color: "#14B8A6" },
  Other: { icon: MoreHorizontal, color: "#64748B" },
};
// Seeded/AI-created items use a few alias names for the same shelves.
CAT_META.Produce = CAT_META.Vegetables;
CAT_META.Beverages = CAT_META.Drinks;

// Seeded and AI-created products sometimes use alias category names; show them under the app's own.
const CAT_ALIAS = { Produce: "Vegetables", Beverages: "Drinks", Grains: "Carbohydrates", Bakery: "Carbohydrates", Canned: "Pantry", Condiments: "Pantry", Spices: "Pantry", Oils: "Pantry", Baking: "Pantry" };
export const catOf = (p) => (CAT_META[p.category] ? p.category : CAT_ALIAS[p.category] || "Other");

export const DIET_TAGS = [
  { key: "vegan", label: "Vegan" },
  { key: "vegetarian", label: "Vegetarian" },
  { key: "gluten-free", label: "Gluten-free" },
  { key: "lactose-free", label: "Lactose-free" },
];

/** Quick nutrition filters, judged on the per-100 g figures a product carries. */
export const NUTRI_FILTERS = [
  { key: "high-protein", label: "High protein", test: (n) => !!n && n.protein >= 15 },
  { key: "low-calorie", label: "Low calorie", test: (n) => !!n && n.calories_per_100g <= 60 },
  { key: "low-carb", label: "Low carb", test: (n) => !!n && n.calories_per_100g > 0 && n.carbs <= 5 },
];

export function CatIcon({ category, className }) {
  const meta = CAT_META[category] || CAT_META.Other;
  const Icon = meta.icon;
  return (
    <div className={cn("h-9 w-9 rounded-xl grid place-items-center shrink-0", className)} style={{ background: `${meta.color}22` }}>
      <Icon className="h-4 w-4" style={{ color: meta.color }} />
    </div>
  );
}

export function quantityText(q, unit) {
  const val = Number(q || 0);
  if (val === 0) return "—";
  if (val === Math.floor(val)) return `${Math.floor(val)} ${unit || ""}`.trim();
  return `${val.toFixed(2)} ${unit || ""}`.trim();
}

export function isLow(g) {
  return Number(g.low_threshold) > 0 && Number(g.quantity) <= Number(g.low_threshold);
}

/** Something to look at today: running low, or going off within three days. */
export const needsAttention = (g) => isLow(g) || (daysUntil(g.expiration) ?? 99) <= 3;

/** Whole days from today until the expiration date (negative = already expired); null when unset. */
export function daysUntil(expiration) {
  if (!expiration) return null;
  const d = new Date(`${expiration}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

export function expiryLabel(expiration) {
  const n = daysUntil(expiration);
  if (n === null) return null;
  if (n < 0) return { text: `Expired ${-n}d ago`, tone: "red" };
  if (n === 0) return { text: "Expires today", tone: "red" };
  if (n <= 3) return { text: `${n}d left`, tone: "red" };
  if (n <= 7) return { text: `${n}d left`, tone: "amber" };
  return { text: `${n}d left`, tone: "slate" };
}

/**
 * Resolve each inventory item to a configured storage location.
 * Items store the location name; fall back to matching by kind, otherwise "elsewhere".
 */
export function groupByLocation(locations, inventory) {
  const byName = new Map(locations.map((l) => [l.name.toLowerCase(), l.id]));
  const byKind = new Map();
  locations.forEach((l) => { if (!byKind.has(l.kind)) byKind.set(l.kind, l.id); });
  const groups = new Map(locations.map((l) => [l.id, []]));
  const elsewhere = [];
  inventory.forEach((g) => {
    const key = (g.storage_location || "").toLowerCase();
    const id = byName.get(key) || byKind.get(key);
    if (id) groups.get(id).push(g); else elsewhere.push(g);
  });
  return { groups, elsewhere };
}

/** The configured storage location an inventory item lives in (by name, then kind), or null. */
export function locationOf(locations, g) {
  const key = (g.storage_location || "").toLowerCase();
  return locations.find((l) => l.name.toLowerCase() === key) || locations.find((l) => (l.kind || "").toLowerCase() === key) || null;
}
