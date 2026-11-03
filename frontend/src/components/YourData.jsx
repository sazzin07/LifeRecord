import { useState } from "react";
import { Database, Download, Loader2, PauseCircle, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Section } from "@/components/settings/controls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const PHRASE = "DELETE MY ACCOUNT"; // the server checks the same words, exactly

/** Take your data with you, switch the account off, or remove it. Each is explained before it happens. */
export function YourData() {
  const { logout } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [offOpen, setOffOpen] = useState(false);
  const [offPassword, setOffPassword] = useState("");
  const [offBusy, setOffBusy] = useState(false);
  const [offProblem, setOffProblem] = useState("");

  const exportData = async () => {
    setExporting(true);
    try {
      const { data } = await api.get("/account/export", { responseType: "blob", timeout: 120000 });
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `liferecord-export-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Your data was downloaded");
    } catch (err) {
      // an error body arrives as a blob when the request asked for one
      let message = "Could not export your data";
      try { message = JSON.parse(await err.response.data.text()).detail || message; } catch { /* keep the plain sentence */ }
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  const close = (o) => { setOpen(o); if (!o) { setPassword(""); setPhrase(""); setProblem(""); } };

  const deleteAccount = async (e) => {
    e.preventDefault();
    setBusy(true);
    setProblem("");
    try {
      await api.delete("/account", { data: { password, confirm: phrase } });
      toast.success("Your account was deleted");
      logout(); // clears this browser and returns to the sign-in page
    } catch (err) {
      setProblem(errorMessage(err, "Could not delete the account. Nothing was removed."));
      setBusy(false);
    }
  };

  const closeOff = (o) => { setOffOpen(o); if (!o) { setOffPassword(""); setOffProblem(""); } };

  const deactivateAccount = async (e) => {
    e.preventDefault();
    setOffBusy(true);
    setOffProblem("");
    try {
      await api.post("/account/deactivate", { password: offPassword });
      toast.success("Your account was deactivated");
      logout(); // the server already ended every session; this clears this browser and returns to the sign-in page
    } catch (err) {
      setOffProblem(errorMessage(err, "Could not deactivate the account. Nothing was changed."));
      setOffBusy(false);
    }
  };

  const ready = password.length > 0 && phrase === PHRASE && !busy;

  return (
    <Section id="your-data" testid="your-data" icon={Database} title="Your data" description="Take it with you, switch the account off for a while, or remove it. Each one is explained again before it happens.">
      <ul className="grid gap-3 md:grid-cols-3">
        {[
          { icon: Download, tone: "", title: "Download my data", text: "Everything in your account (records, photos and saved chats) as one file.", button: (
            <Button variant="outline" className="w-full" onClick={exportData} disabled={exporting} data-testid="your-data-export">
              {exporting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="mr-1 h-4 w-4" aria-hidden="true" />}Download
            </Button>) },
          { icon: PauseCircle, tone: "", title: "Deactivate my account", text: "Switch it off for a while. Nothing is deleted, and “Forgot password” switches it back on.", button: (
            <Button variant="outline" className="w-full" onClick={() => setOffOpen(true)} data-testid="your-data-deactivate-open"><PauseCircle className="mr-1 h-4 w-4" aria-hidden="true" />Deactivate</Button>) },
          { icon: Trash2, tone: "danger", title: "Delete my account", text: "Remove the account and everything in it. This cannot be undone.", button: (
            <Button variant="outline" onClick={() => setOpen(true)} data-testid="your-data-delete-open"
              className="w-full border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"><Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />Delete</Button>) },
        ].map((t) => (
          <li key={t.title} className={`flex flex-col gap-3 rounded-xl border p-4 ${t.tone === "danger" ? "border-red-300/70 dark:border-red-500/30" : "border-border"}`}>
            <div className="flex items-center gap-2.5">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${t.tone === "danger" ? "bg-red-100 dark:bg-red-900/30" : "bg-slate-100 dark:bg-slate-800"}`}>
                <t.icon className={`h-[18px] w-[18px] ${t.tone === "danger" ? "text-red-700 dark:text-red-300" : "text-slate-700 dark:text-slate-300"}`} aria-hidden="true" />
              </span>
              <p className="text-sm font-semibold">{t.title}</p>
            </div>
            <p className="flex-1 text-sm text-slate-600 dark:text-slate-400">{t.text}</p>
            {t.button}
          </li>
        ))}
      </ul>

      <Dialog open={offOpen} onOpenChange={closeOff}>
        <DialogContent className="max-w-md" data-testid="deactivate-account-dialog">
          <DialogHeader>
            <DialogTitle>Deactivate your account?</DialogTitle>
            <DialogDescription>
              You will be signed out on every device, and nobody, including you, can sign in until the account is switched back on.
              Nothing is deleted. To switch it back on, choose “Forgot password” on the sign-in page: the link we email you
              reactivates the account.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={deactivateAccount} className="space-y-3">
            <div>
              <label htmlFor="deactivate-account-password" className="text-sm font-medium">Your password</label>
              <Input id="deactivate-account-password" type="password" autoComplete="current-password" value={offPassword}
                onChange={(e) => setOffPassword(e.target.value)} className="mt-1" data-testid="deactivate-account-password" />
            </div>
            <p role="alert" aria-live="polite" className="min-h-[1.25rem] text-sm text-red-700 dark:text-red-400" data-testid="deactivate-account-error">{offProblem}</p>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => closeOff(false)}>Keep it active</Button>
              <Button type="submit" disabled={offPassword.length === 0 || offBusy} data-testid="deactivate-account-submit"
                className="bg-slate-800 hover:bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900 dark:hover:bg-white">
                {offBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Deactivate"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="max-w-md" data-testid="delete-account-dialog">
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This removes your account and everything in it: money, people, groceries, meals, workouts, photos and saved chats.
              It cannot be undone. Download your data first if you want to keep a copy.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={deleteAccount} className="space-y-3">
            <div>
              <label htmlFor="delete-account-password" className="text-sm font-medium">Your password</label>
              <Input id="delete-account-password" type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} className="mt-1" data-testid="delete-account-password" />
            </div>
            <div>
              <label htmlFor="delete-account-phrase" className="text-sm font-medium">Type <span className="font-mono font-semibold">{PHRASE}</span> to confirm</label>
              <Input id="delete-account-phrase" autoComplete="off" value={phrase} onChange={(e) => setPhrase(e.target.value)}
                className="mt-1 font-mono" data-testid="delete-account-confirm" />
            </div>
            <p role="alert" aria-live="polite" className="min-h-[1.25rem] text-sm text-red-700 dark:text-red-400" data-testid="delete-account-error">{problem}</p>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => close(false)}>Keep my account</Button>
              <Button type="submit" disabled={!ready} data-testid="delete-account-submit" className="bg-red-700 hover:bg-red-800 text-white">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Delete everything"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Section>
  );
}
