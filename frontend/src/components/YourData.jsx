import { useState } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { Card, Label } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

const PHRASE = "DELETE MY ACCOUNT"; // the server checks the same words, exactly

/** Take your data with you, or remove the account. Both are explained before they happen. */
export function YourData() {
  const { logout } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

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

  const ready = password.length > 0 && phrase === PHRASE && !busy;

  return (
    <Card className="p-5" data-testid="your-data">
      <Label>Your data</Label>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
        Download everything in your account (records, photos and saved chats) as one file, or delete the account and all of it.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" onClick={exportData} disabled={exporting} data-testid="your-data-export">
          {exporting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4 mr-1" aria-hidden="true" />}
          Download my data
        </Button>
        <Button variant="outline" onClick={() => setOpen(true)} data-testid="your-data-delete-open"
          className="text-red-700 border-red-300 hover:bg-red-50 dark:text-red-300 dark:border-red-500/40 dark:hover:bg-red-500/10">
          <Trash2 className="h-4 w-4 mr-1" aria-hidden="true" />Delete my account
        </Button>
      </div>

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
    </Card>
  );
}
