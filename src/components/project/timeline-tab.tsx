"use client";

import { addDays, differenceInCalendarDays, format, max as maxDate, min as minDate, parseISO, startOfDay } from "date-fns";
import { projectStart } from "@/lib/planning";
import { Card, CardContent } from "@/components/ui/card";
import { PanelHeader } from "@/components/hub-ui";
import { cn } from "@/lib/utils";
import { milestoneStates } from "./milestones";
import type { Cockpit } from "./use-cockpit";

const LABEL_W = "w-[190px]";

export function TimelineTab({ cockpit, goTo }: { cockpit: Cockpit; goTo: (tab: string) => void }) {
  const { project, milestones, tasks } = cockpit;
  if (!project) return null;

  const today = startOfDay(new Date());
  const pStart = projectStart(project);
  const pEnd = project.due_date ? startOfDay(parseISO(project.due_date)) : null;
  const datedTasks = tasks.filter(t => t.due_date);

  const allDates = [
    pStart,
    today,
    ...(pEnd ? [pEnd] : []),
    ...milestones.flatMap(m => [parseISO(m.due_date), ...(m.start_date ? [parseISO(m.start_date)] : [])]),
    ...datedTasks.map(t => parseISO(t.due_date as string)),
  ];
  const start = addDays(minDate(allDates), -2);
  const end = addDays(maxDate(allDates), 4);
  const span = Math.max(1, differenceInCalendarDays(end, start));
  const pct = (d: Date) => Math.min(100, Math.max(0, (differenceInCalendarDays(d, start) / span) * 100));
  const width = (a: Date, b: Date) => Math.max(1.2, pct(b) - pct(a));

  // week markers on Mondays
  const weeks: Date[] = [];
  for (let d = addDays(start, (8 - start.getDay()) % 7); d <= end; d = addDays(d, 7)) weeks.push(d);

  const states = milestoneStates(milestones, today);
  const todayPct = pct(today);

  const barCls: Record<string, string> = {
    done: "border-ok/50 bg-ok-soft",
    late: "border-bad/50 bg-bad-soft",
    current: "border-info/50 bg-info-soft",
    upcoming: "border-foreground/20 bg-foreground/[0.06]",
  };
  const stateWord: Record<string, string> = { done: "Done", late: "Late", current: "In progress", upcoming: "Upcoming" };

  const grid = (
    <>
      {weeks.map(w => <span key={w.getTime()} className="absolute inset-y-0 w-px bg-foreground/[0.07]" style={{ left: `${pct(w)}%` }} aria-hidden />)}
      <span className="absolute inset-y-0 w-px bg-foreground/35" style={{ left: `${todayPct}%` }} aria-hidden />
    </>
  );

  const rows: { key: string; label: string; sub: string; subCls?: string; bar?: { a: Date; b: Date; cls: string; title: string } }[] = [];
  if (pEnd) {
    rows.push({
      key: "project",
      label: "Whole project",
      sub: `${format(pStart, "d MMM")} - ${format(pEnd, "d MMM")}`,
      bar: { a: pStart, b: pEnd, cls: "border-foreground/25 bg-foreground/[0.08]", title: "Project start to due date" },
    });
  }
  let prevEnd = pStart;
  for (const m of milestones) {
    const due = parseISO(m.due_date);
    const from = m.start_date ? parseISO(m.start_date) : minDate([prevEnd, due]);
    const s = states.get(m.id) ?? "upcoming";
    rows.push({
      key: m.id,
      label: m.title,
      sub: stateWord[s],
      subCls: s === "late" ? "text-bad font-semibold" : s === "current" ? "text-info" : s === "done" ? "text-ok" : undefined,
      bar: { a: from, b: due, cls: barCls[s], title: `${m.title}: ${format(from, "d MMM")} - ${format(due, "d MMM")}` },
    });
    prevEnd = due;
  }

  const empty = rows.length === 0 && datedTasks.length === 0;

  return (
    <Card>
      <CardContent>
        <PanelHeader title="Timeline" aside={`${format(start, "d MMM")} - ${format(end, "d MMM yyyy")}`} />
        {empty ? (
          <p className="text-sm text-muted-foreground">
            Nothing to plot yet. Set a due date, add milestones in the{" "}
            <button type="button" onClick={() => goTo("overview")} className="text-foreground underline underline-offset-4">Overview</button>, or give tasks due dates.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[720px]">
              <div className="flex">
                <div className={cn(LABEL_W, "shrink-0")} />
                <div className="relative h-7 flex-1">
                  {weeks.map(w => (
                    <span key={w.getTime()} className="absolute top-0 -translate-x-1/2 font-mono text-[10.5px] text-muted-foreground" style={{ left: `${pct(w)}%` }}>
                      {format(w, "d MMM")}
                    </span>
                  ))}
                  <span
                    className="absolute top-0 -translate-x-1/2 rounded-full bg-foreground px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase text-background"
                    style={{ left: `${todayPct}%` }}
                  >
                    Today
                  </span>
                </div>
              </div>

              {rows.map(r => (
                <div key={r.key} className="flex border-t border-border">
                  <div className={cn(LABEL_W, "shrink-0 py-2.5 pr-3")}>
                    <p className="truncate text-[13.5px] font-semibold text-foreground">{r.label}</p>
                    <p className={cn("text-xs text-muted-foreground", r.subCls)}>{r.sub}</p>
                  </div>
                  <div className="relative h-14 flex-1">
                    {grid}
                    {r.bar && (
                      <div
                        title={r.bar.title}
                        className={cn("absolute top-4 h-6 rounded-lg border", r.bar.cls)}
                        style={{ left: `${pct(r.bar.a)}%`, width: `${width(r.bar.a, r.bar.b)}%` }}
                      />
                    )}
                  </div>
                </div>
              ))}

              <div className="flex border-t border-border">
                <div className={cn(LABEL_W, "shrink-0 py-2.5 pr-3")}>
                  <p className="text-[13.5px] font-semibold text-foreground">Task due dates</p>
                  <p className="text-xs text-muted-foreground">{datedTasks.length} of {tasks.length} tasks dated</p>
                </div>
                <div className="relative h-14 flex-1">
                  {grid}
                  {datedTasks.map(t => {
                    const due = parseISO(t.due_date as string);
                    const overdue = t.status !== "done" && differenceInCalendarDays(today, due) > 0;
                    return (
                      <span
                        key={t.id}
                        title={`${t.title} - ${format(due, "d MMM")}${t.status === "done" ? " (done)" : overdue ? " (overdue)" : ""}`}
                        className={cn(
                          "absolute top-[22px] size-3 -translate-x-1/2 rounded-full border-2 border-background",
                          t.status === "done" ? "bg-ok" : overdue ? "bg-bad" : "bg-info",
                        )}
                        style={{ left: `${pct(due)}%` }}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
        {!empty && (
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-ok" />done</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-info" />open</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-bad" />overdue</span>
            <span>Hover a bar or dot for details.</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
