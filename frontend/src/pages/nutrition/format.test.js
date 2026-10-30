import { defaultAmount, fmt, mealForHour, prettyDate, shiftDate, shortName, weekStart } from "./format";
import { inScope } from "../../lib/refreshScope";

describe("dates", () => {
  test("shiftDate crosses month and year ends without the UTC day shifting", () => {
    expect(shiftDate("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDate("2028-02-28", 1)).toBe("2028-02-29"); // a leap year
  });
  test("weeks start on Monday", () => {
    expect(weekStart("2026-10-26")).toBe("2026-10-26"); // a Monday
    expect(weekStart("2026-10-30")).toBe("2026-10-26"); // a Friday
    expect(weekStart("2026-11-01")).toBe("2026-10-26"); // the Sunday that ends it
    expect(weekStart("2026-11-02")).toBe("2026-11-02");
  });
  test("prettyDate names the days around today and falls back to the plain date", () => {
    expect(prettyDate("2026-10-30", "2026-10-30")).toBe("Today");
    expect(prettyDate("2026-10-29", "2026-10-30")).toBe("Yesterday");
    expect(prettyDate("2026-10-31", "2026-10-30")).toBe("Tomorrow");
    expect(prettyDate("2026-10-20")).toBe("2026-10-20"); // today not known yet (the page is still loading)
  });
});

describe("meals", () => {
  test("the meal follows the hour, with the same cut-offs as the server", () => {
    expect([6, 10, 11, 14, 15, 17, 18, 23].map(mealForHour)).toEqual(["breakfast", "breakfast", "lunch", "lunch", "snack", "snack", "dinner", "dinner"]);
  });
});

describe("one-tap amounts", () => {
  test("the last amount used wins, then the food's first portion, then 100 g", () => {
    expect(defaultAmount({ last_quantity: 150, last_unit: "g", portions: [{ label: "1 cup", grams: 60 }] })).toEqual({ quantity: 150, unit: "g" });
    expect(defaultAmount({ portions: [{ label: "1 cup", grams: 60 }] })).toEqual({ quantity: 1, unit: "1 cup" });
    expect(defaultAmount({ portions: ["1 slice"] })).toEqual({ quantity: 1, unit: "1 slice" });
    expect(defaultAmount({ portions: [] })).toEqual({ quantity: 100, unit: "g" });
    expect(defaultAmount({})).toEqual({ quantity: 100, unit: "g" });
  });
});

describe("numbers and names", () => {
  test("a missing number is a dash, never a zero", () => {
    expect(fmt(null)).toBe("–");
    expect(fmt(undefined)).toBe("–");
    expect(fmt(NaN)).toBe("–");
    expect(fmt(0)).toBe("0");
  });
  test("database names are shortened to their first two parts", () => {
    expect(shortName("Chicken, broilers or fryers, breast, meat only, cooked")).toBe("Chicken, broilers or fryers");
    expect(shortName("Oats")).toBe("Oats");
    expect(shortName(null)).toBe("");
  });
});

describe("scoped refresh", () => {
  test("no scope means everything", () => {
    expect(inScope("/groceries", undefined)).toBe(true);
  });
  test("a scope matches its own path, sub-paths and queries, and nothing that merely starts with the same letters", () => {
    const scope = ["/nutrition", "/recipes"];
    expect(inScope("/nutrition", scope)).toBe(true);
    expect(inScope("/nutrition/day", scope)).toBe(true);
    expect(inScope("/nutrition/day?date=2026-10-30", scope)).toBe(true);
    expect(inScope("/recipes/suggestions", scope)).toBe(true);
    expect(inScope("/nutritionist", scope)).toBe(false);
    expect(inScope(null, scope)).toBe(false);      // a data hook that is switched off has no path and must not throw
    expect(inScope(undefined, scope)).toBe(false);
    expect(inScope(null, undefined)).toBe(true);   // unscoped refreshes behave exactly as before
    expect(inScope("/groceries", scope)).toBe(false);
    expect(inScope("/tasks", scope)).toBe(false);
  });
});
