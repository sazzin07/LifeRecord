import { EMPTY_MIX, QUICK_MINUTES, applyMix, cookSummary, cookTimeLabel, isQuick, leftIf, leftIfQuick, toggleInclude, toggleQuick } from "./kitchenMix";

const rec = (name, ingredients, extra = {}) => ({ recipe: { id: name, name, servings: 2, calories: 800, protein: 40, ingredients: ingredients.map((n) => ({ name: n })), ...extra } });
const omelette = rec("Omelette", ["Free-range eggs", "Butter"], { cook_minutes: 12 });
const bake = rec("Pasta bake", ["Pasta", "Cheddar"], { cook_minutes: 45 });
const toast = rec("Toast", ["Bread"]);                                // no time given
const stew = rec("Chicken stew", ["Chicken thighs"], { cook_minutes: 20 });
const all = [omelette, bake, toast, stew];

describe("cooking time in Mix your meal", () => {
  test("quick means a given time of 20 minutes or less; a recipe with no time is never called quick", () => {
    expect(QUICK_MINUTES).toBe(20);
    expect(isQuick(omelette.recipe)).toBe(true);
    expect(isQuick(stew.recipe)).toBe(true);                         // exactly 20 counts
    expect(isQuick(bake.recipe)).toBe(false);
    expect(isQuick(toast.recipe)).toBe(false);
    expect(isQuick({ cook_minutes: null })).toBe(false);
    expect(isQuick({ cook_minutes: 0 })).toBe(false);
  });

  test("the choice starts off, switches on and off, and keeps the other choices", () => {
    expect(EMPTY_MIX.quick).toBe(false);
    const withDairy = toggleInclude(EMPTY_MIX, "dairy");
    const on = toggleQuick(withDairy);
    expect(on).toEqual({ goal: null, inc: ["dairy"], quick: true });
    expect(toggleQuick(on)).toEqual(withDairy);
  });

  test("it narrows the list with the other choices", () => {
    expect(applyMix(all, toggleQuick(EMPTY_MIX)).map((e) => e.recipe.name)).toEqual(["Omelette", "Chicken stew"]);
    expect(applyMix(all, toggleQuick(toggleInclude(EMPTY_MIX, "dairy"))).map((e) => e.recipe.name)).toEqual(["Omelette"]);
    expect(applyMix(all, { ...toggleQuick(EMPTY_MIX), goal: "protein" }).map((e) => e.recipe.name)).toHaveLength(2);
  });

  test("the chips count what would be left, with the time choice taken into account", () => {
    const quickOn = toggleQuick(EMPTY_MIX);
    expect(leftIfQuick(all, EMPTY_MIX)).toBe(2);
    expect(leftIfQuick(all, toggleInclude(EMPTY_MIX, "meat"))).toBe(1);   // Chicken stew only
    expect(leftIf(all, quickOn, "dairy")).toBe(1);                         // Omelette (eggs, butter)
    expect(leftIf(all, quickOn, "veggie")).toBe(1);                        // Omelette
    expect(leftIfQuick([toast, bake], EMPTY_MIX)).toBe(0);                 // nobody has a quick time: the chip can dim
  });

  test("the card says the time in words", () => {
    expect(cookTimeLabel(12)).toBe("12 min");
    expect(cookTimeLabel(60)).toBe("1 h");
    expect(cookTimeLabel(90)).toBe("1 h 30 min");
    expect(cookTimeLabel(1440)).toBe("24 h");
    expect(cookTimeLabel(null)).toBeNull();
    expect(cookTimeLabel(undefined)).toBeNull();
    expect(cookTimeLabel(0)).toBeNull();
  });
});

describe("what cooking uses up, said before it happens", () => {
  const row = (name, needed, unit, status, have = needed) => ({ name, needed, unit, status, have });
  test("a recipe with everything in stock lists each ingredient with its amount and says it cannot be undone here", () => {
    const t = cookSummary({ can_cook_now: true, missing: [], ingredients: [row("Rice", 0.2, "kg", "ok"), row("Whole milk", 0.5, "L", "ok")] });
    expect(t).toBe("Uses up rice 0.2 kg, whole milk 0.5 L. It logs one serving as a meal, and cooking cannot be undone from here.");
  });
  test("a recipe that is short uses what is there and names what is missing", () => {
    const t = cookSummary({ can_cook_now: false, missing: [{ name: "Basil" }], ingredients: [row("Pasta", 200, "g", "short", 150), row("Basil", 1, "unit", "missing", 0)] });
    expect(t).toBe("You are missing basil. Cooking still uses up pasta 150 g, logs one serving as a meal, and cannot be undone from here.");
  });
  test("nothing in stock still says what cooking does", () => {
    const t = cookSummary({ can_cook_now: false, missing: [{ name: "Basil" }], ingredients: [row("Basil", 1, "unit", "missing", 0)] });
    expect(t).toBe("You are missing basil. Cooking logs one serving as a meal and cannot be undone from here.");
  });
});
