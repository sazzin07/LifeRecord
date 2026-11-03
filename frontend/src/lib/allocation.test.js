import { planAllocation, NEW_MONEY_LABEL, spendable, isLimited, orderAccounts, defaultSpendAccount, checkSpend } from "./allocation";

// The shared axios client is not needed (and its ES-module build does not load under Jest): only the euro formatter is used.
jest.mock("axios", () => ({
  __esModule: true,
  default: { create: () => ({ interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } }), post: jest.fn() },
}));

// Money in hand: €200 in total, €50 of it in a Wallet and €150 in its favourite place, Default.
const host = { id: "cash", name: "Money in hand", total_balance: 200, unallocated_balance: 0, allocated_balance: 200, balance: 200,
  place_count: 2, favorite_place_id: "d", favorite_place_name: "Default", favorite_place_balance: 150 };
const wallet = { id: "w", name: "Wallet", parent_id: "cash", balance: 50 };
const standard = { id: "d", name: "Default", parent_id: "cash", balance: 150, is_favorite: true };

describe("a new place", () => {
  test("takes its money from the favourite place, and says the total stays", () => {
    const p = planAllocation({ host, amount: "30", newMoney: false });
    expect(p.error).toBe(false);
    expect(p.showNewMoney).toBe(true);
    expect(p.text).toContain("€30.00 moves out of Money in hand › Default");
    expect(p.text).toContain("leaving €120.00");
    expect(p.text).toContain("The total stays €200.00");
  });

  test("more than is available is refused, with the amount that is available", () => {
    const p = planAllocation({ host, amount: "160", newMoney: false });
    expect(p.error).toBe(true);
    expect(p.text).toContain("exceeds the available balance of €150.00 in Money in hand › Default");
    expect(p.text).toContain(NEW_MONEY_LABEL);
  });

  test("exactly what is available is fine", () => {
    expect(planAllocation({ host, amount: "150", newMoney: false }).error).toBe(false);
  });

  test("new money is not limited by what is available and raises the total", () => {
    const p = planAllocation({ host, amount: "160", newMoney: true });
    expect(p.error).toBe(false);
    expect(p.text).toContain("total goes from €200.00 to €360.00");
  });

  test("an empty place says nothing", () => {
    expect(planAllocation({ host, amount: "", newMoney: false }).text).toBe("");
  });

  test("works in cents without drifting", () => {
    const h = { ...host, total_balance: 100.1, favorite_place_balance: 100.1 };
    expect(planAllocation({ host: h, amount: "100.10", newMoney: false }).error).toBe(false);
    expect(planAllocation({ host: h, amount: "100.11", newMoney: false }).error).toBe(true);
  });
});

describe("editing a place", () => {
  test("a higher balance is taken from the favourite place", () => {
    const p = planAllocation({ account: wallet, host, amount: "80", newMoney: false });
    expect(p.text).toContain("€30.00 moves out");
  });

  test("a higher balance than is available is refused", () => {
    expect(planAllocation({ account: wallet, host, amount: "201", newMoney: false }).error).toBe(true);
    expect(planAllocation({ account: wallet, host, amount: "200", newMoney: false }).error).toBe(false);
  });

  test("a lower balance gives the difference back to the favourite place", () => {
    const p = planAllocation({ account: wallet, host, amount: "20", newMoney: true });
    expect(p.text).toContain("€30.00 goes back to Money in hand › Default");
    expect(p.showNewMoney).toBe(false);
  });

  test("an unchanged balance says nothing", () => {
    expect(planAllocation({ account: wallet, host, amount: "50", newMoney: false }).text).toBe("");
  });

  test("the favourite place itself is a deposit or a withdrawal, changing the total", () => {
    const up = planAllocation({ account: standard, host, amount: "170", newMoney: false });
    expect(up.text).toContain("€20.00 is added to Default, your favorite place");
    expect(up.text).toContain("total goes from €200.00 to €220.00");
    expect(up.showNewMoney).toBe(false);
    expect(planAllocation({ account: standard, host, amount: "100", newMoney: false }).text).toContain("€50.00 is taken out of Default");
  });
});

describe("editing a main account", () => {
  test("a higher total is added to the favourite place", () => {
    const p = planAllocation({ account: host, amount: "300", newMoney: false });
    expect(p.error).toBe(false);
    expect(p.text).toContain("€100.00 is added to Default, your favorite place");
  });

  test("a lower total is taken out of the favourite place, and refused when it holds less", () => {
    expect(planAllocation({ account: host, amount: "150", newMoney: false })).toMatchObject({ error: false });
    const p = planAllocation({ account: host, amount: "40", newMoney: false });
    expect(p.error).toBe(true);
    expect(p.text).toContain("€160.00");
    expect(p.text).toContain("available balance of €150.00 in Default");
  });

  test("an unchanged total says nothing", () => {
    expect(planAllocation({ account: host, amount: "200", newMoney: false }).text).toBe("");
  });
});

// Money in hand: €200 in Default (the favourite) and two other places. Revolut: €100 in its Default and a locked pot.
const accounts = [
  { id: "cash", name: "Money in hand", type: "cash", balance: 400, total_balance: 400, unallocated_balance: 0, allocated_balance: 400, place_count: 3, is_favorite: true, favorite_place_id: "cd", favorite_place_balance: 200, favorite_place_name: "Default" },
  { id: "bank", name: "Bank", type: "bank", balance: 500, place_count: 1, favorite_place_id: "bd", favorite_place_balance: 500, favorite_place_name: "Default" },
  { id: "cd", name: "Default", type: "cash_place", parent_id: "cash", balance: 200, is_favorite: true },
  { id: "wallet", name: "Wallet", type: "cash_place", parent_id: "cash", balance: 150 },
  { id: "jar", name: "Jar", type: "cash_place", parent_id: "cash", balance: 50 },
  { id: "bd", name: "Default", type: "bank_place", parent_id: "bank", balance: 500, is_favorite: true },
  { id: "rev", name: "Revolut", type: "revolut", balance: 160, total_balance: 160, unallocated_balance: 0, allocated_balance: 160, place_count: 2, favorite_place_id: "rd", favorite_place_balance: 100, favorite_place_name: "Default" },
  { id: "rd", name: "Default", type: "revolut_space", parent_id: "rev", balance: 100, is_favorite: true },
  { id: "pot", name: "Pot", type: "revolut_space", parent_id: "rev", balance: 60, is_locked: true },
];
const by = (id) => accounts.find((a) => a.id === id);

describe("what can be spent", () => {
  test("a main account stands for its favourite place", () => {
    expect(spendable(by("cash"))).toBe(200);
    expect(spendable(by("rev"))).toBe(100);
  });
  test("a place can spend its own balance; a main account without places, what it holds", () => {
    expect(spendable(by("wallet"))).toBe(150);
    expect(spendable({ id: "x", type: "bank", balance: 90, place_count: 0 })).toBe(90);
  });
  test("places and main accounts with places are held to their balance", () => {
    expect(isLimited(by("wallet"))).toBe(true);
    expect(isLimited(by("cash"))).toBe(true);
    expect(isLimited({ id: "c2", type: "cash", balance: 5, place_count: 0 })).toBe(false);
  });
});

describe("the account pickers", () => {
  test("list each main account's places as Main › Place, the favourite first, and say what is available", () => {
    const rows = orderAccounts(accounts);
    expect(rows.map((r) => r.id)).toEqual(["cd", "wallet", "jar", "bd", "rd", "pot"]);
    expect(rows.find((r) => r.id === "wallet").label).toBe("Money in hand › Wallet");
    expect(rows.find((r) => r.id === "cd").label).toBe("Money in hand › Default");
    expect(rows.find((r) => r.id === "bd").available).toBe(500);
  });
  test("a main account without places is still listed, and a place whose main is missing too", () => {
    expect(orderAccounts([{ id: "m", name: "Plain", type: "bank", balance: 3, place_count: 0 }]).map((r) => r.id)).toEqual(["m"]);
    expect(orderAccounts([{ id: "x", name: "Orphan", parent_id: "gone", balance: 3 }]).map((r) => r.id)).toEqual(["x"]);
  });
});

describe("the account a new expense starts on", () => {
  test("is the favourite account's favourite place", () => {
    expect(defaultSpendAccount(accounts).id).toBe("cd");
  });
  test("follows the star when it moves to another place or account", () => {
    const moved = accounts.map((a) => (a.id === "cash" ? { ...a, favorite_place_id: "wallet" } : a));
    expect(defaultSpendAccount(moved).id).toBe("wallet");
    const other = accounts.map((a) => (a.id === "cash" ? { ...a, is_favorite: false } : a.id === "rev" ? { ...a, is_favorite: true } : a));
    expect(defaultSpendAccount(other).id).toBe("rd");
  });
  test("is not a locked place even when it is the favourite", () => {
    const locked = accounts.map((a) => (a.id === "cd" ? { ...a, is_locked: true } : a));
    expect(defaultSpendAccount(locked).id).not.toBe("cd");
  });
  test("falls back to the first account when nothing is starred, and to null when there are none", () => {
    expect(defaultSpendAccount([{ id: "a", name: "A", type: "bank", balance: 0 }]).id).toBe("a");
    expect(defaultSpendAccount([])).toBeNull();
  });
});

describe("warning before spending too much", () => {
  test("says how much is available in the place", () => {
    expect(checkSpend(by("jar"), "60")).toContain("more than the €50.00 available in Jar");
  });
  test("names the favourite place for a main account", () => {
    expect(checkSpend(by("rev"), "101")).toContain("€100.00 available in Revolut › Default");
  });
  test("a transfer is held to the balance of any account, a plain one included", () => {
    const plain = { id: "p", name: "Plain", type: "bank", balance: 500, place_count: 0 };
    expect(checkSpend(plain, "501", { everyAccount: true })).toContain("more than the €500.00 available in Plain");
    expect(checkSpend(plain, "500", { everyAccount: true })).toBe("");
  });
  test("allows exactly what is available, and anything on plain accounts", () => {
    expect(checkSpend(by("jar"), "50")).toBe("");
    expect(checkSpend({ id: "p", type: "bank", balance: 5, place_count: 0 }, "9999")).toBe("");
    expect(checkSpend(by("jar"), "")).toBe("");
  });
});
