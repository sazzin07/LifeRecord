import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useFetch } from "@/lib/useFetch";

/** Tell every list of saved chats to reload (after a message is saved, a title is generated, a chat is renamed...). */
export const conversationsChanged = () => window.dispatchEvent(new CustomEvent("lm:conversations"));

const GROUPS = ["Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"];

export function groupByRecency(items, now = new Date()) {
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = startOfDay(now);
  const day = 86400000;
  const buckets = new Map(GROUPS.map((g) => [g, []]));
  for (const c of items) {
    const age = (today - startOfDay(new Date(c.updated_at))) / day;
    buckets.get(age <= 0 ? "Today" : age <= 1 ? "Yesterday" : age <= 7 ? "Previous 7 days" : age <= 30 ? "Previous 30 days" : "Older").push(c);
  }
  return GROUPS.map((g) => ({ label: g, items: buckets.get(g) })).filter((g) => g.items.length);
}

/** Saved chats with server-side search, sort and the archived view. Shows the last-seen list while it refreshes. */
export function useConversations({ query = "", archived = false, sort = "recent" } = {}) {
  const [debounced, setDebounced] = useState(query);
  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 220); return () => clearTimeout(t); }, [query]);
  const path = useMemo(() => {
    const p = new URLSearchParams({ archived: String(archived), sort });
    if (debounced) p.set("q", debounced);
    return `/ai/conversations?${p}`;
  }, [debounced, archived, sort]);
  const { data, loading, reload, setData } = useFetch(path);

  useEffect(() => {
    const h = () => reload();
    window.addEventListener("lm:conversations", h);
    return () => window.removeEventListener("lm:conversations", h);
  }, [reload]);

  const patch = useCallback(async (id, change) => {
    const before = data;
    setData((list) => (list || []).map((c) => (c.id === id ? { ...c, ...change } : c)).filter((c) => c.archived === archived));
    try {
      const { data: saved } = await api.patch(`/ai/conversations/${id}`, change);
      conversationsChanged();
      return saved;
    } catch (e) {
      setData(before);
      throw e;
    }
  }, [data, setData, archived]);

  const remove = useCallback(async (id) => {
    const before = data;
    setData((list) => (list || []).filter((c) => c.id !== id));
    try {
      await api.delete(`/ai/conversations/${id}`);
      conversationsChanged();
    } catch (e) {
      setData(before);
      throw e;
    }
  }, [data, setData]);

  return { items: data, loading, searching: debounced !== query.trim(), reload, rename: (id, title) => patch(id, { title }), archive: (id, value = true) => patch(id, { archived: value }), remove };
}
