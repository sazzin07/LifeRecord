import { toast } from "sonner";
import { api } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";

const fail = (err, fallback) => toast.error(err.response?.data?.detail || fallback);

/** Quick +/- step that suits the unit: bulk units move in bigger jumps. */
export function stepFor(unit) {
  if (unit === "g" || unit === "ml") return 100;
  if (unit === "kg" || unit === "L") return 0.5;
  return 1;
}

/** dir -1 uses up one step (consume endpoint, so it can never go negative); +1 adds one step. */
export async function adjustQuantity(g, dir) {
  const step = stepFor(g.unit);
  const qty = Number(g.quantity);
  try {
    if (dir < 0) await api.post(`/groceries/${g.id}/consume`, { quantity: Math.min(step, qty) });
    else await api.put(`/groceries/${g.id}`, { quantity: Math.round((qty + step) * 100) / 100 });
    refreshAll();
  } catch (err) { fail(err, "Could not update quantity"); }
}

export async function moveItems(ids, to) {
  try {
    await Promise.all(ids.map((id) => api.post(`/groceries/${id}/move`, { storage_location: to })));
    toast.success(`Moved ${ids.length} item${ids.length !== 1 ? "s" : ""} to ${to}`);
    refreshAll();
    return true;
  } catch (err) { fail(err, "Could not move items"); return false; }
}

export async function discardItems(ids) {
  try {
    await Promise.all(ids.map((id) => api.post(`/groceries/${id}/discard`, {})));
    toast.success(`Discarded ${ids.length} item${ids.length !== 1 ? "s" : ""}`);
    refreshAll();
    return true;
  } catch (err) { fail(err, "Could not discard"); return false; }
}
