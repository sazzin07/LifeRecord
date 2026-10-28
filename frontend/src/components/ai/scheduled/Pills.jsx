import { cn } from "@/lib/utils";
import { DELIVERY, RUN_STATUS, TASK_STATUS, TONES } from "@/components/ai/scheduled/scheduleUtils";

export function Pill({ tone = "slate", children, live, className, ...rest }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", TONES[tone], className)} {...rest}>
      {live && <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full rounded-full bg-current opacity-60 motion-safe:animate-ping" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" /></span>}
      {children}
    </span>
  );
}

export const TaskStatusPill = ({ status }) => <Pill tone={(TASK_STATUS[status] || TASK_STATUS.draft).tone} data-testid="task-status">{(TASK_STATUS[status] || TASK_STATUS.draft).label}</Pill>;
export const RunStatusPill = ({ status }) => {
  const s = RUN_STATUS[status] || RUN_STATUS.failed;
  return <Pill tone={s.tone} live={status === "running" || status === "queued"} data-testid="run-status">{s.label}</Pill>;
};
export const DeliveryPill = ({ status }) => {
  const s = DELIVERY[status] || DELIVERY.none;
  return <Pill tone={s.tone} live={status === "sending" || status === "pending"} data-testid="delivery-status">{s.label}</Pill>;
};
