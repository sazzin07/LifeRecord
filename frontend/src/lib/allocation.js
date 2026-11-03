import { eur } from "./api";

const cents = (n) => Math.round(Number(n || 0) * 100);

export const NEW_MONEY_LABEL = "Add this amount as new money to the main account";

/**
 * What saving the place dialog would do to the money, said in plain words before it happens. The server decides (and refuses
 * what does not add up); this only lets the person see it first.
 *
 * Every main account has a favourite place (starred, "Default" to begin with). Money set aside for a new place comes out of it,
 * and a new total for the main account lands in it.
 *
 *  - `account`: the place being edited, or null when creating one.
 *  - `host`: the main account the place belongs to (for a new place, the one it goes under).
 *  - `amount`: what the person typed; `newMoney`: the checkbox.
 * Returns { text, error, showNewMoney }: the sentence to show, whether it is a refusal, and whether the checkbox applies.
 */
export function planAllocation({ account, host, amount, newMoney }) {
  const typed = cents(amount);
  const nothing = { text: "", error: false, showNewMoney: false };

  // A main account: the figure is its total, places included; the difference goes into (or out of) its favourite place.
  if (account && !account.parent_id) {
    const total = cents(account.total_balance ?? account.balance);
    const favourite = account.favorite_place_name;
    if (!favourite || typed === total) return nothing;
    const delta = typed - total;
    if (delta > 0) {
      return { text: `${eur(delta / 100)} is added to ${favourite}, your favorite place. The total goes from ${eur(total / 100)} to ${eur(typed / 100)}.`, error: false, showNewMoney: false };
    }
    const held = cents(account.favorite_place_balance);
    if (-delta > held) {
      return { text: `This amount (${eur(-delta / 100)}) exceeds the available balance of ${eur(Math.max(held, 0) / 100)} in ${favourite}.`, error: true, showNewMoney: false };
    }
    return { text: `${eur(-delta / 100)} is taken out of ${favourite}. The total goes from ${eur(total / 100)} to ${eur(typed / 100)}.`, error: false, showNewMoney: false };
  }

  if (!host) return nothing;
  const total = cents(host.total_balance ?? host.balance);
  const delta = typed - (account ? cents(account.balance) : 0);

  // The favourite place is the day-to-day account: setting its balance is a deposit or a withdrawal.
  if (account && account.is_favorite) {
    if (delta === 0) return nothing;
    return {
      text: delta > 0
        ? `${eur(delta / 100)} is added to ${account.name}, your favorite place. ${host.name}'s total goes from ${eur(total / 100)} to ${eur((total + delta) / 100)}.`
        : `${eur(-delta / 100)} is taken out of ${account.name}, your favorite place. ${host.name}'s total goes from ${eur(total / 100)} to ${eur((total + delta) / 100)}.`,
      error: false, showNewMoney: false,
    };
  }

  const favourite = host.favorite_place_name || "its favorite place";
  const available = cents(host.favorite_place_balance ?? host.unallocated_balance ?? 0);
  const source = `${host.name} › ${favourite}`;
  if (delta < 0) {
    return { text: `${eur(-delta / 100)} goes back to ${source}. The total stays ${eur(total / 100)}.`, error: false, showNewMoney: false };
  }
  if (delta === 0) return { text: "", error: false, showNewMoney: true };

  if (newMoney) {
    return {
      text: `This is extra money. ${host.name}'s total goes from ${eur(total / 100)} to ${eur((total + delta) / 100)}.`,
      error: false, showNewMoney: true,
    };
  }
  if (delta > available) {
    return {
      text: `This amount (${eur(delta / 100)}) exceeds the available balance of ${eur(Math.max(available, 0) / 100)} in ${source}. Lower the amount, or tick "${NEW_MONEY_LABEL}" if it is extra money.`,
      error: true, showNewMoney: true,
    };
  }
  return {
    text: `This is money you already have: ${eur(delta / 100)} moves out of ${source}, leaving ${eur((available - delta) / 100)}. The total stays ${eur(total / 100)}.`,
    error: false, showNewMoney: true,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Choosing an account to take money from. A place cannot go below zero (the server refuses it), so the pickers say what is
// really there to use instead of letting the first try fail. A main account stands for its favourite place.
// ---------------------------------------------------------------------------------------------------------------------

/** What can be taken out of an account right now: a place its own balance; a main account with places its favourite place's. */
export const spendable = (a) => (a.parent_id ? a.balance : ((a.place_count || 0) > 0 ? (a.favorite_place_balance ?? 0) : (a.unallocated_balance ?? a.balance))) || 0;

/** Whether the server holds this account to its balance. */
export const isLimited = (a) => !!a.parent_id || (a.place_count || 0) > 0;

/** Accounts in the order a person thinks of them: each main account's places, "Main › Place", starred first. A main account that
 *  has places is not listed itself: money entered against it would go to its favourite place anyway, so the place is named. */
export function orderAccounts(accounts) {
  const byId = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const mains = accounts.filter((a) => !a.parent_id || !byId[a.parent_id]);
  const placesOf = (id) => accounts.filter((a) => a.parent_id === id);
  const row = (a) => ({ ...a, label: a.parent_id && byId[a.parent_id] ? `${byId[a.parent_id].name} › ${a.name}` : a.name, available: spendable(a) });
  return mains.flatMap((m) => {
    const places = placesOf(m.id).sort((x, y) => Number(!!y.is_favorite) - Number(!!x.is_favorite));
    return (m.parent_id || (m.place_count || 0) === 0 ? [row(m)] : []).concat(places.map(row));
  });
}

/** The account a new expense should start on: the favourite account's favourite place, else a place with money to spend. */
export function defaultSpendAccount(accounts) {
  if (!accounts.length) return null;
  const byId = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const main = accounts.find((a) => !a.parent_id && a.is_favorite);
  const favourite = main ? byId[main.favorite_place_id] : null;
  if (favourite && !favourite.is_locked) return favourite;
  const open = accounts.filter((a) => !a.is_locked && spendable(a) > 0 && ((a.place_count || 0) === 0));
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
  const where = !account.parent_id && (account.place_count || 0) > 0 ? `${account.name} › ${account.favorite_place_name || "its favorite place"}` : account.name;
  return `${eur(amount)} is more than the ${eur(have)} available in ${where}.`;
}
