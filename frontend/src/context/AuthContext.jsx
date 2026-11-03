import { createContext, useContext, useEffect, useState } from "react";
import { api, refreshSession, sessionRefused, setAccessToken } from "@/lib/api";
import { clearCaches } from "@/lib/swrCache";
import { setCacheUser } from "@/lib/query";
import { announceSignedOut, onSignedOutElsewhere } from "@/lib/authChannel";
import { getPasskey } from "@/lib/webauthn";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = checking
  const [ready, setReady] = useState(false);
  const [unreachable, setUnreachable] = useState(false); // the server did not answer: not the same as signed out
  // Cached query data is keyed by user. Set during render so children never read another account's cache.
  setCacheUser(user ? user.id : null);

  useEffect(() => {
    // The access token lives in memory only, so every page load asks the server whether the HttpOnly refresh cookie still
    // names a live session. No cookie, or a session that ended (signed out, expired, server restarted): signed out, and no
    // cached account data either, even if a background refresh wrote some during sign-out.
    let cancelled = false;
    let timer = null;
    const boot = async () => {
      try {
        await refreshSession();
        const r = await api.get("/auth/me");
        if (cancelled) return;
        setUser(r.data);
      } catch (err) {
        if (cancelled) return;
        if (!sessionRefused(err)) {
          // No answer (the network dropped, the server is restarting) or a server error. That says nothing about the session, so
          // nobody is signed out: wait, and ask again. The refresh repeats itself with the same key, so asking again is safe.
          setUnreachable(true);
          timer = setTimeout(boot, 4000);
          return;
        }
        setAccessToken(null);
        clearCaches();
        setUser(false);
      }
      setUnreachable(false);
      setReady(true);
    };
    boot();
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  // Another tab of this browser signed out (or signed out everywhere, or deactivated the account): the server has ended the
  // session, so this tab is over too. Without this it would only notice at its next request.
  useEffect(() => {
    if (!user) return undefined;
    return onSignedOutElsewhere(() => {
      setAccessToken(null);
      clearCaches();
      window.location.replace("/login"); // one load, no intermediate login screen (see logout)
    });
  }, [user]);

  const setTokenAndUser = (data) => {
    if (data.token) setAccessToken(data.token);
    setUser(data.user);
    // The sign-in answer carries who they are; the photo and "member since" come from the profile, asked for right after.
    if (data.token) api.get("/auth/me").then((r) => setUser((u) => (u && u.id === r.data.id ? { ...u, ...r.data } : u))).catch(() => {});
    return data.user;
  };

  const clearTokens = () => setAccessToken(null);

  /** Show a change to the signed-in person (their name, their address) without asking the server who they are again. */
  const updateUser = (changes) => setUser((u) => (u ? { ...u, ...changes } : u));

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

  // The password chosen at sign-up goes with the emailed code (see /auth/verify on the server).
  const verifyCode = async (email, code, password) => {
    const { data } = await api.post("/auth/verify", { email, code, password });
    return setTokenAndUser(data);
  };

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    // The password was right but the account asks for a second step: nothing is signed in yet, only a challenge to finish with a code.
    if (data.requires_totp) return { requiresTotp: true, challenge: data.challenge, methods: data.methods || ["totp"], smsHint: data.sms_hint || null };
    if (data.requires_verification) {
      // Keep the pre-verification token (in memory) so the verify modal can resend/verify
      if (data.token) setAccessToken(data.token);
      setUser(data.user);
      return { requiresVerification: true, user: data.user };
    }
    return setTokenAndUser(data);
  };

  // The second half of signing in, whichever way the account offers: an authenticator or recovery code, a passkey, a texted code.
  const loginWithCode = async (challenge, code) => {
    const { data } = await api.post("/auth/login/totp", { challenge, code });
    return setTokenAndUser(data);
  };

  const loginWithPasskey = async (challenge) => {
    const { data: ask } = await api.post("/auth/login/passkey/options", { challenge });
    const credential = await getPasskey(ask.options);
    const { data } = await api.post("/auth/login/passkey", { challenge, challenge_id: ask.challenge_id, credential });
    return setTokenAndUser(data);
  };

  const sendLoginText = async (challenge) => (await api.post("/auth/login/sms/send", { challenge })).data;

  const loginWithText = async (challenge, code) => {
    const { data } = await api.post("/auth/login/sms", { challenge, code });
    return setTokenAndUser(data);
  };

  const forgotPassword = async (email) => {
    const { data } = await api.post("/auth/forgot-password", { email });
    return data;
  };

  const resetPassword = async (token, password) => {
    const { data } = await api.post("/auth/reset-password", { token, password });
    // An account with two-step sign-in is not signed in by an emailed link alone: it still asks for the code.
    if (data.requires_totp) return { requiresTotp: true, message: data.message };
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
      announceSignedOut();
      clearTokens();
      clearCaches(); // cached page data belongs to the signed-in user only
      // No setUser(false) here: it would route to the login page at once and the reload below would then blank it and draw
      // it a second time (the flash). The reload alone starts clean, with no user in memory.
      window.location.replace("/login");
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
        unreachable,
        login,
        loginWithCode,
        loginWithPasskey,
        sendLoginText,
        loginWithText,
        signup,
        verifyCode,
        resendVerification,
        forgotPassword,
        resetPassword,
        changePassword,
        updateUser,
        refreshAccessToken,
        logout,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}
