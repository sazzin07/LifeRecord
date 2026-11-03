import { api, API, getAccessToken } from "@/lib/api";

const newRequestId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/**
 * Send one message to the assistant and report events as they arrive:
 *   { type: "session" | "delta" | "tool" | "done" | "error", ... }
 * Uses the streaming endpoint. If the stream cannot be opened (an old server, a proxy that buffers) it falls back
 * to the plain endpoint and delivers the whole reply as one delta, so the caller handles one shape either way.
 */
export async function streamChat({ message, sessionId, image, page, signal, onEvent }) {
  // One id for this send: whatever retries it (a refreshed token, the plain endpoint after a dropped stream) carries the SAME id, so the
  // server applies a change such as "Ferreira owes me 10" once however many times the request arrives.
  const requestId = newRequestId();
  const body = JSON.stringify({ message, session_id: sessionId, image_base64: image || null, page, client_request_id: requestId });
  const open = () => fetch(`${API}/ai/chat/stream`, {
    method: "POST", signal, body,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getAccessToken() || ""}` },
  });

  let res;
  try {
    res = await open();
    if (res.status === 401) {
      // The shared axios client knows how to refresh an expired token; any authenticated call triggers it.
      await api.get("/auth/me");
      res = await open();
    }
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    return fallback({ message, sessionId, image, page, signal, onEvent, requestId });
  }

  if (!res.ok || !res.body) {
    if (res.status >= 500 || res.status === 404 || !res.body) return fallback({ message, sessionId, image, page, signal, onEvent, requestId });
    const detail = await res.json().catch(() => ({}));
    onEvent({ type: "error", message: detail.detail || "The assistant could not answer. Please try again." });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      let ev;
      try { ev = JSON.parse(line.slice(6)); } catch { continue; }
      if (ev.type === "done" || ev.type === "error") finished = true;
      onEvent(ev);
    }
  }
  if (!finished) onEvent({ type: "error", message: "The connection dropped before the answer finished. Please try again." });
}

async function fallback({ message, sessionId, image, page, signal, onEvent, requestId }) {
  try {
    const { data } = await api.post("/ai/chat", { message, session_id: sessionId, image_base64: image || null, page, client_request_id: requestId }, { signal });
    onEvent({ type: "delta", text: data.reply || "" });
    onEvent({ type: "done", reply: data.reply || "", session_id: data.session_id, actions: data.actions || [], changed: !!data.changed });
  } catch (e) {
    if (e?.name === "CanceledError" || e?.code === "ERR_CANCELED") throw Object.assign(new Error("aborted"), { name: "AbortError" });
    onEvent({ type: "error", message: e?.response?.data?.detail || "The assistant could not answer. Please try again." });
  }
}
