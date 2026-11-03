import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Avatar } from "@/components/common";
import { cn } from "@/lib/utils";

// The photo is private: it is fetched with the person's login (a plain <img> cannot send it) and shown from a temporary local address.
// One per person and version, kept for the session, so the header, the profile and every other place share one download.
const urls = new Map();       // `${user id}:${version}` -> object URL
const inFlight = new Map();   // the same key being fetched: every avatar on screen waits for ONE download
// Old versions are never revoked: another avatar on the page may still be showing one (revoking it left a broken, "corrupted" picture), and a
// profile photo is a few dozen kilobytes. The whole cache goes when the page is closed.

export function useProfilePhoto() {
  const { user } = useAuth();
  const version = user?.photo_version || null;
  const key = user?.id && version ? `${user.id}:${version}` : null;
  const [url, setUrl] = useState(() => (key ? urls.get(key) || null : null));

  useEffect(() => {
    if (!key) { setUrl(null); return undefined; }
    if (urls.has(key)) { setUrl(urls.get(key)); return undefined; }
    let live = true;
    if (!inFlight.has(key)) {
      inFlight.set(key, api.get("/auth/me/photo", { responseType: "blob" })
        .then(({ data }) => { const made = URL.createObjectURL(data); urls.set(key, made); return made; })
        .finally(() => inFlight.delete(key)));
    }
    inFlight.get(key).then((made) => { if (live) setUrl(made); }).catch(() => { if (live) setUrl(null); });   // the initials stay
    return () => { live = false; };
  }, [key]);
  return url;
}

/** The signed-in person: their photo when they have one, their initials when not. `size` is the width and height (Tailwind classes). */
export function UserAvatar({ size = "h-9 w-9", className, decorative = false }) {
  const { user } = useAuth();
  const url = useProfilePhoto();
  if (url) return <img src={url} alt="" draggable={false} className={cn("shrink-0 rounded-full object-cover", size, className)} data-testid="user-photo" />;
  if (decorative) {
    // Initials drawn by CSS (not text in the page): the button that holds this already has a name, and text that differs from it would be flagged.
    const initials = (user?.name || "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    return <span aria-hidden="true" data-initials={initials} className={cn("initials-pseudo grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 font-semibold text-white", size, className)} />;
  }
  return <Avatar name={user?.name || "?"} size={cn(size, className)} />;
}
