import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { refreshAll } from "@/lib/useFetch";
import { streamChat } from "@/lib/aiStream";
import { toolProgress } from "@/lib/aiFormat";
import { conversationsChanged } from "@/components/ai/useConversations";

const SESSION_KEY = "lm_ai_session";
const newSession = () => crypto.randomUUID();
const readSession = () => { try { return localStorage.getItem(SESSION_KEY) || newSession(); } catch { return newSession(); } };
const uid = () => Math.random().toString(36).slice(2, 10);
const DEFAULT_TITLE = "New chat";

const fromServer = (m, conversationId) => ({
  id: m.id, role: m.role === "assistant" ? "assistant" : "user", text: m.text, status: "done",
  actions: m.meta?.actions, changed: !!m.meta?.changed,
  image: m.meta?.image ? `/ai/conversations/${conversationId}/images/${m.id}` : null,
});

/**
 * Conversation state for the assistant: streaming replies, stop, retry, saved chats and a draft that survives a reload.
 * A conversation is saved by the server as soon as a reply finishes; `saveState` tells the user where that stands.
 * Messages: { id, role: "user" | "assistant", text, status: "done" | "streaming" | "error" | "stopped",
 *             image?, actions?, tool?, error?, askedFor? }
 */
export function useAssistant(page) {
  const [sessionId, setSessionId] = useState(readSession);
  const [msgs, setMsgs] = useState([]);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [busy, setBusy] = useState(false);
  const [loadState, setLoadState] = useState("idle"); // idle | loading | ready | failed
  const controller = useRef(null);
  const pending = useRef({ id: null, text: "", raf: 0 });
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;
  const titled = useRef(new Set());

  useEffect(() => { try { localStorage.setItem(SESSION_KEY, sessionId); } catch { /* storage blocked */ } }, [sessionId]);

  const patch = useCallback((id, change) => {
    setMsgs((all) => all.map((m) => (m.id === id ? { ...m, ...(typeof change === "function" ? change(m) : change) } : m)));
  }, []);

  // Open a saved chat (or the last one when the panel first opens). A chat that does not exist yet is simply empty.
  const openConversation = useCallback(async (id) => {
    if (controller.current) return false;
    setLoadState("loading");
    try {
      const { data } = await api.get(`/ai/conversations/${id}`);
      setSessionId(id);
      setTitle(data.title);
      setMsgs(data.messages.map((m) => fromServer(m, id)));
      titled.current.add(id);
      setLoadState("ready");
      return true;
    } catch (e) {
      if (e?.response?.status === 404) { setLoadState("ready"); return false; }
      setLoadState("failed");
      return false;
    }
  }, []);

  const loadCurrent = useCallback(() => (loadState === "idle" ? openConversation(sessionId) : null), [loadState, openConversation, sessionId]);

  // Name an untitled chat after its first exchange (the server uses the model; the first words are the fallback).
  const nameIt = useCallback(async (id) => {
    if (titled.current.has(id)) return;
    titled.current.add(id);
    try {
      const { data } = await api.post(`/ai/conversations/${id}/title`);
      setTitle((t) => (sessionIdRef.current === id ? data.title : t));
    } catch { /* the first-words title stays */ }
    conversationsChanged();
  }, []);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // Streaming deltas arrive many times a second; apply them once per frame.
  const flush = useCallback(() => {
    const p = pending.current;
    p.raf = 0;
    if (!p.id || !p.text) return;
    const chunk = p.text;
    p.text = "";
    patch(p.id, (m) => ({ text: m.text + chunk, tool: null }));
  }, [patch]);

  const run = useCallback(async ({ message, image, userId, replyId }) => {
    const ctl = new AbortController();
    controller.current = ctl;
    pending.current = { id: replyId, text: "", raf: 0 };
    setBusy(true);
    let failed = null;
    let savedAs = null;
    try {
      await streamChat({
        message, image, page, sessionId, signal: ctl.signal,
        onEvent: (ev) => {
          if (ev.type === "session") savedAs = ev.session_id;
          else if (ev.type === "delta") {
            pending.current.text += ev.text;
            if (!pending.current.raf) pending.current.raf = requestAnimationFrame(flush);
          } else if (ev.type === "tool") {
            patch(replyId, { tool: ev.status === "running" ? toolProgress(ev.name) : null });
          } else if (ev.type === "done") {
            if (pending.current.raf) cancelAnimationFrame(pending.current.raf);
            const rest = pending.current.text;
            pending.current.text = "";
            patch(replyId, (m) => ({
              text: ev.reply || m.text + rest, status: "done", tool: null, actions: ev.actions || [],
              changed: !!ev.changed, error: ev.error || null,
            }));
            savedAs = ev.session_id || savedAs;
            if (ev.changed) refreshAll();
          } else if (ev.type === "error") {
            failed = ev.message;
          }
        },
      });
    } catch (e) {
      if (e?.name !== "AbortError") failed = "The assistant could not answer. Please try again.";
    } finally {
      if (pending.current.raf) cancelAnimationFrame(pending.current.raf);
      const rest = pending.current.text;
      pending.current = { id: null, text: "", raf: 0 };
      const stopped = ctl.signal.aborted;
      patch(replyId, (m) => {
        if (m.status === "done") return {};
        if (stopped) return { text: m.text + rest, status: "stopped", tool: null };
        return { text: m.text + rest, status: "error", tool: null, error: failed || "The assistant could not answer. Please try again.", askedFor: userId };
      });
      if (controller.current === ctl) controller.current = null;
      setBusy(false);
      if (!failed && !stopped && savedAs) {
        if (savedAs !== sessionIdRef.current) setSessionId(savedAs);
        conversationsChanged();
        nameIt(savedAs);
      }
    }
  }, [flush, nameIt, page, patch, sessionId]);

  const send = useCallback((text, image) => {
    const message = (text || "").trim();
    if ((!message && !image) || controller.current) return false;
    const userId = uid();
    const replyId = uid();
    setMsgs((all) => [...all,
      { id: userId, role: "user", text: message || "(image)", image: image || null, status: "done" },
      { id: replyId, role: "assistant", text: "", status: "streaming" }]);
    run({ message, image, userId, replyId });
    return true;
  }, [run]);

  const retry = useCallback((replyId) => {
    if (controller.current) return;
    const all = msgsRef.current;
    const at = all.findIndex((m) => m.id === replyId);
    const asked = all[at - 1];
    if (!asked || asked.role !== "user") return;
    patch(replyId, { text: "", status: "streaming", error: null, tool: null, actions: undefined });
    run({ message: asked.text === "(image)" ? "" : asked.text, image: asked.image, userId: asked.id, replyId });
  }, [patch, run]);

  const stop = useCallback(() => controller.current?.abort(), []);

  const reset = useCallback(() => {
    if (controller.current) return false;
    setMsgs([]);
    setTitle(DEFAULT_TITLE);
    setSessionId(newSession());
    setLoadState("ready");
    return true;
  }, []);

  useEffect(() => () => controller.current?.abort(), []);

  // Where the current conversation stands on the server: saving while a reply is in flight, failed if the last one did not go through.
  const last = msgs[msgs.length - 1];
  const saveState = !msgs.length ? "idle" : busy ? "saving" : last?.status === "error" ? "failed" : "saved";

  return { msgs, busy, sessionId, title, setTitle, loadState, loadCurrent, openConversation, send, retry, stop, reset, saveState };
}
