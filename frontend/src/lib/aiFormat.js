// Tidy model output before it is rendered as Markdown, so amounts never show stray asterisks or a trailing €.

const NUM = String.raw`\d[\d.,]*`;
const UNIT = String.raw`(?:\s?(?:€|EUR|eur|kg|g|ml|l|kcal|cal|%))?`;
const CUR = String.raw`[€$£]`;

// **€14.00**, **14.00€**, `14.00`, __3 kg__  ->  plain figure (figures are styled by the renderer instead of bolded)
const WRAPPED_FIGURE = new RegExp(String.raw`(\*\*|__|\`)\s*(-?${CUR}?\s?${NUM}${UNIT})\s*\1`, "g");
// 14.00€ / 14,50 € -> €14.00 / €14.50
const TRAILING_EURO = new RegExp(String.raw`(-?)(${NUM})\s?€`, "g");
const SPACED_SYMBOL = new RegExp(String.raw`(${CUR})\s+(?=\d)`, "g");
const COMMA_DECIMAL = /€(\d+),(\d{2})(?!\d)/g;
// A bold run that ends in punctuation and touches a word ("**Total:**€5", "**Done.**Next") is not closed by CommonMark.
const TIGHT_CLOSE = /(\*\*[^*\n]*[.:;,!?)€%])\*\*(?=[A-Za-z0-9])/g;

function dropDanglingMarker(text) {
  // While a reply is still streaming, an opened-but-unclosed ** would show as literal asterisks.
  const marks = [...text.matchAll(/\*\*/g)];
  if (marks.length % 2 === 0) return text;
  const last = marks[marks.length - 1].index;
  return text.slice(0, last) + text.slice(last + 2);
}

export function tidyMarkdown(text, { streaming = false } = {}) {
  let out = String(text || "");
  out = out.replace(WRAPPED_FIGURE, "$2");
  out = out.replace(TRAILING_EURO, (_, neg, n) => `${neg}€${n}`);
  out = out.replace(SPACED_SYMBOL, "$1");
  out = out.replace(COMMA_DECIMAL, "€$1.$2");
  out = out.replace(TIGHT_CLOSE, "$1** ");
  if (streaming) out = dropDanglingMarker(out);
  return out;
}

// -------- figures --------
export const MONEY = /(-?€\d[\d,]*(?:\.\d+)?)/g;

/** €14.5 -> €14.50, €1250 stays €1250 (whole amounts are left as written). */
export function normaliseMoney(token) {
  const m = token.match(/^(-?)€([\d,]+)(?:\.(\d+))?$/);
  if (!m) return token;
  const [, neg, whole, dec] = m;
  return `${neg}€${whole}${dec === undefined ? "" : "." + dec.padEnd(2, "0").slice(0, 2)}`;
}

const NUMERIC_CELL = /^[-+]?[€$£]?\d[\d.,]*\s?(?:€|%|kg|g|ml|l|kcal|cal)?$/i;
export const isNumericCell = (text) => NUMERIC_CELL.test(String(text || "").trim());

// -------- tool activity --------
const WRITE_LABELS = {
  create_expense: "Added an expense", update_expense: "Edited an expense", delete_expense: "Deleted an expense",
  record_income: "Recorded income", record_payment: "Recorded a payment", mark_refunded: "Recorded a refund",
  transfer_money: "Moved money", update_account_balance: "Corrected a balance",
  create_money_space: "Created a space", update_money_space: "Updated a space", delete_money_space: "Deleted a space",
  create_person: "Added a person", update_person: "Edited a person", delete_person: "Deleted a person",
  create_task: "Added a task", update_task: "Updated a task", delete_task: "Deleted a task",
  create_category: "Added a category", update_category: "Updated a category", delete_category: "Deleted a category",
  log_meal: "Logged a meal", update_meal: "Edited a meal", delete_meal: "Deleted a meal",
  log_workout: "Logged a workout", delete_workout: "Deleted a workout",
  record_weight: "Recorded weight", delete_weight_entry: "Deleted a weight entry",
  add_grocery: "Added to inventory", update_grocery: "Updated inventory", consume_grocery: "Used up stock", discard_grocery: "Discarded food",
  update_grocery_storage: "Moved an item", add_shopping_item: "Added to the list", update_shopping_item: "Edited a list item",
  delete_shopping_item: "Removed from the list", create_shopping_list: "Created a list", submit_purchase: "Completed a purchase",
  set_shopping_list_budget: "Set a list budget", generate_shopping_list: "Built a shopping list",
  create_recipe: "Saved a recipe", delete_recipe: "Deleted a recipe", cook_recipe: "Cooked a recipe",
  add_missing_ingredients: "Added missing ingredients", add_storage_location: "Added a space", update_storage_location: "Updated a space",
  add_appliance: "Added an appliance", add_product: "Added a product", create_recurring_list: "Created a recurring list",
  spawn_recurring_list: "Started a recurring list",
};

const READ_AREAS = {
  overview: "your day", transactions: "transactions", categories: "categories", tasks: "tasks", people: "people",
  meals: "meals", recipes: "recipes", workouts: "workouts", weight_history: "weight", accounts: "accounts",
  financial_summary: "spending", groceries: "inventory", kitchen_overview: "the kitchen", expiring_items: "expiry dates",
  shopping_lists: "shopping lists", people_balances: "balances", price_history: "prices", grocery_summary: "groceries",
  grocery_suggestions: "suggestions", products: "the catalog", storage_locations: "storage", appliances: "appliances",
  recurring_lists: "recurring lists",
};

const humanise = (name) => name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export const isReadTool = (name) => name.startsWith("get_") || name === "suggest_recipes_from_inventory";

/** Live label while a tool runs, e.g. "Checking tasks…". */
export function toolProgress(name) {
  if (name === "suggest_recipes_from_inventory") return "Matching recipes to your kitchen…";
  if (isReadTool(name)) return `Checking ${READ_AREAS[name.slice(4)] || name.slice(4).replace(/_/g, " ")}…`;
  return `${WRITE_LABELS[name] || humanise(name)}…`;
}

/** Past-tense labels for what a finished turn changed (successful writes only), de-duplicated with counts. */
export function changeSummary(actions = []) {
  const counts = new Map();
  for (const a of actions) {
    if (a.error || isReadTool(a.tool)) continue;
    const label = WRITE_LABELS[a.tool] || humanise(a.tool);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label));
}

export const failedActions = (actions = []) => actions.filter((a) => a.error && !isReadTool(a.tool));
