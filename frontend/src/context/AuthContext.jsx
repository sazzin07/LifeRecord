import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/lib/api";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("lm_token");
    if (!token) { setUser(false); setReady(true); return; }
    api.get("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => setUser(false))
      .finally(() => setReady(true));
  }, []);

  const setTokenAndUser = (data) => {
    if (data.token) localStorage.setItem("lm_token", data.token);
    if (data.refresh_token) localStorage.setItem("lm_refresh_token", data.refresh_token);
    setUser(data.user);
    return data.user;
  };

  const clearTokens = () => {
    localStorage.removeItem("lm_token");
    localStorage.removeItem("lm_refresh_token");
  };

  const refreshAccessToken = async () => {
    const refreshToken = localStorage.getItem("lm_refresh_token");
    if (!refreshToken) return null;
    try {
      const { data } = await api.post("/auth/refresh", { token: refreshToken });
      if (data.token) localStorage.setItem("lm_token", data.token);
      if (data.refresh_token) localStorage.setItem("lm_refresh_token", data.refresh_token);
      return data.token;
    } catch {
      clearTokens();
      return null;
    }
  };

  const signup = async (email, password, name) => {
    const { data } = await api.post("/auth/register", { email, password, name });
    return data;
  };

  const resendVerification = async (email) => {
    const { data } = await api.post("/auth/resend-verification", { email });
    return data;
  };

  const verifyCode = async (email, code) => {
    const { data } = await api.post("/auth/verify", { email, code });
    return setTokenAndUser(data);
  };

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.requires_verification) {
      // Store the pre-verification token so the verify modal can resend/verify
      if (data.token) localStorage.setItem("lm_token", data.token);
      setUser(data.user);
      return { requiresVerification: true, user: data.user };
    }
    return setTokenAndUser(data);
  };

  const forgotPassword = async (email) => {
    const { data } = await api.post("/auth/forgot-password", { email });
    return data;
  };

  const resetPassword = async (token, password) => {
    const { data } = await api.post("/auth/reset-password", { token, password });
    return setTokenAndUser(data);
  };

  const changePassword = async (currentPassword, newPassword) => {
    const { data } = await api.post("/auth/change-password", {
      current_password: currentPassword,
      new_password: newPassword,
    });
    return data;
  };

  const logout = () => {
    clearTokens();
    setUser(false);
    window.location.href = "/login";
  };

  return (
    <AuthCtx.Provider
      value={{
        user,
        ready,
        login,
        signup,
        verifyCode,
        resendVerification,
        forgotPassword,
        resetPassword,
        changePassword,
        refreshAccessToken,
        logout,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}
