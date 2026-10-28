import { memo, useState } from "react";
import { AlertCircle, Check, Copy, RotateCcw, Sparkles } from "lucide-react";
import { AIMarkdown } from "@/components/ai/AIMarkdown";
import { AuthImage } from "@/components/ai/AuthImage";
import { Hint } from "@/components/ui/hint";
import { changeSummary, failedActions } from "@/lib/aiFormat";

function Mark() {
  return (
    <div aria-hidden="true" className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
      <Sparkles className="h-3.5 w-3.5" />
    </div>
  );
}

function Typing({ label }) {
  return (
    <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground" data-testid="ai-typing">
      <span className="lm-typing" aria-hidden="true"><i /><i /><i /></span>
      <span>{label || "Thinking…"}</span>
    </div>
  );
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* clipboard blocked */ }
  };
  return (
    <Hint label={done ? "Copied" : "Copy reply"}>
      <button type="button" onClick={copy} aria-label="Copy reply" data-testid="ai-copy"
        className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
        {done ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </Hint>
  );
}

function UserMessage({ m }) {
  return (
    <div className="flex justify-end" data-testid="ai-message-user">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-emerald-600 px-3.5 py-2.5 text-[14px] leading-relaxed text-white shadow-sm">
        {m.image && <AuthImage src={m.image} />}
        {m.text && m.text !== "(image)" && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
      </div>
    </div>
  );
}

function AssistantMessage({ m, onRetry, last }) {
  const streaming = m.status === "streaming";
  const changes = changeSummary(m.actions);
  const failed = failedActions(m.actions);
  return (
    <div className="flex gap-2.5" data-testid="ai-message-assistant" data-status={m.status}>
      <Mark />
      <div className="min-w-0 flex-1">
        {streaming && !m.text && <Typing label={m.tool} />}
        {m.text && (
          <div className={streaming ? "lm-streaming" : undefined}>
            <AIMarkdown text={m.text} streaming={streaming} />
          </div>
        )}
        {streaming && m.text && m.tool && <p className="mt-1 text-xs text-muted-foreground">{m.tool}</p>}

        {changes.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Changes made" data-testid="ai-changes">
            {changes.map((c) => (
              <li key={c} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
                <Check className="h-3 w-3" />{c}
              </li>
            ))}
          </ul>
        )}
        {failed.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{failed.length === 1 ? "One step did not go through." : `${failed.length} steps did not go through.`} Nothing was changed for {failed.length === 1 ? "it" : "them"}.</span>
          </p>
        )}

        {m.status === "error" && (
          <div role="alert" className="mt-1 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200" data-testid="ai-error">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p>{m.error}</p>
              <button type="button" onClick={() => onRetry(m.id)} data-testid="ai-retry"
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline">
                <RotateCcw className="h-3 w-3" />Try again
              </button>
            </div>
          </div>
        )}
        {m.status === "stopped" && <p className="mt-1 text-xs text-muted-foreground">Stopped</p>}

        {m.status === "done" && m.text && (
          <div className={`mt-1 -ml-1.5 flex items-center gap-0.5 transition-opacity ${last ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover/msg:opacity-100"}`}>
            <CopyButton text={m.text} />
          </div>
        )}
      </div>
    </div>
  );
}

export const Message = memo(function Message({ m, onRetry, last }) {
  return (
    <div className="group/msg">
      {m.role === "user" ? <UserMessage m={m} /> : <AssistantMessage m={m} onRetry={onRetry} last={last} />}
    </div>
  );
});
