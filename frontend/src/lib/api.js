import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("lm_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
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

async function doRefresh() {
  const refreshToken = localStorage.getItem("lm_refresh_token");
  if (!refreshToken) throw new Error("No refresh token");
  const { data } = await axios.post(`${API}/auth/refresh`, { token: refreshToken });
  if (data.token) localStorage.setItem("lm_token", data.token);
  if (data.refresh_token) localStorage.setItem("lm_refresh_token", data.refresh_token);
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
      if (err.response.status === 401 && localStorage.getItem("lm_token")) {
        localStorage.removeItem("lm_token");
        localStorage.removeItem("lm_refresh_token");
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
      const newToken = await doRefresh();
      isRefreshing = false;
      onRefreshed(newToken);
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return api(originalRequest);
    } catch {
      isRefreshing = false;
      localStorage.removeItem("lm_token");
      localStorage.removeItem("lm_refresh_token");
      if (!window.location.pathname.includes("/login")) window.location.href = "/login";
      return Promise.reject(err);
    }
  }
);

export const eur = (n) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(Number(n || 0));

export const CATEGORY_COLORS = {
  Groceries: "#10B981", "Eating Out": "#F59E0B", Transport: "#6366F1", Shopping: "#EC4899",
  Entertainment: "#8B5CF6", Work: "#0EA5E9", Fitness: "#059669", Health: "#EF4444",
  Travel: "#14B8A6", Subscriptions: "#F97316", Bills: "#64748B", Other: "#94A3B8",
};
