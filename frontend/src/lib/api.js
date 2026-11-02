import axios from "axios";

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

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let isRefreshing = false;
let refreshSubscribers = [];

function onRefreshed(token) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

function subscribeTokenRefresh(cb) {
  refreshSubscribers.push(cb);
}

/** Exchange the refresh cookie for a new access token, held in memory. Fails (401) when the session has ended on the server:
 *  signed out, expired, or the server restarted. */
export async function refreshSession() {
  const { data } = await axios.post(`${API}/auth/refresh`, {}, { withCredentials: true, headers: AUTH_MODE });
  setAccessToken(data.token);
  return data.token;
}

api.interceptors.response.use(
  (r) => {
    window.dispatchEvent(new CustomEvent("lm:online"));
    return r;
  },
  async (err) => {
    const originalRequest = err.config;
    if (!err.response) {
      window.dispatchEvent(new CustomEvent("lm:offline"));
      return Promise.reject(err);
    }
    if (err.response.status !== 401 || originalRequest._retry || originalRequest.url === "/auth/refresh") {
      if (err.response.status === 401 && accessToken) {
        setAccessToken(null);
        if (!window.location.pathname.includes("/login")) window.location.href = "/login";
      }
      return Promise.reject(err);
    }

    originalRequest._retry = true;
    if (isRefreshing) {
      return new Promise((resolve) => {
        subscribeTokenRefresh((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`;
          resolve(api(originalRequest));
        });
      });
    }

    isRefreshing = true;
    try {
      const newToken = await refreshSession();
      isRefreshing = false;
      onRefreshed(newToken);
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return api(originalRequest);
    } catch {
      isRefreshing = false;
      setAccessToken(null);
      if (!window.location.pathname.includes("/login")) window.location.href = "/login";
      return Promise.reject(err);
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
