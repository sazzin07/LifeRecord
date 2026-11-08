import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { readCache, writeCache } from "@/lib/swrCache";

/** The Today page arrangement, saved on the server (GET/PUT/DELETE /layouts/groceries) so every browser and the assistant see the same one.
 *  The last-seen copy shows at once; changes are written after a short pause so dragging or resizing does not send a request per step. */
export const WIDGET_IDS = ["needs", "kitchen", "list", "low", "risk", "cook", "week"];
export const DEFAULT_LAYOUT = {
  widgets: [{ id: "needs", size: "m" }, { id: "kitchen", size: "m" }, { id: "list", size: "m" }, { id: "cook", size: "m" }, { id: "low", size: "s" }, { id: "risk", size: "s" }, { id: "week", size: "s" }],
  focus: "all",
};
const KEY = "groceries-layout";

export function useGroceriesLayout() {
  const { user } = useAuth();
  const uid = user?.id;
  const [layout, setLayout] = useState(() => readCache(uid, KEY) || DEFAULT_LAYOUT);
  const [ready, setReady] = useState(() => !!readCache(uid, KEY));
  const [failed, setFailed] = useState(false);
  const timer = useRef(null);
  const waiting = useRef(null);   // a change not yet sent

  const send = useCallback(async (next) => {
    waiting.current = null;
    try {
      await api.put("/layouts/groceries", next);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not save your layout", { id: "groceries-layout" });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    api.get("/layouts/groceries")
      .then(({ data }) => { if (!alive || waiting.current) return; setLayout(data.layout); writeCache(uid, KEY, data.layout); setReady(true); })
      .catch(() => { if (alive) { setFailed(true); setReady(true); } });
    return () => { alive = false; };
  }, [uid]);

  // Leaving the page must not lose a change made in the last moment.
  useEffect(() => () => { clearTimeout(timer.current); if (waiting.current) send(waiting.current); }, [send]);

  const save = useCallback((next) => {
    setLayout(next);
    writeCache(uid, KEY, next);
    waiting.current = next;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => send(next), 400);
  }, [uid, send]);

  const reset = useCallback(async () => {
    clearTimeout(timer.current);
    waiting.current = null;
    setLayout(DEFAULT_LAYOUT);
    writeCache(uid, KEY, DEFAULT_LAYOUT);
    try {
      const { data } = await api.delete("/layouts/groceries");
      setLayout(data.layout);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Could not restore the default layout", { id: "groceries-layout" });
    }
  }, [uid]);

  return { layout, ready, failed, save, reset };
}
