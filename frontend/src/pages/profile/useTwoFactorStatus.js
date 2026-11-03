import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const NONE = { enabled: false, methods: [], passkeys: [], sms: { enabled: false, available: false }, recovery_codes_left: 0 };

/** What two-step sign-in is set up right now: asked on arrival and again whenever `watch` changes (a dialog that needs a proof opening).
 *  Someone may have turned it on a minute ago on this same page, and a dialog built from an old answer would not ask for the code the
 *  server requires. */
export function useTwoFactorStatus(watch) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let live = true;
    api.get("/auth/2fa").then((r) => live && setStatus(r.data)).catch(() => live && setStatus((s) => s || NONE));
    return () => { live = false; };
  }, [watch]);
  return status || NONE;
}
