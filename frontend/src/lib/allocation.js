import { eur } from "./api";

const cents = (n) => Math.round(Number(n || 0) * 100);

export const NEW_MONEY_LABEL = "Add this amount as new money to the main account";

/**
 * What saving the place dialog would do to the money, said in plain words before it happens. The server decides (and refuses
 * what does not add up); this only lets the person see it first.
 *
 *  - `account`: the place being edited, or null when creating one.
 *  - `parent`: the main account a new place goes under (an edited place's main account is `host`).
 *  - `amount`: what the person typed; `newMoney`: the checkbox.
 * Returns { text, error, showNewMoney }: the sentence to show, whether it is a refusal, and whether the checkbox applies.
 */
export function planAllocation({ account, host, amount, newMoney }) {
  const typed = cents(amount);

  // A main account: the figure is its total, sub-accounts included.
  if (account && !account.parent_id) {
    const allocated = cents(account.allocated_balance);
    const total = cents(account.total_balance ?? account.balance);
    if (allocated === 0 && cents(account.unallocated_balance ?? account.balance) === total) {
      return { text: "", error: false, showNewMoney: false };
    }
    if (typed < allocated) {
      return { text: `The total can't be below ${eur(allocated / 100)}: that much is already assigned to sub-accounts.`, error: true, showNewMoney: false };
    }
    if (typed === total) return { text: `${eur(allocated / 100)} of it is in sub-accounts; the rest is not assigned.`, error: false, showNewMoney: false };
    return {
      text: `The total changes from ${eur(total / 100)} to ${eur(typed / 100)}. ${eur(allocated / 100)} stays in sub-accounts; the part that is not assigned becomes ${eur((typed - allocated) / 100)}.`,
      error: false, showNewMoney: false,
    };
  }

  if (!host) return { text: "", error: false, showNewMoney: false };
  const total = cents(host.total_balance ?? host.balance);
  const unallocated = cents(host.unallocated_balance ?? host.balance);
  const delta = typed - (account ? cents(account.balance) : 0);

  if (delta < 0) {
    return {
      text: `${eur(-delta / 100)} goes back to ${host.name}'s unassigned money. The total stays ${eur(total / 100)}.`,
      error: false, showNewMoney: false,
    };
  }
  if (delta === 0) return { text: "", error: false, showNewMoney: true };

  if (newMoney) {
    return {
      text: `This is extra money. ${host.name}'s total goes from ${eur(total / 100)} to ${eur((total + delta) / 100)}.${unallocated > 0 ? ` The ${eur(unallocated / 100)} not assigned yet stays as it is.` : ""}`,
      error: false, showNewMoney: true,
    };
  }
  if (delta > unallocated) {
    return {
      text: `This amount (${eur(delta / 100)}) exceeds the available balance of ${eur(Math.max(unallocated, 0) / 100)} in ${host.name}. Lower the amount, or tick "${NEW_MONEY_LABEL}" if it is extra money.`,
      error: true, showNewMoney: true,
    };
  }
  return {
    text: `This is money you already have: ${eur(delta / 100)} moves out of ${host.name}'s unassigned ${eur(unallocated / 100)}, leaving ${eur((unallocated - delta) / 100)}. The total stays ${eur(total / 100)}.`,
    error: false, showNewMoney: true,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Choosing an account to take money from. A place, and a main account that has places, cannot go below zero (the server
// refuses it), so the pickers say what is really there to use instead of letting the first try fail.
// ---------------------------------------------------------------------------------------------------------------------

/** What can be taken out of an account right now: for a main account with places, only the part no place holds. */
export const spendable = (a) => (a.parent_id ? a.balance : (a.unallocated_balance ?? a.balance)) || 0;

/** Whether the server holds this account to its balance. */
export const isLimited = (a) => !!a.parent_id || (a.place_count || 0) > 0;

/** Accounts in the order a person thinks of them: each main account, then its places. Adds `label` and `available`. */
export function orderAccounts(accounts) {
  const byId = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const mains = accounts.filter((a) => !a.parent_id || !byId[a.parent_id]);
  const placesOf = (id) => accounts.filter((a) => a.parent_id === id);
  const row = (a) => ({ ...a, label: a.parent_id && byId[a.parent_id] ? `${byId[a.parent_id].name} › ${a.name}` : a.name, available: spendable(a) });
  return mains.flatMap((m) => [row(m), ...placesOf(m.id).map(row)]);
}

/** The account a new expense should start on: never a locked place, and not a main account with nothing of its own to spend. */
export function defaultSpendAccount(accounts) {
  if (!accounts.length) return null;
  const open = accounts.filter((a) => !a.is_locked && spendable(a) > 0);
  const cash = open.find((a) => a.type === "cash");
  if (cash) return cash;
  const richestPlace = open.filter((a) => a.type === "cash_place").sort((a, b) => spendable(b) - spendable(a))[0];
  return richestPlace || open.sort((a, b) => spendable(b) - spendable(a))[0] || accounts[0];
}

/** A sentence when `amount` is more than the account can give, else "". The server still has the last word.
 *  Spending is held to the balance only for places and main accounts with places; a transfer, for every account. */
export function checkSpend(account, amount, { everyAccount = false } = {}) {
  if (!account || !(everyAccount || isLimited(account)) || !amount) return "";
  const have = spendable(account);
  if (cents(amount) <= cents(have)) return "";
  const where = !account.parent_id ? `${account.name} that isn't in a place` : account.name;
  return `${eur(amount)} is more than the ${eur(have)} available in ${where}.`;
}
