import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchQuery, peekQuery, subscribeQuery, writeQuery } from "@/lib/query";

export function refreshAll() {
  window.dispatchEvent(new CustomEvent("lm:refresh"));
}

/**
 * Fetch `path` with stale-while-revalidate: `data` starts as the last-seen copy (if any) and is replaced by
 * the fresh response. `loading` is true only while there is nothing to show yet, so pages can use it to
 * render a skeleton on a cold start and never flash an empty state for data that is merely on its way.
 */
export function useFetch(path, { auto = true } = {}) {
  const cached = useMemo(() => (path ? peekQuery(path) : null), [path]);
  const [entry, setEntry] = useState({ path, data: cached });
  const [pending, setPending] = useState(auto);
  const reqId = useRef(0);
  // After the path changes, show that path's cached copy (never the previous path's data).
  const data = entry.path === path ? entry.data : cached;

  const reload = useCallback(async ({ force = true } = {}) => {
    if (!path) return;
    const id = ++reqId.current;
    try {
      const fresh = await fetchQuery(path, { force });
      if (id === reqId.current) setEntry({ path, data: fresh });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("fetch failed", path, e?.message);
    } finally {
      if (id === reqId.current) setPending(false);
    }
  }, [path]);

  useEffect(() => {
    if (peekQuery(path) == null) setPending(true);
    if (auto) reload({ force: false });
    const h = () => reload({ force: true });
    window.addEventListener("lm:refresh", h);
    const unsubscribe = path ? subscribeQuery(path) : () => {};
    return () => { window.removeEventListener("lm:refresh", h); unsubscribe(); };
  }, [reload, auto, path]);

  const setData = useCallback((value) => {
    setEntry((prev) => {
      const base = prev.path === path ? prev.data : cached;
      const next = typeof value === "function" ? value(base) : value;
      writeQuery(path, next);
      return { path, data: next };
    });
  }, [path, cached]);

  return { data: data ?? null, loading: pending && data == null, reload, setData };
}
