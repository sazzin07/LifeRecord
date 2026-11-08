/* "Mix your meal": what a recipe offers per serving, what it contains, and how a chosen goal plus ingredient choices narrow and order the list.
   Pure functions on the recipe evaluations the server returns (`GET /recipes/suggestions`), so they are easy to test. */
import { cookTimeLabel } from "../../lib/cookTime";

export const GOALS = [
  { id: "protein", label: "Most protein" },
  { id: "energy", label: "Most energy" },
  { id: "light", label: "Lightest" },
];

export const WITH = [
  { id: "meat", label: "Meat", sticker: ["Chicken thighs", "Meat"] },
  { id: "fish", label: "Fish", sticker: ["Salmon fillets", "Fish"] },
  { id: "eggs", label: "Eggs", sticker: ["Free-range eggs", "Eggs"] },
  { id: "dairy", label: "Dairy", sticker: ["Whole milk", "Dairy"] },
  { id: "veggie", label: "Meat-free", sticker: ["Spinach", "Vegetables"] },
];

const RULES = {
  meat: /chicken|turkey|duck|beef|pork|lamb|steak|mince|sausage|bacon|ham\b|gammon|veal|meat|burger|chorizo|salami/i,
  fish: /salmon|tuna|cod\b|haddock|fish|prawn|shrimp|trout|mackerel|sardine|anchov|seabass|squid|crab/i,
  eggs: /\begg/i,
  dairy: /milk|cheese|cheddar|mozzarella|parmesan|feta|yoghurt|yogurt|butter|cream|skyr|kefir/i,
};

/** What the recipe contains, from its ingredient names. "veggie" means no meat and no fish. */
export function tagsOf(recipe) {
  const names = (recipe.ingredients || []).map((i) => i.name).join(" | ");
  const tags = Object.keys(RULES).filter((t) => RULES[t].test(names));
  if (!tags.includes("meat") && !tags.includes("fish")) tags.push("veggie");
  return tags;
}

/** Per serving; null when the recipe has no figure for it. */
export function perServing(recipe) {
  const n = recipe.servings || 1;
  const one = (v) => (v === null || v === undefined || v === "" ? null : Math.round(Number(v) / n));
  return { kcal: one(recipe.calories), protein: one(recipe.protein) };
}

/** A recipe is "quick" only when it gives a cooking time and that time is this many minutes or fewer. */
export const QUICK_MINUTES = 20;
export const isQuick = (recipe) => Number(recipe?.cook_minutes) > 0 && Number(recipe.cook_minutes) <= QUICK_MINUTES;

export { cookTimeLabel };

const clash = (a, b) => (a === "veggie" && (b === "meat" || b === "fish")) || (b === "veggie" && (a === "meat" || a === "fish"));
export const EMPTY_MIX = { goal: null, inc: [], quick: false };

/** Switch one ingredient choice on or off; Meat-free and Meat or Fish cannot both be on. */
export function toggleInclude(mix, id) {
  if (mix.inc.includes(id)) return { ...mix, inc: mix.inc.filter((x) => x !== id) };
  return { ...mix, inc: [...mix.inc.filter((x) => !clash(id, x)), id] };
}

/** Switch the "Under 20 min" choice on or off. */
export const toggleQuick = (mix) => ({ ...mix, quick: !mix.quick });

export const fits = (e, mix) => mix.inc.every((t) => tagsOf(e.recipe).includes(t)) && (!mix.quick || isQuick(e.recipe));

/** How many of these recipes would be left if one more ingredient choice were switched on. */
export const leftIf = (list, mix, id) => list.filter((e) => fits(e, toggleInclude(mix, id))).length;

/** How many would be left if the "Under 20 min" choice were switched on (the other choices stay as they are). */
export const leftIfQuick = (list, mix) => list.filter((e) => fits(e, { ...mix, quick: true })).length;

/** The recipes that fit the mix, in the order the goal asks for (recipes without the figure go last, ties keep the server's order). */
export function applyMix(list, mix) {
  const out = list.filter((e) => fits(e, mix));
  if (!mix.goal) return out;
  const key = (e) => { const p = perServing(e.recipe); return mix.goal === "protein" ? p.protein : p.kcal; };
  const sign = mix.goal === "light" ? 1 : -1;
  return [...out].sort((a, b) => {
    const x = key(a), y = key(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return sign * (x - y);
  });
}

const amount = (n) => String(+Number(n).toFixed(2));

/** What cooking will do, said before it does it: the food it uses up with amounts, what is missing, and that it cannot be undone from the page. */
export function cookSummary(e) {
  const rows = e.ingredients || [];
  const used = rows
    .filter((i) => i.status !== "missing" && Number(i.status === "short" ? i.have : i.needed) > 0)
    .map((i) => `${i.name.toLowerCase()} ${amount(i.status === "short" ? i.have : i.needed)} ${i.unit}`);
  const gone = (e.missing || []).map((m) => m.name.toLowerCase());
  if (e.can_cook_now) return `Uses up ${used.join(", ")}. It logs one serving as a meal, and cooking cannot be undone from here.`;
  const lead = `You are missing ${gone.join(", ")}.`;
  return used.length
    ? `${lead} Cooking still uses up ${used.join(", ")}, logs one serving as a meal, and cannot be undone from here.`
    : `${lead} Cooking logs one serving as a meal and cannot be undone from here.`;
}

/** A friendly line about where a recipe stands. */
export function voice(e) {
  const miss = e.missing.map((m) => m.name.toLowerCase());
  if (!miss.length) return e.uses_expiring.length ? `You have it all, and it rescues the ${e.uses_expiring[0].name.toLowerCase()}.` : "You have everything. Apron on.";
  if (miss.length === 1) return `One thing away: ${miss[0]}.`;
  if (miss.length === 2) return `Two things away: ${miss.join(" and ")}.`;
  return `A shop away. ${miss.length} things missing.`;
}
