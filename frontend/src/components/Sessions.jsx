import { useCallback, useEffect, useState } from "react";
import { Busy, Sk } from "@/components/skeletons";
import { Section } from "@/components/settings/controls";
import { Loader2, Monitor, Smartphone } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const onPhone = (device) => /iPhone|iPad|Android/.test(device);
const when = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

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

  const Tile = ({ row }) => (
    <li data-testid={row ? `session-${row.id}` : undefined} className="flex min-h-[4.25rem] items-center gap-3 rounded-xl border border-border p-3.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 dark:bg-slate-800">
        {row && onPhone(row.device) ? <Smartphone className="h-[18px] w-[18px] text-slate-700 dark:text-slate-300" aria-hidden="true" /> : <Monitor className="h-[18px] w-[18px] text-slate-700 dark:text-slate-300" aria-hidden="true" />}
      </span>
      <div className="min-w-0 flex-1">
        {row ? (
          <>
            <p className="truncate text-sm font-medium">{row.device}</p>
            <p className="truncate text-xs text-slate-600 dark:text-slate-400" title={new Date(row.last_seen_at).toLocaleString()}>Last active {when(row.last_seen_at)}</p>
            <p className="truncate text-xs text-slate-600 dark:text-slate-400">Signed in {day(row.created_at)}</p>
          </>
        ) : (
          <><Sk className="h-4 w-36" /><Sk className="mt-1.5 h-3 w-40" /><Sk className="mt-1.5 h-3 w-32" /></>
        )}
      </div>
      {/* The right-hand place is always taken (this device is marked there, the others have their button), so a tile is as tall as any other. */}
      {!row ? <Sk className="h-9 w-[4.5rem] !rounded-md" /> : row.current ? (
        <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200" data-testid="session-current">This device</span>
      ) : (
        <Button variant="outline" size="sm" onClick={() => end(row)} disabled={ending === row.id}
          aria-label={`Sign out ${row.device}, last active ${when(row.last_seen_at)}`} data-testid={`session-end-${row.id}`}>
          {ending === row.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Sign out"}
        </Button>
      )}
    </li>
  );

  return (
    <Section id="devices" testid="sessions" icon={Monitor} title="Where you're signed in"
      description="Every browser or app signed in to your account. If you do not recognise one, sign it out here and change your password.">
      {rows === null ? (
        <Busy label="Loading your devices"><ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr))]"><Tile /><Tile /></ul></Busy>
      ) : (
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr))]" data-testid="sessions-list">
          {rows.map((row) => <Tile key={row.id} row={row} />)}
        </ul>
      )}
    </Section>
  );
}
