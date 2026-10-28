import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, Check, Loader2, Maximize2, Minimize2, PanelLeft, SquarePen, Sparkles, TriangleAlert, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { refreshAll, useFetch } from "@/lib/useFetch";
import { Hint } from "@/components/ui/hint";
import { ReceiptReview } from "@/components/ReceiptReview";
import { ChatSidebar } from "@/components/ai/ChatSidebar";
import { Composer } from "@/components/ai/Composer";
import { Message } from "@/components/ai/Message";
import { ScheduledView } from "@/components/ai/scheduled/ScheduledView";
import { conversationsChanged } from "@/components/ai/useConversations";
import { useAssistant } from "@/components/ai/useAssistant";
import { cn } from "@/lib/utils";

const GENERIC = [
  "How am I doing today?",
  "What did I spend this month?",
  "I spent €14 at McDonald's on cash",
  "Log 3 eggs, 200g chicken and 300ml milk",
];
const SUGGESTIONS = {
  home: GENERIC,
  money: ["What did I spend this month?", "Which categories are over budget?", "I spent €14 at McDonald's on cash", "What can I spend right now?"],
  people: ["Who owes me money?", "Marta paid me €20 on MB WAY", "Show what each person owes", "Add a new person called Rui"],
  groceries: ["What is about to expire?", "What can I cook with what I have?", "Add milk and eggs to my list", "What is running low?"],
  nutrition: ["What did I eat today?", "Log 3 eggs, 200g chicken and 300ml milk", "How many calories left today?", "Delete my last logged meal"],
  fitness: ["Show my last workouts", "Log a push workout", "What are my personal records?", "How often did I train this month?"],
  body: ["How has my weight changed?", "I weigh 82.4 kg today", "Show my weight history", "Delete my last weight entry"],
  tasks: ["What is overdue?", "Add a task to renew my passport on Friday", "Mark the oldest overdue task done", "What is due this week?"],
  calendar: ["What is due this week?", "What is overdue?", "Move my next reminder to Monday", "Add a reminder for Friday"],
  settings: GENERIC,
};

const pageOf = (pathname) => pathname.split("/")[1] || "home";

function useMedia(query) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

function ActivityFeed({ actions, onUndo }) {
  if (actions.length === 0) {
    return <p className="pt-10 text-center text-sm text-muted-foreground">Nothing changed yet. Ask me to add or update something and it shows up here, with an undo.</p>;
  }
  return (
    <ul className="space-y-2" data-testid="activity-feed">
      {actions.map((a) => (
        <li key={a.id} data-testid={`activity-${a.id}`} className="rounded-xl border border-border bg-card p-3">
          <p className="text-[11px] text-muted-foreground">{new Date(a.created_at).toLocaleString()}</p>
          <p className="mt-0.5 text-sm">{a.label}</p>
          {a.tools?.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">{a.tools.join(", ")}</p>}
          {a.undoable && !a.undone && (
            <button type="button" onClick={() => onUndo(a.id)} data-testid={`undo-${a.id}`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-300">
              <Undo2 className="h-3 w-3" />Undo
            </button>
          )}
          {a.undone && <span className="mt-2 inline-block text-xs text-muted-foreground">Undone</span>}
        </li>
      ))}
    </ul>
  );
}

function Empty({ page, onPick }) {
  return (
    <div className="pt-8" data-testid="ai-empty">
      <h2 className="text-lg font-semibold tracking-tight">What can I help with?</h2>
      <p className="mt-1 text-sm text-muted-foreground">I can look things up, add records, edit them and explain your numbers across every page.</p>
      <div className="mt-5 grid gap-2">
        {(SUGGESTIONS[page] || GENERIC).map((s) => (
          <button key={s} type="button" data-testid="ai-suggestion" onClick={() => onPick(s)}
            className="rounded-xl border border-border bg-card px-3.5 py-2.5 text-left text-sm transition-colors hover:border-emerald-400 hover:bg-emerald-50/60 dark:hover:bg-emerald-500/10">
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-4 pt-2" aria-hidden="true">
      <div className="flex justify-end"><div className="skeleton h-9 w-40" /></div>
      <div className="flex gap-2.5"><div className="skeleton h-7 w-7 shrink-0" /><div className="space-y-2"><div className="skeleton h-4 w-64 max-w-full" /><div className="skeleton h-4 w-44" /></div></div>
    </div>
  );
}

/** Where the current chat stands on the server, in a few words. */
function SaveBadge({ state, onRetry }) {
  if (state === "idle") return null;
  const map = {
    saving: { icon: <Loader2 className="h-3 w-3 animate-spin" />, text: "Saving…", cls: "text-muted-foreground" },
    saved: { icon: <Check className="h-3 w-3" />, text: "Saved", cls: "text-emerald-700 dark:text-emerald-300" },
    failed: { icon: <TriangleAlert className="h-3 w-3" />, text: "Not saved", cls: "text-red-700 dark:text-red-300" },
  }[state];
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", map.cls)} role="status" data-testid="ai-save-state" data-state={state}>
      {map.icon}{map.text}
      {state === "failed" && <button type="button" onClick={onRetry} className="ml-1 font-semibold underline-offset-2 hover:underline">Retry</button>}
    </span>
  );
}

export function AIAssistant() {
  const loc = useLocation();
  const page = pageOf(loc.pathname);
  const reduce = useReducedMotion();
  const mobile = useMedia("(max-width: 639px)");
  const roomy = useMedia("(min-width: 900px)");
  const chat = useAssistant(page);
  const { msgs, busy, title, loadState, loadCurrent, openConversation, send, retry, stop, reset, saveState, sessionId } = chat;

  const [open, setOpen] = useState(false);
  const [view, setView] = useState("chat"); // chat | scheduled | activity
  const [menu, setMenu] = useState(false);
  const [wide, setWide] = useState(() => { try { return localStorage.getItem("lm_ai_wide") === "1"; } catch { return false; } });
  const [draft, setDraft] = useState(() => { try { return localStorage.getItem("lm_ai_draft") || ""; } catch { return ""; } });
  const [image, setImage] = useState(null);
  const [recording, setRecording] = useState(false);
  const [actions, setActions] = useState([]);
  const [receipt, setReceipt] = useState({ data: null, open: false, scanning: false });
  const [stuck, setStuck] = useState(true);
  const [offline, setOffline] = useState(() => typeof navigator !== "undefined" && navigator.onLine === false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const panel = useRef(null);
  const fab = useRef(null);
  const list = useRef(null);
  const composer = useRef(null);
  const recorder = useRef(null);
  const stick = useRef(true);

  const docked = wide && roomy && !mobile;           // sidebar sits beside the chat instead of over it
  const { data: scheduled } = useFetch(open ? "/scheduled/tasks" : null);
  const scheduledCount = (scheduled || []).filter((t) => t.status === "active").length;

  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => { try { localStorage.setItem("lm_ai_draft", draft); } catch { /* storage blocked */ } }, [draft]);
  useEffect(() => { try { localStorage.setItem("lm_ai_wide", wide ? "1" : "0"); } catch { /* storage blocked */ } }, [wide]);
  useEffect(() => { if (open) loadCurrent(); }, [open, loadCurrent]);
  useEffect(() => {
    const off = () => setOffline(true); const on = () => setOffline(false);
    window.addEventListener("offline", off); window.addEventListener("online", on);
    window.addEventListener("lm:offline", off); window.addEventListener("lm:online", on);
    return () => { window.removeEventListener("offline", off); window.removeEventListener("online", on); window.removeEventListener("lm:offline", off); window.removeEventListener("lm:online", on); };
  }, []);

  // Open from elsewhere (command bar, quick actions) with an optional prefilled prompt.
  useEffect(() => {
    const h = (e) => { setOpen(true); setView("chat"); if (e.detail?.prompt) setDraft(e.detail.prompt); };
    window.addEventListener("lm:openAI", h);
    return () => window.removeEventListener("lm:openAI", h);
  }, []);

  // Focus the box on open and hand focus back to the button on close.
  useEffect(() => {
    if (open && view === "chat") { const t = setTimeout(() => composer.current?.focus(), reduce ? 0 : 180); return () => clearTimeout(t); }
    return undefined;
  }, [open, view, reduce]);
  const close = useCallback(() => { setOpen(false); setMenu(false); setTimeout(() => fab.current?.focus({ preventScroll: true }), 0); }, []);

  const loadActions = useCallback(async () => {
    try { const { data } = await api.get("/ai/actions"); setActions(data); } catch { /* the feed stays as it was */ }
  }, []);
  useEffect(() => { if (open && view === "activity") loadActions(); }, [open, view, loadActions]);
  const undo = async (id) => {
    try { await api.post(`/ai/actions/${id}/undo`); toast.success("Change undone"); refreshAll(); loadActions(); }
    catch { toast.error("Could not undo that change"); }
  };

  // Keep the newest text in view unless the reader has scrolled up to read.
  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    setStuck(near);
  };
  const toBottom = useCallback((smooth) => {
    const el = list.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? "smooth" : "auto" });
  }, [reduce]);
  useLayoutEffect(() => { if (stick.current && view === "chat") toBottom(false); }, [msgs, view, toBottom, open]);

  const submit = (text) => {
    const message = (text ?? draft).trim();
    if (!message && !image) return;
    if (send(message, image)) {
      setDraft(""); setImage(null); stick.current = true; setStuck(true);
      setTimeout(() => toBottom(true), 0);
    }
  };

  const goChat = () => { setView("chat"); setMenu(false); setTimeout(() => composer.current?.focus(), 0); };
  const newChat = () => { if (!reset()) { toast.message("Wait for the reply, or stop it, before starting a new chat."); return; } goChat(); };
  const openChat = async (id) => {
    if (busy) { toast.message("Wait for the reply, or stop it, before switching chats."); return; }
    stick.current = true;
    const ok = await openConversation(id);
    if (ok) goChat(); else toast.error("Could not open that chat");
  };

  const startRename = () => { if (!msgs.length) return; setNameDraft(title); setRenaming(true); };
  const commitRename = async () => {
    const next = nameDraft.trim();
    setRenaming(false);
    if (!next || next === title) return;
    const before = title;
    chat.setTitle(next);
    try { await api.patch(`/ai/conversations/${sessionId}`, { title: next }); conversationsChanged(); }
    catch { chat.setTitle(before); toast.error("Could not rename this chat"); }
  };

  const pickImage = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setImage(reader.result);
    reader.readAsDataURL(f);
  };

  const scanReceipt = async () => {
    if (!image) return;
    setReceipt((r) => ({ ...r, scanning: true }));
    try {
      const { data } = await api.post("/ai/receipt", { image_base64: image });
      if (!data.items?.length && !data.merchant) { toast.error("No receipt found in that image"); return; }
      setReceipt({ data, open: true, scanning: false }); setImage(null);
    } catch { toast.error("Could not read that receipt"); }
    finally { setReceipt((r) => ({ ...r, scanning: false })); }
  };

  const toggleRecord = async () => {
    if (recording) { recorder.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const fd = new FormData();
        fd.append("file", new Blob(chunks, { type: "audio/webm" }), "audio.webm");
        try {
          const { data } = await api.post("/ai/transcribe", fd);
          if (data.text) submit(data.text);
        } catch { toast.error("Could not turn that audio into text"); }
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch { toast.error("Microphone access was blocked"); }
  };

  // Esc closes the menu first, then the panel (unless a dialog is on top); Tab stays inside the panel.
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => {
      if (e.key !== "Escape" || e.defaultPrevented || receipt.open || renaming) return;
      if (document.querySelector('[role="alertdialog"], [role="dialog"][data-state="open"]:not([data-testid="ai-panel"]), [role="listbox"]')) return;
      if (menu && !docked) setMenu(false); else close();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, close, receipt.open, menu, docked, renaming]);
  const onPanelKeyDown = (e) => {
    if (e.key !== "Tab") return;
    const nodes = [...panel.current.querySelectorAll('button:not([disabled]), textarea, input:not([type="file"]), [href], [tabindex]:not([tabindex="-1"])')]
      .filter((n) => n.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0]; const lastNode = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastNode.focus(); }
    else if (!e.shiftKey && document.activeElement === lastNode) { e.preventDefault(); first.focus(); }
  };

  const lastSent = [...msgs].reverse().find((m) => m.role === "user")?.text;
  const lastReply = [...msgs].reverse().find((m) => m.role === "assistant");
  const slide = mobile ? { y: "100%" } : { x: "100%" };
  const t = reduce ? { duration: 0 } : { type: "spring", damping: 32, stiffness: 340 };
  const heading = view === "scheduled" ? "Scheduled tasks" : view === "activity" ? "Activity" : msgs.length ? title : "Assistant";

  const sidebar = (
    <ChatSidebar view={view} onView={(v) => { setView(v); setMenu(false); }} activeId={sessionId} busy={busy} onNew={newChat} onOpen={openChat}
      onDeleted={() => { reset(); setView("chat"); }} scheduledCount={scheduledCount} offline={offline} />
  );

  return (
    <>
      <button ref={fab} type="button" data-testid="ai-fab" aria-label="Open the assistant" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(true)}
        className="pulse-ring fixed bottom-20 right-4 z-40 grid h-14 w-14 place-items-center rounded-full border border-slate-300/50 shadow-2xl glass-strong dark:border-slate-700/60 lg:bottom-6 lg:right-6">
        <Sparkles className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div key="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.18 }}
              onClick={close} aria-hidden="true" className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[2px]" />
            <motion.div key="panel" ref={panel} role="dialog" aria-modal="true" aria-label="Assistant" data-testid="ai-panel" data-wide={wide ? "true" : "false"}
              initial={slide} animate={{ x: 0, y: 0 }} exit={slide} transition={t} onKeyDown={onPanelKeyDown}
              className={cn(
                "fixed z-50 flex glass-strong border-border shadow-2xl transition-[width] duration-200 motion-reduce:transition-none",
                "inset-x-0 bottom-0 top-10 rounded-t-3xl border-t",
                "sm:inset-y-0 sm:left-auto sm:right-0 sm:top-0 sm:rounded-none sm:border-l sm:border-t-0",
                wide ? "sm:w-[min(920px,100vw)]" : "sm:w-[460px]",
              )}>
              {docked && <aside className="w-[270px] shrink-0 border-r border-border bg-background/40" aria-label="Chats and tools">{sidebar}</aside>}

              <div className="relative flex min-w-0 flex-1 flex-col">
                <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
                  {!docked && (
                    <Hint label="Chats and tools">
                      <button type="button" data-testid="ai-menu" aria-label="Open chats and tools" aria-expanded={menu} onClick={() => setMenu((m) => !m)}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                        <PanelLeft className="h-4 w-4" />
                      </button>
                    </Hint>
                  )}
                  <div className="min-w-0 flex-1">
                    {renaming ? (
                      <input value={nameDraft} autoFocus maxLength={120} aria-label="Chat name" data-testid="ai-title-input" onChange={(e) => setNameDraft(e.target.value)} onBlur={commitRename}
                        onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(false); }}
                        className="w-full rounded-lg border border-emerald-500/60 bg-background px-2 py-1 text-[15px] font-semibold outline-none ring-2 ring-emerald-500/20" />
                    ) : (
                      <h1 className="truncate text-[15px] font-semibold leading-5 tracking-tight">
                        {view === "chat" && msgs.length ? (
                          <button type="button" onClick={startRename} data-testid="ai-title" title="" aria-label={`${title}. Rename`} className="max-w-full truncate rounded-md text-left hover:bg-muted/70">{title}</button>
                        ) : heading}
                      </h1>
                    )}
                    {view === "chat" && <SaveBadge state={saveState} onRetry={() => lastReply && retry(lastReply.id)} />}
                  </div>
                  <div className="flex items-center gap-0.5">
                    {!mobile && roomy && (
                      <Hint label={wide ? "Narrow panel" : "Wide panel"}>
                        <button type="button" data-testid="ai-wide" aria-label={wide ? "Use the narrow panel" : "Use the wide panel"} aria-pressed={wide} onClick={() => setWide((w) => !w)}
                          className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                          {wide ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                        </button>
                      </Hint>
                    )}
                    <Hint label="New chat">
                      <button type="button" data-testid="ai-new" aria-label="Start a new chat" onClick={newChat}
                        className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><SquarePen className="h-4 w-4" /></button>
                    </Hint>
                    <Hint label="Close">
                      <button type="button" data-testid="ai-close" aria-label="Close the assistant" onClick={close}
                        className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><X className="h-4 w-4" /></button>
                    </Hint>
                  </div>
                </header>

                <div className="relative min-h-0 flex-1">
                  {view === "scheduled" ? <ScheduledView /> : (
                    <>
                      <div ref={list} onScroll={onScroll} role={view === "chat" ? "log" : undefined} aria-live="polite" aria-busy={busy}
                        className="h-full space-y-5 overflow-y-auto overscroll-contain px-4 py-4 [overflow-anchor:none]" data-testid="ai-messages">
                        {view === "activity" ? <ActivityFeed actions={actions} onUndo={undo} /> : (
                          <>
                            {msgs.length === 0 && loadState === "loading" && <ListSkeleton />}
                            {msgs.length === 0 && loadState === "failed" && (
                              <p role="alert" className="pt-8 text-center text-sm text-muted-foreground">Could not load this chat. <button type="button" className="font-medium text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-300" onClick={() => openConversation(sessionId)}>Try again</button></p>
                            )}
                            {msgs.length === 0 && loadState !== "loading" && loadState !== "failed" && <Empty page={page} onPick={(s) => submit(s)} />}
                            {msgs.map((m, i) => <Message key={m.id} m={m} onRetry={retry} last={i === msgs.length - 1} />)}
                          </>
                        )}
                      </div>
                      <AnimatePresence>
                        {!stuck && view === "chat" && msgs.length > 0 && (
                          <motion.button key="jump" type="button" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                            transition={{ duration: reduce ? 0 : 0.15 }} onClick={() => { stick.current = true; setStuck(true); toBottom(true); }}
                            data-testid="ai-jump" aria-label="Jump to the latest message"
                            className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium shadow-lg">
                            <ArrowDown className="h-3.5 w-3.5" />Latest
                          </motion.button>
                        )}
                      </AnimatePresence>
                    </>
                  )}
                </div>

                <div hidden={view !== "chat"}>
                  <Composer ref={composer} value={draft} onChange={setDraft} onSend={() => submit()} onStop={stop} busy={busy} lastSent={lastSent}
                    image={image} onPickImage={pickImage} onClearImage={() => setImage(null)} onScan={scanReceipt} scanning={receipt.scanning}
                    recording={recording} onToggleRecord={toggleRecord} />
                </div>

                <AnimatePresence>
                  {menu && !docked && (
                    <>
                      <motion.div key="menu-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.15 }}
                        onClick={() => setMenu(false)} aria-hidden="true" className="absolute inset-0 z-10 bg-slate-950/25" />
                      <motion.aside key="menu" aria-label="Chats and tools" data-testid="ai-menu-panel" initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
                        transition={reduce ? { duration: 0 } : { type: "spring", damping: 34, stiffness: 380 }}
                        className="absolute inset-y-0 left-0 z-20 w-[min(86%,310px)] border-r border-border bg-background shadow-xl sm:rounded-none max-sm:rounded-tl-3xl">
                        {sidebar}
                      </motion.aside>
                    </>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <ReceiptReview data={receipt.data} open={receipt.open} setOpen={(v) => setReceipt((r) => ({ ...r, open: v }))} />
    </>
  );
}
