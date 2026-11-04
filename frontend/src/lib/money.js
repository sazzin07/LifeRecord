// Money as text, in a currency (F-09). Display only: nothing here converts one currency into another.
//
// The "main currency" is the currency of the person's bank account. It is what a bare `eur(n)` / `money(n)` uses, so every screen that shows a
// single figure follows it; an amount that belongs to one account passes that account's own currency. It is remembered in this browser so the
// first paint after a reload already uses it.

const KEY = "lr-main-currency";
const CODE = /^[A-Z]{3}$/;
let main = (() => { try { const v = localStorage.getItem(KEY); return v && CODE.test(v) ? v : "EUR"; } catch { return "EUR"; } })();
const cache = new Map();

export const mainCurrency = () => main;

/** Returns true when the main currency actually changed (the caller then redraws what shows amounts). */
export function setMainCurrency(code) {
  const c = String(code || "").toUpperCase();
  if (!CODE.test(c) || c === main) return false;
  main = c;
  try { localStorage.setItem(KEY, c); } catch { /* private mode: it is read again from the accounts next time */ }
  return true;
}

function formatter(currency) {
  if (!cache.has(currency)) {
    let f;
    try { f = new Intl.NumberFormat("en-IE", { style: "currency", currency }); } catch { f = new Intl.NumberFormat("en-IE", { style: "currency", currency: main }); }
    cache.set(currency, f);
  }
  return cache.get(currency);
}

/** 1234.5 -> "€1,234.50"; a currency with no decimals (JPY) shows none, one with three (KWD) shows three. */
export const money = (n, currency) => formatter(String(currency || main).toUpperCase()).format(Number(n || 0));

/** How many decimals the currency's smallest unit has: 2 for EUR, 0 for JPY, 3 for KWD. */
export const currencyDigits = (currency) => formatter(String(currency || main).toUpperCase()).resolvedOptions().maximumFractionDigits;

/** "€", "$", "CHF": what stands in front of an amount. */
export function currencySymbol(currency) {
  const part = formatter(String(currency || main).toUpperCase()).formatToParts(0).find((p) => p.type === "currency");
  return part ? part.value : String(currency || main);
}

/** The step an amount field in this currency should move by: 0.01 for EUR, 1 for JPY, 0.001 for KWD. */
export const currencyStep = (currency) => String(10 ** -currencyDigits(currency));

/** Every currency the browser knows, as [{ code, name }], sorted by name. */
export function currencyOptions() {
  let codes = [];
  try { codes = Intl.supportedValuesOf("currency"); } catch { codes = ["EUR", "USD", "GBP", "CHF", "BRL", "JPY"]; }
  let names = null;
  try { names = new Intl.DisplayNames(["en"], { type: "currency" }); } catch { /* names fall back to the code */ }
  return codes.map((code) => ({ code, name: (names && names.of(code)) || code })).sort((a, b) => a.name.localeCompare(b.name));
}

/** The currency of the bank account (the first top-level one), else of the first top-level account, else EUR. Mirrors the server. */
export function mainCurrencyOf(accounts) {
  const top = (accounts || []).filter((a) => !a.parent_id);
  const bank = top.find((a) => a.type === "bank") || top[0];
  return (bank && bank.currency) || "EUR";
}
