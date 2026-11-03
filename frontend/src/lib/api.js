import axios from "axios";
import { noteServerTime, sessionKeyHeader, signProof } from "./sessionKey";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

// "cookie" mode: the server keeps the long-lived refresh token in an HttpOnly cookie that page scripts cannot read.
const AUTH_MODE = { "X-Auth-Mode": "cookie" };
export const api = axios.create({ baseURL: API, withCredentials: true, headers: AUTH_MODE });

// The short-lived access token lives in memory only: it is never written to web storage, so a script injected into the page
// cannot copy it out of storage, and a reload or a second tab gets a new one from the HttpOnly refresh cookie.
let accessToken = null;
export const getAccessToken = () => accessToken;
export const setAccessToken = (token) => { accessToken = token || null; };

// Older versions kept the tokens in localStorage; remove any left over so they cannot linger there.
try { localStorage.removeItem("lm_token"); localStorage.removeItem("lm_refresh_token"); } catch { /* storage unavailable */ }

api.interceptors.request.use(async (config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  // A request that can begin a session announces this browser's public key, so the session is bound to it (lib/sessionKey.js).
  if (String(config.url || "").startsWith("/auth/")) {
    const key = await sessionKeyHeader();
    if (key) config.headers["X-Session-Key"] = key;
  }
  return config;
});

let isRefreshing = false;
let refreshWaiters = [];  // requests that found their token expired while a refresh was already running

/** True only when the SERVER answered that the session is over (signed out, expired, ended, restarted). A network that dropped,
 *  a timeout or a server error says nothing about the session, and must never sign anyone out. */
export const sessionRefused = (err) => [401, 403].includes(err?.response?.status);

// A refresh whose answer never arrives has still used up the refresh token on the server. So each refresh carries a random key
// (X-Refresh-Key) and a repeat of the same request carries the SAME key: the server recognises it, and hands back the same new
// token instead of taking the old one for a stolen copy. The key is kept in this tab's sessionStorage until the server has
// answered, so a repeat after a reload carries it too. It is not a credential: it does nothing without the HttpOnly cookie.
const PENDING_KEY = "lm_rk";
const randomKey = () => {
  const bytes = new Uint8Array(16);
  const c = typeof window !== "undefined" ? window.crypto : null;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
  return Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
};
const pendingKey = {
  read: () => { try { return sessionStorage.getItem(PENDING_KEY); } catch { return null; } },
  write: (k) => { try { sessionStorage.setItem(PENDING_KEY, k); } catch { /* storage unavailable: a repeat in memory still works */ } },
  clear: () => { try { sessionStorage.removeItem(PENDING_KEY); } catch { /* nothing to clear */ } },
};

/** How often, and after how long, a refresh that got no answer is repeated before giving up for now. */
export const refreshPolicy = { retries: 2, delays: [800, 2500] };

/** Exchange the refresh cookie for a new access token, held in memory. Fails with a 401/403 when the session has ended on the
 *  server: signed out, expired, or the server restarted. Any other failure (no answer, a server error) is repeated with the
 *  same key and, if it still fails, thrown without meaning the session is over: see `sessionRefused`. */
export async function refreshSession() {
  const key = pendingKey.read() || randomKey();
  pendingKey.write(key);
  let clockCorrected = false;
  for (let attempt = 0; ; attempt += 1) {
    try {
      // A session bound to this browser's key needs a fresh signature on every refresh, so one is made for every attempt.
      const proof = await signProof();
      const headers = { ...AUTH_MODE, "X-Refresh-Key": key, ...(proof ? { "X-Session-Proof": proof } : {}) };
      const { data, headers: answered } = await axios.post(`${API}/auth/refresh`, {}, { withCredentials: true, headers });
      pendingKey.clear();
      if (answered?.date) noteServerTime(answered.date);
      setAccessToken(data.token);
      return data.token;
    } catch (err) {
      if (sessionRefused(err)) {
        // A computer whose clock is far off makes every proof look stale. If the server's date says so, learn the difference and
        // try once more, instead of taking it for a sign-out.
        const serverDate = err.response?.headers?.date;
        if (!clockCorrected && serverDate && Math.abs(Date.parse(serverDate) - Date.now()) > 60_000) {
          clockCorrected = true;
          noteServerTime(serverDate);
          attempt -= 1;
          continue;
        }
        pendingKey.clear();
        throw err;  // the server heard us and said no: nothing to repeat
      }
      if (!err.response) window.dispatchEvent(new CustomEvent("lm:offline"));
      if (attempt >= refreshPolicy.retries) throw err;             // keep the key: the next try repeats this request
      await new Promise((resolve) => setTimeout(resolve, refreshPolicy.delays[attempt] ?? 2500));
    }
  }
}

// A call that replaces this browser's session (changing the password ends every session and starts a new one for this tab). Requests that
// were already on their way carry the old token and fail with 401 while it happens; they must wait for it and use the new token, not
// try to refresh a session that has just been ended on purpose (which would sign this very tab out).
let sessionChange = null;
export function replacingSession(promise) {
  const mine = promise.then(() => {}, () => {}).then(() => { if (sessionChange === mine) sessionChange = null; });
  sessionChange = mine;
  return promise;
}
const sentToken = (config) => String(config?.headers?.Authorization || config?.headers?.get?.("Authorization") || "").replace(/^Bearer /, "");
/** True when a newer token has been issued since this request was sent (after waiting for a session change in progress). */
async function newerTokenAvailable(config) {
  if (sessionChange) await sessionChange;
  const sent = sentToken(config);
  return !!accessToken && !!sent && sent !== accessToken;
}

api.interceptors.response.use(
  (r) => {
    window.dispatchEvent(new CustomEvent("lm:online"));
    if (r?.headers?.date) noteServerTime(r.headers.date);
    return r;
  },
  async (err) => {
    const originalRequest = err.config;
    if (!err.response) {
      window.dispatchEvent(new CustomEvent("lm:offline"));
      return Promise.reject(err);
    }
    // A wrong password or code at sign-in is the answer, not an expired session: there is nothing to refresh.
    if (err.response.status !== 401 || originalRequest._retry || originalRequest.url === "/auth/refresh" || String(originalRequest.url || "").startsWith("/auth/login")) {
      if (err.response.status === 401 && accessToken) {
        setAccessToken(null);
        if (!window.location.pathname.includes("/login")) window.location.href = "/login";
      }
      return Promise.reject(err);
    }

    if (!originalRequest._replayed && await newerTokenAvailable(originalRequest)) {
      originalRequest._replayed = true;
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return api(originalRequest);
    }

    originalRequest._retry = true;
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshWaiters.push({
          resolve: (token) => { originalRequest.headers.Authorization = `Bearer ${token}`; resolve(api(originalRequest)); },
          reject,
        });
      });
    }

    isRefreshing = true;
    try {
      const newToken = await refreshSession();
      isRefreshing = false;
      refreshWaiters.splice(0).forEach((w) => w.resolve(newToken));
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return api(originalRequest);
    } catch (refreshErr) {
      isRefreshing = false;
      if (sessionRefused(refreshErr) && !originalRequest._replayed && await newerTokenAvailable(originalRequest)) {
        originalRequest._replayed = true;
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        refreshWaiters.splice(0).forEach((w) => w.resolve(accessToken));
        return api(originalRequest);
      }
      if (sessionRefused(refreshErr)) {
        refreshWaiters.splice(0).forEach((w) => w.reject(err));
        setAccessToken(null);
        if (!window.location.pathname.includes("/login")) window.location.href = "/login";
        return Promise.reject(err);
      }
      // The refresh did not get an answer (or the server failed). The session may be perfectly good, so nobody is signed out:
      // the request fails like any request made while offline, and the next one tries again.
      refreshWaiters.splice(0).forEach((w) => w.reject(refreshErr));
      return Promise.reject(refreshErr);
    }
  }
);

/** The server's reason when it sent a readable one (e.g. "Cannot delete account with transactions"), else `fallback`.
 *  Validation lists (422) are too technical to show, so they fall back too. */
export function errorMessage(err, fallback) {
  const detail = err?.response?.data?.detail;
  return typeof detail === "string" && detail.trim() ? detail : fallback;
}

export const eur = (n) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Number(n || 0));

export const CATEGORY_COLORS = {
  Groceries: "#10B981", "Eating Out": "#F59E0B", Transport: "#6366F1", Shopping: "#EC4899",
  Entertainment: "#8B5CF6", Work: "#0EA5E9", Fitness: "#059669", Health: "#EF4444",
  Travel: "#14B8A6", Subscriptions: "#F97316", Bills: "#64748B", Other: "#94A3B8",
};
