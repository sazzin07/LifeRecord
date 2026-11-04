import { currencyDigits, currencyOptions, currencyStep, currencySymbol, mainCurrency, mainCurrencyOf, money, moneyCompact, setMainCurrency } from "./money";

beforeEach(() => { localStorage.clear(); setMainCurrency("EUR"); });

test("amounts show in their currency, with the digits that currency uses", () => {
  expect(money(1234.5, "EUR")).toContain("1,234.50");
  expect(money(1234, "JPY")).not.toMatch(/\./);
  expect(money(1, "KWD")).toMatch(/1\.000/);
  expect(currencyDigits("JPY")).toBe(0);
  expect(currencyDigits("KWD")).toBe(3);
  expect(currencyStep("EUR")).toBe("0.01");
  expect(currencyStep("JPY")).toBe("1");
});

test("a bare amount uses the main currency, and a bad code never throws", () => {
  expect(setMainCurrency("usd")).toBe(true);
  expect(mainCurrency()).toBe("USD");
  expect(money(5)).toContain("$");
  expect(money(5, "not-a-code")).toContain("$");
  expect(setMainCurrency("USD")).toBe(false);          // unchanged: nothing to redraw
  expect(setMainCurrency("12")).toBe(false);
});

test("symbols, the option list and the main currency of an account list", () => {
  expect(currencySymbol("EUR")).toBe("€");
  expect(currencyOptions().some((c) => c.code === "USD" && /dollar/i.test(c.name))).toBe(true);
  expect(mainCurrencyOf([{ type: "cash", currency: "GBP" }, { type: "bank", currency: "CHF" }, { type: "cash_place", parent_id: "x", currency: "JPY" }])).toBe("CHF");
  expect(mainCurrencyOf([{ type: "cash", currency: "GBP" }])).toBe("GBP");
  expect(mainCurrencyOf([])).toBe("EUR");
});

test("a figure from a million up is abbreviated, a smaller one is shown in full", () => {
  expect(moneyCompact(2469440.73, "EUR")).toMatch(/2\.47M/);
  expect(moneyCompact(999999.5, "EUR")).toBe(money(999999.5, "EUR"));
  expect(moneyCompact(5609.3)).toBe(money(5609.3));
});
