import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Employee } from "@/types";
import type { HealthState } from "@/lib/portfolio";

// Small presentational pieces shared by the agency views (Command Center now,
// Project Cockpit and My Day next). Status colors come from the theme tokens
// (--ok/--warn/--bad/--info/--violet) so every piece reads in light and dark.

const AVATAR_COLORS = ["#2fbf71", "#5aa9ff", "#b39bff", "#f5b73b", "#ff8fa3", "#4fd1c5"];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ employee, size = 26, className }: { employee: Pick<Employee, "id" | "full_name">; size?: number; className?: string }) {
  return (
    <span
      title={employee.full_name}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-mono font-bold text-[#07130d]", className)}
      style={{ width: size, height: size, background: AVATAR_COLORS[hashId(employee.id) % AVATAR_COLORS.length], fontSize: Math.round(size * 0.38) }}
    >
      {initials(employee.full_name)}
    </span>
  );
}

export function AvatarStack({ people, max = 4, size = 26 }: { people: Pick<Employee, "id" | "full_name">[]; max?: number; size?: number }) {
  if (people.length === 0) return <span className="text-xs font-semibold text-bad">Unassigned</span>;
  const shown = people.slice(0, max);
  const extra = people.length - shown.length;
  return (
    <span className="inline-flex items-center pl-1.5">
      {shown.map(p => (
        <Avatar key={p.id} employee={p} size={size} className="-ml-1.5 ring-2 ring-card" />
      ))}
      {extra > 0 && (
        <span className="-ml-1.5 inline-flex items-center justify-center rounded-full bg-foreground/15 font-mono text-[10px] font-bold text-foreground ring-2 ring-card" style={{ width: size, height: size }}>
          +{extra}
        </span>
      )}
    </span>
  );
}

const HEALTH_STYLE: Record<HealthState, { box: string; dot: string }> = {
  ok: { box: "bg-ok-soft text-ok", dot: "bg-ok" },
  risk: { box: "bg-warn-soft text-warn", dot: "bg-warn" },
  late: { box: "bg-bad-soft text-bad", dot: "bg-bad" },
  none: { box: "bg-foreground/10 text-muted-foreground", dot: "bg-muted-foreground" },
  done: { box: "bg-info-soft text-info", dot: "bg-info" },
};

export function HealthPill({ state, label, title }: { state: HealthState; label: string; title?: string }) {
  const s = HEALTH_STYLE[state];
  return (
    <span title={title} className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", s.box)}>
      <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
      {label}
    </span>
  );
}

export type ChipType = "progress" | "note" | "blocker" | "decision" | "done" | "late" | "overdue" | "stale" | "noplan";

const CHIP_STYLE: Record<ChipType, string> = {
  progress: "bg-info-soft text-info",
  note: "bg-foreground/10 text-muted-foreground",
  blocker: "bg-warn-soft text-warn",
  decision: "bg-violet-soft text-violet",
  done: "bg-ok-soft text-ok",
  late: "bg-bad-soft text-bad",
  overdue: "bg-bad-soft text-bad",
  stale: "bg-foreground/10 text-muted-foreground",
  noplan: "bg-violet-soft text-violet",
};

const CHIP_LABEL: Record<ChipType, string> = {
  progress: "Progress", note: "Note", blocker: "Blocker", decision: "Decision", done: "Done",
  late: "Late", overdue: "Overdue", stale: "Stale", noplan: "No plan",
};

export function TypeChip({ type }: { type: ChipType }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.08em]", CHIP_STYLE[type])}>
      {CHIP_LABEL[type]}
    </span>
  );
}

const BAR_TONE: Record<"ok" | "warn" | "bad" | "info" | "muted", string> = {
  ok: "bg-ok", warn: "bg-warn", bad: "bg-bad", info: "bg-info", muted: "bg-muted-foreground",
};

export function ProgressBar({ value, tone = "ok", className }: { value: number; tone?: keyof typeof BAR_TONE; className?: string }) {
  const width = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={cn("h-1.5 rounded-full bg-foreground/10", className)}>
      <div className={cn("h-full rounded-full transition-all", BAR_TONE[tone])} style={{ width: `${width}%` }} />
    </div>
  );
}

export function healthTone(state: HealthState): keyof typeof BAR_TONE {
  if (state === "ok") return "ok";
  if (state === "risk") return "warn";
  if (state === "late") return "bad";
  if (state === "done") return "info";
  return "muted";
}

export function KpiTile({ label, value, sub, valueClassName, children }: { label: string; value?: ReactNode; sub?: ReactNode; valueClassName?: string; children?: ReactNode }) {
  return (
    <div className="glass-panel glass-panel--tile flex min-w-0 flex-col gap-2 p-4">
      <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      {value !== undefined && <p className={cn("font-mono text-3xl font-bold leading-none text-foreground", valueClassName)}>{value}</p>}
      {children}
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function PanelHeader({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-mono text-[15px] font-semibold text-foreground">{title}</h2>
      {aside && <div className="text-xs text-muted-foreground">{aside}</div>}
    </div>
  );
}
