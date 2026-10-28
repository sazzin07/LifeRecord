import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { api } from "@/lib/api";

/**
 * An image from the chat. Pictures you just attached are shown straight from the file; pictures saved with a chat are
 * fetched with your login (a plain <img> cannot send it) and shown from a temporary local URL. Clicking opens it full size.
 */
export function AuthImage({ src, alt = "Attached image", className = "max-h-40 rounded-lg" }) {
  const direct = !src || /^(data|blob):/.test(src);
  const [url, setUrl] = useState(direct ? src : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (direct) { setUrl(src); setFailed(false); return undefined; }
    let cancelled = false;
    let made = null;
    setUrl(null); setFailed(false);
    api.get(src, { responseType: "blob" })
      .then(({ data }) => { if (!cancelled) { made = URL.createObjectURL(data); setUrl(made); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made); };
  }, [src, direct]);

  if (failed) {
    return <p className="mb-2 flex items-center gap-1.5 text-xs opacity-80" data-testid="ai-image-missing"><ImageOff className="h-3.5 w-3.5" />Image no longer available</p>;
  }
  if (!url) return <div className="mb-2 skeleton h-24 w-32 !bg-white/30" aria-hidden="true" />;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="mb-2 block w-fit" aria-label="Open the image full size">
      <img src={url} alt={alt} data-testid="ai-image" className={className} />
    </a>
  );
}
