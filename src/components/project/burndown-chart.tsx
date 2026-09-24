"use client";

import { useState } from "react";
import { format } from "date-fns";
import type { Burndown } from "@/lib/planning";
import { cn } from "@/lib/utils";

// Remaining tasks over time against the straight "plan" line. Two series, one
// axis, 2px lines, hairline grid, a legend, a couple of direct labels, a
// crosshair tooltip and a table view so nothing depends on hover or color.

const W = 640;
const H = 264;
const PAD = { l: 40, r: 30, t: 26, b: 34 };

const behindText = (diff: number) => (diff > 0 ? `${diff} behind plan` : diff < 0 ? `${-diff} ahead of plan` : "On plan");

export function BurndownChart({ data }: { data: Burndown }) {
  const [hover, setHover] = useState<number | null>(null);
  const [view, setView] = useState<"chart" | "table">("chart");

  const { points, total } = data;
  const t0 = points[0].date.getTime();
  const t1 = points[points.length - 1].date.getTime();
  const x = (d: Date) => PAD.l + ((d.getTime() - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / Math.max(1, total)) * (H - PAD.t - PAD.b);

  const actualPts = points.filter(p => p.actual !== null);
  const last = actualPts[actualPts.length - 1] ?? points[0];
  const actualPath = actualPts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)} ${y(p.actual as number).toFixed(1)}`).join(" ");
  const areaPath = actualPts.length > 1
    ? `${actualPath} L${x(last.date).toFixed(1)} ${y(0)} L${x(actualPts[0].date).toFixed(1)} ${y(0)} Z`
    : "";

  const step = Math.max(1, Math.ceil(total / 4));
  const ticks: number[] = [];
  for (let v = 0; v < total; v += step) ticks.push(v);
  ticks.push(total);

  const dueLabel = format(points[points.length - 1].date, "d MMM");
  const lastX = x(last.date);
  const labelLeft = lastX > W * 0.7;
  const remaining = last.actual ?? total;
  const planAtLast = Math.round(last.plan);
  const showPlanLabel = Math.abs(y(remaining) - y(last.plan)) > 16;

  // hit bands: each point owns the space up to the midpoint with its neighbours
  const bands = points.map((p, i) => {
    const left = i === 0 ? PAD.l : (x(points[i - 1].date) + x(p.date)) / 2;
    const right = i === points.length - 1 ? W - PAD.r : (x(p.date) + x(points[i + 1].date)) / 2;
    return { x: left, w: Math.max(4, right - left) };
  });

  const tip = hover !== null ? points[hover] : null;
  const tipLeftPct = tip ? (x(tip.date) / W) * 100 : 0;
  const tipRight = tip ? x(tip.date) > W * 0.6 : false;

  const paceText = (() => {
    if (data.remaining === 0) return "Every task is done.";
    const needed = data.neededPerDay;
    const parts: string[] = [];
    if (data.forecast) {
      const late = data.forecastDaysLate ?? 0;
      parts.push(
        `At the current pace (${data.currentPerDay.toFixed(2)} tasks/day) this finishes around ${format(data.forecast, "d MMM")}` +
          (late > 0 ? ` - ${late} day${late === 1 ? "" : "s"} after the due date.` : " - on time."),
      );
    } else {
      parts.push("Not enough completed tasks yet to forecast a finish date.");
    }
    if (needed !== null && needed > 0) parts.push(`Finishing by ${dueLabel} takes ${needed.toFixed(2)} tasks/day.`);
    return parts.join(" ");
  })();

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-2"><span className="h-0.5 w-4 rounded bg-info" aria-hidden />Actual remaining</span>
          <span className="flex items-center gap-2"><span className="h-0.5 w-4 rounded bg-muted-foreground" aria-hidden />Plan</span>
        </div>
        <div role="group" aria-label="Chart or table" className="flex gap-1">
          {(["chart", "table"] as const).map(v => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                "h-7 rounded-full border px-3 font-mono text-[11px] capitalize transition-colors",
                view === v ? "border-foreground bg-foreground text-background" : "border-foreground/15 text-muted-foreground hover:bg-foreground/5",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "chart" ? (
        <div className="relative" onMouseLeave={() => setHover(null)}>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label={`Burndown chart. ${remaining} of ${total} tasks remaining; the plan line expects ${planAtLast}. ${behindText(remaining - planAtLast)}.`}
          >
            {ticks.map(v => (
              <g key={v}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-foreground/10" strokeWidth={1} />
                <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="fill-muted-foreground font-mono text-[11px]">{v}</text>
              </g>
            ))}

            <line x1={x(points[0].date)} y1={y(points[0].plan)} x2={x(points[points.length - 1].date)} y2={y(0)} className="stroke-muted-foreground" strokeWidth={2} strokeLinecap="round" />

            {areaPath && <path d={areaPath} className="fill-info/10" />}
            {actualPath && <path d={actualPath} className="fill-none stroke-info" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}

            <line x1={lastX} x2={lastX} y1={PAD.t} y2={H - PAD.b} className="stroke-foreground/25" strokeWidth={1} />
            <text x={lastX} y={PAD.t - 10} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px] uppercase">Today</text>

            {showPlanLabel && (
              <>
                <circle cx={lastX} cy={y(last.plan)} r={4.5} className="fill-muted-foreground stroke-background" strokeWidth={2} />
                <text x={labelLeft ? lastX - 10 : lastX + 10} y={y(last.plan) + (y(last.plan) > y(remaining) ? 15 : -8)} textAnchor={labelLeft ? "end" : "start"} className="fill-muted-foreground text-[11.5px]">
                  Plan · {planAtLast} left
                </text>
              </>
            )}
            <circle cx={lastX} cy={y(remaining)} r={4.5} className="fill-info stroke-background" strokeWidth={2} />
            <text x={labelLeft ? lastX - 10 : lastX + 10} y={y(remaining) + (y(remaining) > y(last.plan) ? 15 : -8)} textAnchor={labelLeft ? "end" : "start"} className="fill-foreground text-[11.5px] font-semibold">
              Actual · {remaining} left
            </text>

            {points.map((p, i) => (
              <text key={p.date.getTime()} x={x(p.date)} y={H - 10} textAnchor="middle" className={cn("font-mono text-[10.5px]", i === points.length - 1 ? "fill-foreground font-semibold" : "fill-muted-foreground")}>
                {p.label}
              </text>
            ))}

            {tip && <line x1={x(tip.date)} x2={x(tip.date)} y1={PAD.t} y2={H - PAD.b} className="stroke-foreground/40" strokeWidth={1} />}
            {tip && tip.actual !== null && <circle cx={x(tip.date)} cy={y(tip.actual)} r={4.5} className="fill-info stroke-background" strokeWidth={2} />}

            {bands.map((b, i) => (
              <rect
                key={i}
                x={b.x}
                y={PAD.t}
                width={b.w}
                height={H - PAD.t - PAD.b}
                fill="transparent"
                tabIndex={0}
                aria-label={`${points[i].label}: ${points[i].actual ?? "-"} actual, ${Math.round(points[i].plan)} planned`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            ))}
          </svg>

          {tip && (
            <div
              className="pointer-events-none absolute top-2 z-10 w-44 rounded-xl border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg"
              style={{ left: `${tipLeftPct}%`, transform: `translateX(${tipRight ? "calc(-100% - 12px)" : "12px"})` }}
            >
              <p className="text-muted-foreground">{format(tip.date, "d MMM yyyy")}</p>
              {tip.actual !== null && (
                <p className="mt-2 flex items-center gap-2">
                  <span className="h-0.5 w-3.5 rounded bg-info" aria-hidden />
                  <span className="font-mono text-sm font-bold text-foreground">{tip.actual}</span>
                  <span className="text-muted-foreground">actual left</span>
                </p>
              )}
              <p className="mt-1.5 flex items-center gap-2">
                <span className="h-0.5 w-3.5 rounded bg-muted-foreground" aria-hidden />
                <span className="font-mono text-sm font-bold text-foreground">{Math.round(tip.plan)}</span>
                <span className="text-muted-foreground">plan left</span>
              </p>
              {tip.actual !== null && <p className="mt-2 font-semibold text-foreground">{behindText(tip.actual - Math.round(tip.plan))}</p>}
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Date</th>
                <th className="py-2 pr-4 font-medium">Actual left</th>
                <th className="py-2 pr-4 font-medium">Plan left</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {points.map(p => (
                <tr key={p.date.getTime()} className="border-t border-border">
                  <td className="py-2 pr-4 text-foreground">{format(p.date, "d MMM yyyy")}</td>
                  <td className="py-2 pr-4 font-mono tabular-nums text-foreground">{p.actual ?? "-"}</td>
                  <td className="py-2 pr-4 font-mono tabular-nums text-muted-foreground">{Math.round(p.plan)}</td>
                  <td className="py-2 text-muted-foreground">{p.actual === null ? "Planned" : behindText(p.actual - Math.round(p.plan))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{paceText}</p>
    </div>
  );
}
