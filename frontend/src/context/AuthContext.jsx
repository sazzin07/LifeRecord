import { createContext, useContext, useEffect, useState } from "react";
import { api, refreshSession } from "@/lib/api";
import { clearCaches } from "@/lib/swrCache";
import { setCacheUser } from "@/lib/query";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking
  const [ready, setReady] = useState(false);
  // Cached query data is keyed by user. Set during render so children never read another account's cache.
  setCacheUser(user ? user.id : null);

  useEffect(() => {
    const token = localStorage.getItem("lm_token");
    // Signed out means no cached account data either, even if a background refresh wrote some during sign-out.
    if (!token) { clearCaches(); setUser(false); setReady(true); return; }
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
    try {
      return await refreshSession();
    } catch {
      clearTokens();
      clearCaches();
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
    const finish = () => {
      clearTokens();
      clearCaches(); // cached page data belongs to the signed-in user only
      setUser(false);
      window.location.href = "/login";
    };
    // Ask the server to drop this browser's refresh cookie; sign out locally whatever the answer.
    api.post("/auth/logout", null, { timeout: 3000 }).then(finish, finish);
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
