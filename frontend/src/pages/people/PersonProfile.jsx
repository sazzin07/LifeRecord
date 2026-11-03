import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDownLeft, ArrowUpRight, Bot, Eraser, HandCoins, Minus, Pencil, Plus, Receipt, RotateCcw, Trash2, Undo2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { api, eur } from "@/lib/api";
import { THEY, I, errorMessage, newKey, originLabel } from "@/lib/debts";
import { refreshAll, useFetch } from "@/lib/useFetch";
import { Avatar } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Amount } from "@/pages/people/Amount";

const ICON = { add: Plus, reduce: Minus, correct: Pencil, excess: Plus, expense: Receipt, payment_in: ArrowDownLeft, payment_out: ArrowUpRight };
const EASE = [0.2, 0, 0, 1];
const when = (iso) => (iso ? new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "");

/** True on a phone-sized screen: the profile is a bottom sheet there and a side sheet on larger ones. */
function useCompact() {
  const query = "(max-width: 639px)";
  const [compact, setCompact] = useState(() => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const m = window.matchMedia(query);
    const on = () => setCompact(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return compact;
}

function Balance({ direction, amount, person, onAction }) {
  const theirs = direction === THEY;
  const settled = amount < 0.005;
  const Icon = theirs ? ArrowDownLeft : ArrowUpRight;
  const tint = theirs ? "var(--ppl-teal-tint)" : "var(--ppl-amber-tint)";
  const act = (kind) => onAction(kind, direction);
  const small = "h-8 rounded-lg px-2.5";
  return (
    <section aria-label={theirs ? "They owe you" : "You owe them"} data-testid={`balance-${direction}`} className="ppl-solid min-w-0 p-4"
      style={{ backgroundImage: `linear-gradient(${tint}, ${tint})` }}>
      <p className={cn("flex items-start gap-1.5 break-words text-sm", settled ? "ppl-muted" : theirs ? "ppl-teal" : "ppl-amber")}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{theirs ? `${person.name} owes you` : `You owe ${person.name}`}
      </p>
      <p className={cn("mt-1.5 break-words text-[1.75rem] font-semibold leading-tight tracking-tight", settled ? "ppl-muted" : theirs ? "ppl-teal" : "ppl-amber")}>
        <Amount value={amount} className="stat-num" testid={`balance-${direction}-amount`} />
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" className={small} onClick={() => act("add")} data-testid={`act-add-${direction}`}><Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Add</Button>
        <Button size="sm" variant="outline" className={small} disabled={settled} onClick={() => act("reduce")} data-testid={`act-reduce-${direction}`}><Minus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Reduce</Button>
        <Button size="sm" variant="outline" className={small} onClick={() => act("payment")} data-testid={`act-payment-${direction}`}><HandCoins className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{theirs ? "They paid" : "I paid"}</Button>
        <Button size="sm" variant="outline" className={small} onClick={() => act("correct")} data-testid={`act-correct-${direction}`}><Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Correct</Button>
        <Button size="sm" variant="outline" className={cn(small, "ppl-amber")} disabled={settled} onClick={() => act("clear")} data-testid={`act-clear-${direction}`}><Eraser className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Clear</Button>
      </div>
    </section>
  );
}

function Row({ item, onUndo, onClearLine, audit, onRestore, reduce }) {
  const Icon = ICON[item.kind] || Wallet;
  const effect = item.effect;
  const theirs = item.direction === THEY;
  return (
    <motion.li layout={!reduce} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? { opacity: 0 } : { opacity: 0, height: 0 }}
      transition={{ duration: 0.22, ease: EASE }} className="flex items-start gap-3 py-3" data-testid={audit ? "audit-row" : "history-row"}>
      <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg")} style={{ background: theirs ? "var(--ppl-teal-tint)" : "var(--ppl-amber-tint)" }}>
        <Icon className={cn("h-4 w-4", theirs ? "ppl-teal" : "ppl-amber")} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium">
          {item.label}
          <span className="ppl-muted ml-2 inline-flex items-center gap-1 rounded-full border border-[var(--ppl-line)] px-1.5 py-0.5 align-middle text-[11px] font-medium">
            {item.origin === "ai" && <Bot className="h-3 w-3" aria-hidden="true" />}{originLabel[item.origin] || item.origin}
          </span>
          {audit && <span className="ppl-muted ml-2 text-[11px] font-semibold">{item.state === "reversed" ? "Reversed" : item.kind === "clear" || item.state === "cleared" ? "Cleared" : ""}</span>}
        </p>
        <p className="ppl-muted text-xs">
          {theirs ? "They owe you" : "You owe them"} · {when(item.date || (item.at_ms ? new Date(item.at_ms).toISOString() : ""))}{item.description ? ` · ${item.description}` : ""}
        </p>
      </div>
      <div className="flex max-w-[45%] shrink-0 flex-col items-end gap-0.5">
        <span className="stat-num whitespace-nowrap text-sm font-semibold">{effect >= 0 ? "+" : "−"}{eur(Math.abs(effect))}</span>
        {!audit && item.can_reverse && <button type="button" onClick={() => onUndo(item)} className="ppl-muted inline-flex min-h-6 items-center gap-1 rounded px-1 text-xs hover:text-[var(--ppl-text)]" data-testid="row-undo"><Undo2 className="h-3 w-3" aria-hidden="true" />Undo</button>}
        {!audit && item.can_clear && <button type="button" onClick={() => onClearLine(item)} className="ppl-amber inline-flex min-h-6 items-center gap-1 rounded px-1 text-xs hover:underline" data-testid="row-clear"><Eraser className="h-3 w-3" aria-hidden="true" />Clear</button>}
        {audit && item.can_restore && <button type="button" onClick={() => onRestore(item)} className="ppl-teal inline-flex min-h-6 items-center gap-1 rounded px-1 text-xs hover:underline" data-testid="row-restore"><RotateCcw className="h-3 w-3" aria-hidden="true" />Restore</button>}
      </div>
    </motion.li>
  );
}

/** A person's financial profile, a glass sheet over the list (a bottom sheet on a phone): the two balances apart, what each can do,
 *  and the history that explains them. */
export function PersonProfile({ personId, onClose, onEdit, onDelete, onAction }) {
  const { data, loading } = useFetch(personId ? `/debts/people/${personId}` : null);
  const [showCleared, setShowCleared] = useState(false);
  const compact = useCompact();
  const reduce = useReducedMotion();
  const open = !!personId;

  const person = data?.person;
  const balances = data?.balances;
  const reload = () => refreshAll(["/people", "/debts", "/accounts", "/analytics", "/transactions"]);
  const act = async (fn, okMessage) => {
    try { await fn(); reload(); if (okMessage) toast.success(okMessage); } catch (err) { toast.error(errorMessage(err, "That did not work")); }
  };
  const undoRow = (item) => act(() => api.post(`/debts/entries/${item.ref_id}/reverse`, null, { headers: { "Idempotency-Key": newKey() } }), "Undone");
  const clearLine = (item) => act(() => api.post(`/debts/people/${personId}/adjust/clear_line`, { line_type: item.ref_type, line_id: item.ref_id }, { headers: { "Idempotency-Key": newKey() } }), "Cleared, no payment recorded");
  const restore = (item) => act(() => api.post(`/debts/entries/${item.id}/reverse`, null, { headers: { "Idempotency-Key": newKey() } }), "Restored");

  const items = data?.items || [];
  const audit = (data?.audit || []).filter((a) => a.kind === "clear" || a.state === "cleared" || a.kind === "reversal" || a.state === "reversed");
  const both = (kind, direction) => onAction(kind, direction, { ...person, owes_me: balances.they_owe, i_owe: balances.i_owe }, balances);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={compact ? "bottom" : "right"} data-testid="person-profile"
        className={cn("ppl-theme ppl-glass flex flex-col gap-0 overflow-hidden p-0 [&>*]:min-w-0", compact ? "max-h-[92dvh] rounded-t-3xl" : "w-full sm:max-w-[34rem] rounded-l-3xl")}>
        <SheetHeader className="min-w-0 space-y-0 border-b border-[var(--ppl-line)] py-5 pl-5 pr-14 text-left sm:pl-6">
          <div className="flex items-start gap-3">
            <Avatar name={person?.name} photo={person?.photo} size="h-12 w-12" />
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-xl font-semibold tracking-[-0.01em]" data-testid="profile-name">{person?.name || "Loading…"}</SheetTitle>
              <SheetDescription className="ppl-muted mt-0.5 text-sm">{[person?.payment_preference && `Pays by ${person.payment_preference}`, person?.notes].filter(Boolean).join(" · ") || "Money between you and this person."}</SheetDescription>
            </div>
          </div>
          {person && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={() => onEdit(person)} data-testid="profile-edit"><Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Edit</Button>
              {person.archived
                ? <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={() => act(() => api.post(`/debts/people/${personId}/restore`, null, { headers: { "Idempotency-Key": newKey() } }), "Restored")} data-testid="profile-restore">Restore person</Button>
                : <Button variant="outline" size="sm" className="ppl-amber h-8 rounded-lg" onClick={() => onDelete(person, balances)} data-testid="profile-delete"><Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Delete</Button>}
            </div>
          )}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {loading && !data ? <div className="space-y-3" aria-busy="true"><div className="skeleton h-32 rounded-2xl" /><div className="skeleton h-32 rounded-2xl" /></div> : person && (
            <>
              <div className="grid gap-3">
                <Balance direction={THEY} amount={balances.they_owe} person={person} onAction={both} />
                <Balance direction={I} amount={balances.i_owe} person={person} onAction={both} />
              </div>
              {(balances.overpaid?.they_owe || balances.overpaid?.i_owe) ? (
                <p className="ppl-solid mt-3 p-2.5 text-xs">An older payment was recorded for more than was owed ({eur(balances.overpaid.they_owe || balances.overpaid.i_owe)} extra). Use Correct to settle it.</p>
              ) : null}

              <h3 className="mt-7 text-sm font-semibold">History</h3>
              {items.length === 0 ? (
                <p className="ppl-muted mt-2 text-sm" data-testid="history-empty">Nothing recorded yet. Add a debt or record a payment above.</p>
              ) : (
                <ul className="mt-1 divide-y divide-[var(--ppl-line)]" data-testid="history-list">
                  <AnimatePresence initial={false}>{items.map((i) => <Row key={i.id} item={i} onUndo={undoRow} onClearLine={clearLine} reduce={reduce} />)}</AnimatePresence>
                </ul>
              )}

              {audit.length > 0 && (
                <div className="mt-5">
                  <button type="button" onClick={() => setShowCleared((v) => !v)} aria-expanded={showCleared} className="ppl-muted inline-flex min-h-6 items-center text-sm font-medium hover:text-[var(--ppl-text)] hover:underline" data-testid="toggle-cleared">
                    {showCleared ? "Hide cleared items" : `Show cleared items (${audit.length})`}
                  </button>
                  {showCleared && (
                    <ul className="mt-1 divide-y divide-[var(--ppl-line)]" data-testid="audit-list">
                      <AnimatePresence initial={false}>{audit.map((a) => <Row key={`${a.id}-${a.state}`} item={a} audit onRestore={restore} reduce={reduce} />)}</AnimatePresence>
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
