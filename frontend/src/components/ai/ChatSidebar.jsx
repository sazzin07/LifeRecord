import { errorMessage } from "@/lib/api";
import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, CalendarClock, History, MoreHorizontal, Pencil, Search, SquarePen, Trash2, WifiOff, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { groupByRecency, useConversations } from "@/components/ai/useConversations";
import { cn } from "@/lib/utils";

const SORTS = [["recent", "Recent"], ["oldest", "Oldest"], ["title", "Title A–Z"]];

function ChatRow({ c, active, onOpen, onRename, onArchive, onDelete, busy }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.title);
  const input = useRef(null);
  useEffect(() => { if (editing) { setDraft(c.title); input.current?.focus(); input.current?.select(); } }, [editing, c.title]);

  const commit = async () => {
    const title = draft.trim();
    setEditing(false);
    if (!title || title === c.title) return;
    try { await onRename(c.id, title); } catch (err) { toast.error(errorMessage(err, "Could not rename that chat")); }
  };

  if (editing) {
    return (
      <div className="px-2 py-1">
        <input ref={input} value={draft} maxLength={120} aria-label="Chat name" data-testid="ai-rename-input"
          onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); } }}
          className="w-full rounded-lg border border-emerald-500/60 bg-background px-2.5 py-1.5 text-sm outline-none ring-2 ring-emerald-500/20" />
      </div>
    );
  }
  return (
    <div data-testid="ai-chat-item" className={cn("group/row relative rounded-xl transition-colors", active ? "bg-emerald-50 dark:bg-emerald-500/10" : "hover:bg-muted/70")}>
      <button type="button" data-testid="ai-chat-row" aria-current={active ? "true" : undefined} onClick={() => onOpen(c.id)} disabled={busy && !active}
        className="block w-full min-w-0 rounded-xl px-3 py-2 pr-9 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:cursor-not-allowed disabled:opacity-60">
        <span className={cn("block truncate text-[13.5px] leading-5", active ? "font-semibold text-emerald-900 dark:text-emerald-100" : "font-medium")}>{c.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{c.preview || "No messages yet"}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`Options for ${c.title}`} data-testid="ai-chat-menu"
            className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100 max-sm:opacity-100">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => setEditing(true)}><Pencil className="mr-2 h-4 w-4" />Rename</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onArchive(c)}>
            {c.archived ? <ArchiveRestore className="mr-2 h-4 w-4" /> : <Archive className="mr-2 h-4 w-4" />}{c.archived ? "Restore" : "Archive"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onDelete(c)} className="text-red-600 focus:text-red-600"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * The assistant's menu: new chat, the scheduled-tasks and activity views, and the saved chats (search, sort, archive).
 * `chat` carries the active conversation so deleting it starts a fresh one.
 */
export function ChatSidebar({ view, onView, activeId, busy, onNew, onOpen, onDeleted, scheduledCount, offline }) {
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState("recent");
  const [pendingDelete, setPendingDelete] = useState(null);
  const list = useConversations({ query, archived, sort });
  const items = list.items;
  const groups = sort === "recent" ? groupByRecency(items || []) : [{ label: sort === "oldest" ? "Oldest first" : "A to Z", items: items || [] }].filter((g) => g.items.length);

  const archive = async (c) => {
    try { await list.archive(c.id, !c.archived); toast.success(c.archived ? "Chat restored" : "Chat archived"); }
    catch (err) { toast.error(errorMessage(err, "Could not update that chat")); }
  };
  const confirmDelete = async () => {
    const c = pendingDelete;
    setPendingDelete(null);
    try { await list.remove(c.id); toast.success("Chat deleted"); if (c.id === activeId) onDeleted(); }
    catch (err) { toast.error(errorMessage(err, "Could not delete that chat")); }
  };
  const nav = (id, label, Icon, badge) => (
    <button type="button" onClick={() => onView(id)} data-testid={`ai-nav-${id}`} aria-current={view === id ? "page" : undefined}
      className={cn("flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
        view === id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground")}>
      <Icon className="h-4 w-4" />{label}
      {badge > 0 && <span className="ml-auto rounded-full bg-emerald-100 px-1.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">{badge}</span>}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="ai-sidebar">
      <div className="space-y-1 p-3">
        <button type="button" onClick={onNew} data-testid="ai-sidebar-new"
          className="flex w-full items-center gap-2.5 rounded-xl bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700">
          <SquarePen className="h-4 w-4" />New chat
        </button>
        <div className="pt-1">
          {nav("scheduled", "Scheduled tasks", CalendarClock, scheduledCount)}
          {nav("activity", "Activity", History)}
        </div>
      </div>

      <div className="flex items-center gap-1.5 px-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search chats" data-testid="ai-search"
            className="h-9 w-full rounded-xl border border-border bg-background pl-8 pr-8 text-sm outline-none transition-shadow placeholder:text-muted-foreground focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20" />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger aria-label="Sort chats" className="h-9 w-[104px] shrink-0 rounded-xl px-2.5 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{SORTS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <div className="mt-2 flex items-center justify-between px-4">
        <p className="text-xs font-medium text-muted-foreground">{archived ? "Archived chats" : "Chats"}</p>
        <button type="button" onClick={() => setArchived((a) => !a)} data-testid="ai-archived-toggle" aria-pressed={archived}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <Archive className="h-3 w-3" />{archived ? "Back to chats" : "Archived"}
        </button>
      </div>

      {offline && (
        <p className="mx-3 mt-1 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" role="status">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />You are offline. Showing the chats last seen.
        </p>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-2 pb-3 pt-1" data-testid="ai-chat-list" aria-busy={list.loading}>
        {items === null && list.loading && (
          <div className="space-y-2 px-1 pt-1" aria-hidden="true">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-12 w-full" />)}</div>
        )}
        {items !== null && items.length === 0 && (
          <p className="px-3 pt-6 text-center text-sm text-muted-foreground" data-testid="ai-chat-list-empty">
            {query ? `No chats match “${query}”.` : archived ? "Nothing archived." : "Your chats are saved here as you go."}
          </p>
        )}
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <h3 className="px-3 pb-1 text-[11px] font-medium text-muted-foreground">{g.label}</h3>
            {g.items.map((c) => (
              <ChatRow key={c.id} c={c} active={c.id === activeId && view === "chat"} busy={busy} onOpen={onOpen}
                onRename={list.rename} onArchive={archive} onDelete={setPendingDelete} />
            ))}
          </section>
        ))}
      </div>

      <ConfirmDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)} title="Delete this chat?"
        description={pendingDelete ? `“${pendingDelete.title}” and its ${pendingDelete.message_count} messages will be removed for good. Archive it instead if you may want it later.` : ""}
        confirmText="Delete chat" onConfirm={confirmDelete} />
    </div>
  );
}
