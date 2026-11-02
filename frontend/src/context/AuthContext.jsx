import { createContext, useContext, useEffect, useState } from "react";
import { api, refreshSession, setAccessToken } from "@/lib/api";
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
    // The access token lives in memory only, so every page load asks the server whether the HttpOnly refresh cookie still
    // names a live session. No cookie, or a session that ended (signed out, expired, server restarted): signed out, and no
    // cached account data either, even if a background refresh wrote some during sign-out.
    let cancelled = false;
    refreshSession()
      .then(() => api.get("/auth/me"))
      .then((r) => { if (!cancelled) setUser(r.data); })
      .catch(() => { setAccessToken(null); clearCaches(); if (!cancelled) setUser(false); })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  const setTokenAndUser = (data) => {
    if (data.token) setAccessToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const clearTokens = () => setAccessToken(null);

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
      // Keep the pre-verification token (in memory) so the verify modal can resend/verify
      if (data.token) setAccessToken(data.token);
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
    // The server deletes this browser's session, which ends the access token and the refresh cookie everywhere, not just
    // here; sign out locally whatever the answer.
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
