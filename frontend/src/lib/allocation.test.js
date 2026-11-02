import { planAllocation, NEW_MONEY_LABEL, spendable, isLimited, orderAccounts, defaultSpendAccount, checkSpend } from "./allocation";

// The shared axios client is not needed (and its ES-module build does not load under Jest): only the euro formatter is used.
jest.mock("axios", () => ({
  __esModule: true,
  default: { create: () => ({ interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } }), post: jest.fn() },
}));

// Money in hand: €200 in total, €50 of it in a Wallet, €150 not assigned.
const host = { id: "cash", name: "Money in hand", total_balance: 200, unallocated_balance: 150, allocated_balance: 50, balance: 200 };
const wallet = { id: "w", name: "Wallet", parent_id: "cash", balance: 50 };

describe("a new place", () => {
  test("takes its money from what is not assigned, and says the total stays", () => {
    const p = planAllocation({ host, amount: "30", newMoney: false });
    expect(p.error).toBe(false);
    expect(p.showNewMoney).toBe(true);
    expect(p.text).toContain("€30.00 moves out of Money in hand's unassigned €150.00");
    expect(p.text).toContain("leaving €120.00");
    expect(p.text).toContain("The total stays €200.00");
  });

  test("more than is available is refused, with the amount that is available", () => {
    const p = planAllocation({ host, amount: "160", newMoney: false });
    expect(p.error).toBe(true);
    expect(p.text).toContain("exceeds the available balance of €150.00");
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
    const h = { ...host, total_balance: 100.1, unallocated_balance: 100.1, allocated_balance: 0 };
    expect(planAllocation({ host: h, amount: "100.10", newMoney: false }).error).toBe(false);
    expect(planAllocation({ host: h, amount: "100.11", newMoney: false }).error).toBe(true);
  });
});

describe("editing a place", () => {
  test("a higher balance is taken from what is not assigned", () => {
    const p = planAllocation({ account: wallet, host, amount: "80", newMoney: false });
    expect(p.text).toContain("€30.00 moves out");
  });

  test("a higher balance than is available is refused", () => {
    expect(planAllocation({ account: wallet, host, amount: "201", newMoney: false }).error).toBe(true);
    expect(planAllocation({ account: wallet, host, amount: "200", newMoney: false }).error).toBe(false);
  });

  test("a lower balance gives the difference back", () => {
    const p = planAllocation({ account: wallet, host, amount: "20", newMoney: true });
    expect(p.text).toContain("€30.00 goes back to Money in hand's unassigned money");
    expect(p.showNewMoney).toBe(false);
  });

  test("an unchanged balance says nothing", () => {
    expect(planAllocation({ account: wallet, host, amount: "50", newMoney: false }).text).toBe("");
  });
});

describe("editing a main account", () => {
  test("the figure is the total and cannot go below what is in the places", () => {
    expect(planAllocation({ account: host, amount: "40", newMoney: false })).toMatchObject({ error: true });
    expect(planAllocation({ account: host, amount: "40", newMoney: false }).text).toContain("€50.00");
  });

  test("a higher total grows the part that is not assigned", () => {
    const p = planAllocation({ account: host, amount: "300", newMoney: false });
    expect(p.error).toBe(false);
    expect(p.text).toContain("becomes €250.00");
  });

  test("a main account without places has nothing to explain", () => {
    const lone = { id: "b", name: "Bank", balance: 90, total_balance: 90, unallocated_balance: 90, allocated_balance: 0 };
    expect(planAllocation({ account: lone, amount: "10", newMoney: false }).text).toBe("");
  });
});


// Money in hand holds nothing of its own: €200 is all in two places. Revolut keeps €40 unassigned next to a €60 pot.
const accounts = [
  { id: "cash", name: "Money in hand", type: "cash", balance: 200, total_balance: 200, unallocated_balance: 0, allocated_balance: 200, place_count: 2 },
  { id: "bank", name: "Bank", type: "bank", balance: 500 },
  { id: "wallet", name: "Wallet", type: "cash_place", parent_id: "cash", balance: 150 },
  { id: "jar", name: "Jar", type: "cash_place", parent_id: "cash", balance: 50 },
  { id: "safe", name: "Safe", type: "cash_place", parent_id: "cash", balance: 900, is_locked: true },
  { id: "rev", name: "Revolut", type: "revolut", balance: 100, total_balance: 100, unallocated_balance: 40, allocated_balance: 60, place_count: 1 },
  { id: "pot", name: "Pot", type: "revolut_space", parent_id: "rev", balance: 60, is_locked: true },
];
const by = (id) => accounts.find((a) => a.id === id);

describe("what can be spent", () => {
  test("a main account with places can spend only what no place holds", () => {
    expect(spendable(by("cash"))).toBe(0);
    expect(spendable(by("rev"))).toBe(40);
  });
  test("a place and a plain account can spend their own balance", () => {
    expect(spendable(by("wallet"))).toBe(150);
    expect(spendable(by("bank"))).toBe(500);
  });
  test("only places and main accounts with places are held to their balance", () => {
    expect(isLimited(by("wallet"))).toBe(true);
    expect(isLimited(by("cash"))).toBe(true);
    expect(isLimited(by("bank"))).toBe(false);
  });
  test("a main account that has no places yet is not limited", () => {
    expect(isLimited({ id: "c2", type: "cash", balance: 5, place_count: 0 })).toBe(false);
  });
});

describe("the account pickers", () => {
  test("list each main account followed by its places, and say what is available", () => {
    const rows = orderAccounts(accounts);
    expect(rows.map((r) => r.id)).toEqual(["cash", "wallet", "jar", "safe", "bank", "rev", "pot"]);
    expect(rows.find((r) => r.id === "wallet").label).toBe("Money in hand › Wallet");
    expect(rows.find((r) => r.id === "cash").available).toBe(0);
    expect(rows.find((r) => r.id === "bank").available).toBe(500);
  });
  test("a place whose main account is missing is still listed", () => {
    expect(orderAccounts([{ id: "x", name: "Orphan", parent_id: "gone", balance: 3 }]).map((r) => r.id)).toEqual(["x"]);
  });
});

describe("the account a new expense starts on", () => {
  test("is not a main account with nothing unassigned: it takes the unlocked place with most money", () => {
    expect(defaultSpendAccount(accounts).id).toBe("wallet");
  });
  test("is Money in hand itself when it has money of its own", () => {
    const own = accounts.map((a) => (a.id === "cash" ? { ...a, unallocated_balance: 30, balance: 230 } : a));
    expect(defaultSpendAccount(own).id).toBe("cash");
  });
  test("never starts on a locked place", () => {
    expect(defaultSpendAccount(accounts).id).not.toBe("safe");
  });
  test("falls back to the first account when nothing has money", () => {
    expect(defaultSpendAccount([{ id: "a", name: "A", type: "bank", balance: 0 }]).id).toBe("a");
    expect(defaultSpendAccount([])).toBeNull();
  });
});

describe("warning before spending too much", () => {
  test("says how much is available in the place", () => {
    expect(checkSpend(by("jar"), "60")).toContain("more than the €50.00 available in Jar");
  });
  test("names the unassigned part for a main account", () => {
    expect(checkSpend(by("rev"), "41")).toContain("€40.00 available in Revolut that isn't in a place");
  });
  test("a transfer is held to the balance of any account, a bank account included", () => {
    expect(checkSpend(by("bank"), "501", { everyAccount: true })).toContain("more than the €500.00 available in Bank");
    expect(checkSpend(by("bank"), "500", { everyAccount: true })).toBe("");
  });
  test("allows exactly what is available, and anything on plain accounts", () => {
    expect(checkSpend(by("jar"), "50")).toBe("");
    expect(checkSpend(by("bank"), "9999")).toBe("");
    expect(checkSpend(by("jar"), "")).toBe("");
  });
});
