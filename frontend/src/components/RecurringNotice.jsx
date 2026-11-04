import { useEffect } from "react";
import { toast } from "sonner";
import { api, eur } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { useAuth } from "@/context/AuthContext";

const when = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("default", { day: "numeric", month: "short" });

/** Says, once, what the recurring items recorded by themselves since the person last looked. A single one can be undone from the notice. */
export function RecurringNotice() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) return undefined;
    let off = false;
    const check = async () => {
      try {
        const { data } = await api.get("/recurring/notices");
        if (off || !data.length) return;
        await api.post("/recurring/notices/seen");
        data.forEach((n) => {
          const text = n.count === 1
            ? `${n.title} (${eur(n.total)}) was ${n.kind === "income" ? "added" : "recorded"} for ${when(n.last_date)}.`
            : `${n.title}: ${n.count} were ${n.kind === "income" ? "added" : "recorded"}, ${eur(n.total)} in all.`;
          toast.info(text, {
            duration: 12000,
            action: n.count === 1 ? { label: "Undo", onClick: async () => { try { await api.delete(`/transactions/${n.transaction_ids[0]}`); toast.success("Removed"); refreshAll(); } catch { toast.error("Could not undo this"); } } } : undefined,
          });
        });
        refreshAll();
      } catch { /* a notice is a courtesy: never an error on screen */ }
    };
    const t = setTimeout(check, 1500);
    const visible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", visible);
    return () => { off = true; clearTimeout(t); document.removeEventListener("visibilitychange", visible); };
  }, [user?.id]);
  return null;
}
