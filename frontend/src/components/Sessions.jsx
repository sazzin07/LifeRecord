import { useCallback, useEffect, useState } from "react";
import { Busy, SkRows } from "@/components/skeletons";
import { Loader2, Monitor, Smartphone } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Card, Label } from "@/components/common";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const onPhone = (device) => /iPhone|iPad|Android/.test(device);
const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Where this account is signed in. Each session is named by browser and system only; any other one can be ended from here. */
export function Sessions() {
  const [rows, setRows] = useState(null);
  const [ending, setEnding] = useState("");

  const load = useCallback(() => api.get("/auth/sessions").then((r) => setRows(r.data)).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);

  const end = async (row) => {
    setEnding(row.id);
    try {
      await api.delete(`/auth/sessions/${row.id}`);
      toast.success(`Signed out of ${row.device}`);
      await load();
    } catch (err) {
      toast.error(errorMessage(err, "Could not sign that device out"));
    } finally {
      setEnding("");
    }
  };

  return (
    <Card className="p-5" data-testid="sessions">
      <Label>Where you're signed in</Label>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Every browser or app that is signed in to your account. If you do not recognise one, sign it out here and change your password.
      </p>
      {rows === null ? (
        <Busy label="Loading your devices" className="mt-3"><SkRows n={2} lead="square" figure={false} /></Busy>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800" data-testid="sessions-list">
          {rows.map((row) => (
            <li key={row.id} data-testid={`session-${row.id}`} className="flex items-center gap-3 py-2.5">
              {onPhone(row.device) ? <Smartphone className="h-5 w-5 text-slate-500 shrink-0" aria-hidden="true" /> : <Monitor className="h-5 w-5 text-slate-500 shrink-0" aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {row.device}
                  {row.current && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" data-testid="session-current">This device</span>}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">Last active {when(row.last_seen_at)} · signed in {when(row.created_at)}</p>
              </div>
              {!row.current && (
                <Button variant="outline" size="sm" onClick={() => end(row)} disabled={ending === row.id}
                  aria-label={`Sign out ${row.device}, last active ${when(row.last_seen_at)}`} data-testid={`session-end-${row.id}`}>
                  {ending === row.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Sign out"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
