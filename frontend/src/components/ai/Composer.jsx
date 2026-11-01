import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { ArrowUp, Mic, Paperclip, ScanLine, Square, X } from "lucide-react";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";

const MAX_HEIGHT = 168;

/**
 * Message box. Enter sends, Shift+Enter adds a line, ArrowUp in an empty box recalls your last message.
 * The box grows with the text and the draft is kept by the parent, so closing the panel never loses it.
 */
export const Composer = forwardRef(function Composer(
  { value, onChange, onSend, onStop, busy, image, imageLoading, onPickImage, onClearImage, onScan, scanning, recording, onToggleRecord, lastSent },
  ref,
) {
  const area = useRef(null);
  const file = useRef(null);
  useImperativeHandle(ref, () => ({ focus: () => area.current?.focus({ preventScroll: true }) }));

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  useEffect(() => { if (!value && area.current) area.current.style.height = "auto"; }, [value]);

  const canSend = !busy && (value.trim() || image);
  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (canSend) onSend(); }
    else if (e.key === "ArrowUp" && !value && lastSent) { e.preventDefault(); onChange(lastSent); }
  };

  return (
    <div className="border-t border-border bg-background/60 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      {imageLoading && !image && (
        <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-border bg-card p-2 text-xs text-muted-foreground" role="status" data-testid="ai-image-loading">
          <span className="h-10 w-10 animate-pulse rounded-lg bg-muted" aria-hidden="true" /><span>Reading the image…</span>
        </div>
      )}
      {image && (
        <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-border bg-card p-2 text-xs text-muted-foreground">
          <img src={image} alt="Attached preview" className="h-10 w-10 rounded-lg object-cover" />
          <span>Image attached</span>
          <button type="button" onClick={onScan} disabled={scanning} data-testid="ai-scan-receipt"
            className="ml-auto inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1.5 font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50">
            <ScanLine className="h-3.5 w-3.5" />{scanning ? "Reading…" : "Scan receipt"}
          </button>
          <button type="button" onClick={onClearImage} aria-label="Remove image" className="grid h-7 w-7 place-items-center rounded-lg hover:bg-muted">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-1.5 rounded-2xl border border-border bg-card p-1.5 transition-shadow focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/20">
        <input ref={file} type="file" accept="image/*" className="hidden" data-testid="ai-file-input"
          onChange={(e) => { onPickImage(e); e.target.value = ""; }} />
        <Hint label="Attach an image">
          <button type="button" data-testid="ai-attach" aria-label="Attach an image" onClick={() => file.current?.click()}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <Paperclip className="h-4 w-4" />
          </button>
        </Hint>
        <Hint label={recording ? "Stop recording" : "Speak a message"}>
          <button type="button" data-testid="ai-mic" aria-label={recording ? "Stop recording" : "Speak a message"} aria-pressed={recording} onClick={onToggleRecord}
            className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors",
              recording ? "bg-red-500 text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {recording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-4 w-4" />}
          </button>
        </Hint>
        <textarea ref={area} data-testid="ai-input" value={value} rows={1} aria-label="Message" enterKeyHint="send"
          placeholder="Ask Life Record…"
          onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown}
          className="max-h-[168px] min-h-9 flex-1 resize-none bg-transparent px-1.5 py-2 text-[14px] leading-5 outline-none placeholder:text-muted-foreground" />
        {busy ? (
          <Hint label="Stop">
            <button type="button" data-testid="ai-stop" aria-label="Stop the reply" onClick={onStop}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-foreground text-background transition-transform active:scale-95">
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          </Hint>
        ) : (
          <button type="button" data-testid="ai-send" aria-label="Send message" onClick={onSend} disabled={!canSend}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-700 text-white transition-all hover:bg-emerald-700 active:scale-95 disabled:bg-muted disabled:text-muted-foreground">
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
      </div>
      <p className="mt-1.5 hidden px-1 text-[11px] text-muted-foreground sm:block">Enter to send · Shift+Enter for a new line · Esc to close</p>
    </div>
  );
});
