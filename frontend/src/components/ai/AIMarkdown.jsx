import { Children, cloneElement, isValidElement, memo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { MONEY, isNumericCell, normaliseMoney, tidyMarkdown } from "@/lib/aiFormat";
import { cn } from "@/lib/utils";

// Amounts are set like ledger entries: monospaced, tabular, slightly heavier. This is the one flourish in the panel.
function withMoney(children) {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      return child.split(MONEY).map((part, i) => (i % 2 === 1
        ? <span key={i} className="lm-money">{normaliseMoney(part)}</span>
        : part));
    }
    if (isValidElement(child) && child.props.children && typeof child.type === "string" && child.type !== "code") {
      return cloneElement(child, undefined, withMoney(child.props.children));
    }
    return child;
  });
}

const textOf = (node) => Children.toArray(node).map((c) => (typeof c === "string" ? c : isValidElement(c) ? textOf(c.props.children) : "")).join("");

function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(textOf(children)); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  };
  return (
    <div className="group/code relative my-2">
      <pre className="overflow-x-auto rounded-xl border border-border bg-muted/60 p-3 pr-10 text-[12.5px] leading-relaxed font-mono">{children}</pre>
      <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy code"}
        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg border border-border bg-card text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/code:opacity-100">
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

const safeHref = (href = "") => /^(https?:|mailto:|\/)/i.test(href);

const components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{withMoney(children)}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-emerald-600/70">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{withMoney(children)}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{withMoney(children)}</strong>,
  em: ({ children }) => <em>{withMoney(children)}</em>,
  h1: ({ children }) => <h3 className="mb-1.5 mt-4 text-[15px] font-semibold tracking-tight first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1.5 mt-4 text-[15px] font-semibold tracking-tight first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mb-1 mt-3 text-sm font-semibold first:mt-0">{children}</h4>,
  hr: () => <hr className="my-3 border-border" />,
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-emerald-500/50 pl-3 text-muted-foreground">{children}</blockquote>,
  a: ({ href, children }) => (safeHref(href)
    ? <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-emerald-700 underline decoration-emerald-600/30 underline-offset-2 hover:decoration-emerald-600 dark:text-emerald-300">{children}</a>
    : <span>{children}</span>),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ className, children }) => (className
    ? <code className={className}>{children}</code>
    : <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[12.5px]">{children}</code>),
  table: ({ children }) => (
    <div className="my-2.5 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60 text-muted-foreground">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-border last:border-0">{children}</tr>,
  th: ({ children }) => <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium">{children}</th>,
  td: ({ children }) => {
    const numeric = isNumericCell(textOf(children));
    return <td className={cn("px-3 py-2 align-top", numeric && "whitespace-nowrap text-right tabular-nums")}>{withMoney(children)}</td>;
  },
};

/** Renders an assistant reply. `streaming` hides half-typed bold markers so they do not flash as asterisks. */
export const AIMarkdown = memo(function AIMarkdown({ text, streaming = false }) {
  return (
    <div className="lm-ai-prose break-words text-[14px] leading-[1.6] text-foreground">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>{tidyMarkdown(text, { streaming })}</Markdown>
    </div>
  );
});
