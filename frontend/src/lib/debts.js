import { api, errorMessage } from "@/lib/api";

// The two balances of a person. "they_owe": what they owe me. "i_owe": what I owe them. They are never netted.
export const THEY = "they_owe";
export const I = "i_owe";

export const DIRECTION_LABEL = { [THEY]: "They owe you", [I]: "You owe them" };

/** A fresh key for one attempt at a change. Sent with the request: if the answer is lost and the same attempt is repeated, the server
 *  recognises the key and answers with the first result instead of changing the balance twice. */
export const newKey = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Make a change to a person's debts. Resolves to the server's answer (it has the saved balances), or throws with words to show. */
export async function changeDebt(personId, operation, body, key) {
  const path = operation === "payment" ? `/debts/people/${personId}/payments` : `/debts/people/${personId}/adjust/${operation}`;
  const { data } = await api.post(path, body, { headers: { "Idempotency-Key": key } });
  return data;
}

/** Undo what an answer says it did: cancelling lines for debts, removing the payment for a payment. */
export async function undoChange(result) {
  if (result?.undo?.settlement_id) {
    await api.delete(`/settlements/${result.undo.settlement_id}`);
    return;
  }
  const ids = [...(result?.undo?.entry_ids || [])].reverse();
  for (const id of ids) await api.post(`/debts/entries/${id}/reverse`, null, { headers: { "Idempotency-Key": newKey() } });
}

export const originLabel = { manual: "Manual", ai: "Assistant", payment: "Payment", expense: "Expense" };

export const kindIcon = {
  add: "plus", reduce: "minus", correct: "pencil", excess: "plus", expense: "receipt", payment_in: "arrow-down", payment_out: "arrow-up",
};

export { errorMessage };
