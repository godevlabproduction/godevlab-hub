"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, startOfDay, subDays } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import {
  getAllProjectTasks, getEmployeeTasks, getEmployees, getProjects, getTimeEntries, updateEmployeeCapacity,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import {
  buildCapacityGrid, isOver, loadLevel, loadPercent, loggedHoursByEmployee, mostLoaded, parseDue, percentLabel,
  type CapacityCell, type CapacityColumn, type CapacityTask, type LoadLevel,
} from "@/lib/capacity";
import { TASK_STATUS_LABEL, dueBucket, formatHours } from "@/lib/planning";
import { Avatar, KpiTile, PanelHeader, ProgressBar } from "@/components/hub-ui";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Employee } from "@/types";

const MAX_CAPACITY = 80;

const TASK_COLS =
  "grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.9fr)] items-center gap-x-4";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const LEVEL_STYLE: Record<LoadLevel, { box: string; text: string; tone: "muted" | "ok" | "warn" | "bad" }> = {
  neutral: { box: "bg-foreground/5 enabled:hover:bg-foreground/10", text: "text-muted-foreground", tone: "muted" },
  ok: { box: "bg-ok-soft enabled:hover:ring-1 enabled:hover:ring-ok/40", text: "text-ok", tone: "ok" },
  warn: { box: "bg-warn-soft enabled:hover:ring-1 enabled:hover:ring-warn/40", text: "text-warn", tone: "warn" },
  bad: { box: "bg-bad-soft enabled:hover:ring-1 enabled:hover:ring-bad/40", text: "text-bad", tone: "bad" },
};

const LEGEND: { swatch: string; label: string }[] = [
  { swatch: "bg-foreground/15", label: "Under 70%" },
  { swatch: "bg-ok", label: "70-100%" },
  { swatch: "bg-warn", label: "100-115% · Over" },
  { swatch: "bg-bad", label: "Above 115% · Over" },
];

const STATUS_STYLE: Record<string, string> = {
  todo: "bg-foreground/10 text-muted-foreground",
  in_progress: "bg-info-soft text-info",
  review: "bg-violet-soft text-violet",
};

function columnName(column: CapacityColumn): string {
  return column.kind === "week" ? `Week of ${column.label}` : column.label;
}

function formatDue(due: string | null): string {
  const date = parseDue(due);
  return date ? format(date, "d MMM") : "No date";
}

/** Inline weekly-capacity editor (admins only): saves on blur or Enter. */
function CapacityInput({
  employee, capacity, onSave,
}: { employee: Employee; capacity: number; onSave: (employeeId: string, hours: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(null);
      return;
    }
    if (draft === null) return;
    const parsed = Number(draft.replace(",", "."));
    setDraft(null);
    if (draft.trim() === "" || !Number.isFinite(parsed)) return;
    const hours = Math.min(MAX_CAPACITY, Math.max(0, Math.round(parsed * 2) / 2));
    if (hours !== capacity) onSave(employee.id, hours);
  };

  return (
    <label className="mt-1 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        max={MAX_CAPACITY}
        step={0.5}
        value={draft ?? String(capacity)}
        aria-label={`Weekly capacity in hours for ${employee.full_name}`}
        className="h-7 w-[68px] px-2 font-mono text-xs md:text-xs"
        onChange={e => setDraft(e.target.value)}
        onFocus={e => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
      />
      <span className="font-mono">h / week</span>
    </label>
  );
}

function GridCell({
  person, column, cell, capacity, selected, onSelect,
}: {
  person: string;
  column: CapacityColumn;
  cell: CapacityCell;
  capacity: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const isWeek = column.kind === "week";
  const empty = cell.count === 0;
  const percent = isWeek ? loadPercent(cell.hours, capacity) : 0;
  const level: LoadLevel = isWeek && !empty ? loadLevel(percent) : "neutral";
  const over = isWeek && !empty && isOver(percent);
  const style = LEVEL_STYLE[level];

  const label = empty
    ? `${person}, ${columnName(column)}: no open tasks`
    : [
        `${person}, ${columnName(column)}: ${formatHours(cell.hours)}`,
        isWeek ? `${percentLabel(percent)} of weekly capacity${over ? ", over capacity" : ""}` : null,
        plural(cell.count, "task"),
        cell.unestimated > 0 ? `${cell.unestimated} without an estimate` : null,
      ].filter(Boolean).join(", ");

  return (
    <button
      type="button"
      disabled={empty}
      aria-pressed={selected}
      aria-label={label}
      onClick={onSelect}
      className={cn(
        "flex min-h-[78px] w-full flex-col gap-1 rounded-xl border p-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
        empty ? "border-transparent bg-foreground/[0.03]" : cn("border-transparent", style.box),
        selected && "border-primary ring-1 ring-primary",
      )}
    >
      {empty ? (
        <span className="m-auto font-mono text-sm text-muted-foreground" aria-hidden>—</span>
      ) : (
        <>
          <span className="flex items-baseline justify-between gap-1">
            <span className={cn("font-mono text-[13px] font-bold", column.kind === "overdue" ? "text-bad" : "text-foreground")}>
              {formatHours(cell.hours)}
            </span>
            {isWeek && <span className={cn("font-mono text-[11px] font-semibold", style.text)}>{percentLabel(percent)}</span>}
          </span>
          {isWeek && (
            <ProgressBar value={Number.isFinite(percent) ? percent / 100 : 1} tone={style.tone} className="h-1" />
          )}
          <span className="flex items-center justify-between gap-1 text-[10.5px] leading-tight text-muted-foreground">
            <span>{plural(cell.count, "task")}</span>
            {over && <span className={cn("font-mono text-[10px] font-bold uppercase tracking-[0.08em]", style.text)}>Over</span>}
          </span>
          {cell.unestimated > 0 && (
            <span className="text-[10.5px] leading-tight text-muted-foreground">{cell.unestimated} no estimate</span>
          )}
        </>
      )}
    </button>
  );
}

function TaskRow({ task, today }: { task: CapacityTask; today: Date }) {
  const bucket = dueBucket(task.dueDate, today);
  return (
    <div className={cn(TASK_COLS, "border-t border-border px-1 py-3")}>
      <p className="min-w-0 truncate text-[13.5px] font-semibold text-foreground">{task.title}</p>
      <p className={cn("min-w-0 truncate text-[13px]", task.projectTitle ? "text-muted-foreground" : "text-muted-foreground/70")}>
        {task.projectTitle ?? "No project"}
      </p>
      <div>
        <p className={cn("text-[13px]", bucket === "overdue" ? "font-semibold text-bad" : "text-foreground")}>{formatDue(task.dueDate)}</p>
        {(bucket === "overdue" || bucket === "today") && (
          <p className={cn("mt-0.5 text-[11.5px]", bucket === "overdue" ? "text-bad" : "text-warn")}>
            {bucket === "overdue" ? "Overdue" : "Due today"}
          </p>
        )}
      </div>
      <p className={cn("font-mono text-[13px]", task.estimate == null ? "text-warn" : "font-semibold text-foreground")}>
        {task.estimate == null ? "No estimate" : formatHours(task.estimate)}
      </p>
      <div>
        <span className={cn("rounded-full px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.08em]", STATUS_STYLE[task.status] ?? STATUS_STYLE.todo)}>
          {TASK_STATUS_LABEL[task.status] ?? task.status}
        </span>
      </div>
    </div>
  );
}

export default function CapacityPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: me } = useCurrentEmployee();
  const isAdmin = me?.role === "admin";

  const [now, setNow] = useState(() => new Date());
  const [selected, setSelected] = useState<{ employeeId: string; columnKey: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // Keeps "today", the week columns and running timers current on a long-open tab.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const { data: projects = [], isLoading: projectsLoading } = useQuery({ queryKey: ["projects"], queryFn: () => getProjects(supabase), refetchInterval: 30000 });
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({ queryKey: ["project-tasks"], queryFn: () => getAllProjectTasks(supabase), refetchInterval: 30000 });
  const { data: employeeTasks = [], isLoading: employeeTasksLoading } = useQuery({ queryKey: ["employee-tasks"], queryFn: () => getEmployeeTasks(supabase) });
  const { data: employees = [], isLoading: employeesLoading } = useQuery({ queryKey: ["employees"], queryFn: () => getEmployees(supabase) });
  // Fetched a day early and clipped to exactly 7 days client-side, so an entry
  // that started just before the window still counts for its inside part.
  const { data: timeEntries = [] } = useQuery({
    queryKey: ["time-entries", "week"],
    queryFn: () => getTimeEntries(supabase, { since: subDays(new Date(), 8).toISOString() }),
    refetchInterval: 30000,
  });

  const capacityMutation = useMutation({
    mutationFn: ({ id, hours }: { id: string; hours: number }) => updateEmployeeCapacity(supabase, id, hours),
    onMutate: async ({ id, hours }) => {
      setSaveError(null);
      await queryClient.cancelQueries({ queryKey: ["employees"] });
      const previous = queryClient.getQueryData<Employee[]>(["employees"]);
      queryClient.setQueryData<Employee[]>(["employees"], old =>
        (old ?? []).map(e => (e.id === id ? { ...e, weekly_capacity_hours: hours } : e)),
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(["employees"], context.previous);
      setSaveError("Couldn't save the capacity. Only admins can change it.");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["employees"] }),
  });

  const loading = employeesLoading || projectsLoading || tasksLoading || employeeTasksLoading;
  const today = useMemo(() => startOfDay(now), [now]);

  const grid = useMemo(
    () => buildCapacityGrid({ employees, projects, tasks, employeeTasks, now }),
    [employees, projects, tasks, employeeTasks, now],
  );
  const logged = useMemo(() => loggedHoursByEmployee(timeEntries, now, 7), [timeEntries, now]);

  const plannedNext = grid.rows.reduce((n, r) => n + (r.cells[grid.nextWeekKey]?.hours ?? 0), 0);
  const plannedNextPct = grid.teamCapacity > 0 ? Math.round((plannedNext / grid.teamCapacity) * 100) : null;
  const top = mostLoaded(grid.rows, grid.nextWeekKey);
  const topLevel = top ? loadLevel(top.percent) : "neutral";

  const selectedRow = selected ? grid.rows.find(r => r.employee.id === selected.employeeId) : undefined;
  const selectedColumn = selected ? grid.columns.find(c => c.key === selected.columnKey) : undefined;
  const selectedCell = selectedRow && selectedColumn ? selectedRow.cells[selectedColumn.key] : undefined;

  const select = (employeeId: string, columnKey: string) => {
    const same = selected?.employeeId === employeeId && selected.columnKey === columnKey;
    setSelected(same ? null : { employeeId, columnKey });
    if (!same) requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "nearest" }));
  };

  const planScale = Math.max(
    1,
    ...grid.rows.map(r => Math.max(r.cells[grid.currentWeekKey]?.hours ?? 0, logged.get(r.employee.id) ?? 0)),
  );
  const totalLogged = Array.from(logged.values()).reduce((n, h) => n + h, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Capacity</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Plans hours per person per week from task estimates. Each cell adds up the estimates of a person&apos;s open tasks due that
          week and compares them with their weekly capacity.
        </p>
      </div>

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          label="Team capacity / week"
          value={loading ? "—" : formatHours(grid.teamCapacity)}
          sub={loading ? undefined : plural(grid.rows.length, "team member")}
        />
        <KpiTile
          label="Planned next week"
          value={loading ? "—" : formatHours(plannedNext)}
          sub={plannedNextPct === null ? "No capacity set" : `${plannedNextPct}% of team capacity`}
        />
        <KpiTile
          label="Most loaded person next week"
          value={loading || !top ? "—" : percentLabel(top.percent)}
          valueClassName={topLevel === "bad" ? "text-bad" : topLevel === "warn" ? "text-warn" : undefined}
          sub={
            loading || !top
              ? "Nothing planned for next week"
              : `${top.row.employee.full_name} · ${formatHours(top.hours)} of ${formatHours(top.row.capacity)}${isOver(top.percent) ? " · Over" : ""}`
          }
        />
        <KpiTile
          label="Tasks without an estimate"
          value={loading ? "—" : grid.unestimatedTotal}
          valueClassName={!loading && grid.unestimatedTotal > 0 ? "text-warn" : undefined}
          sub="they are not counted in the hours"
        />
      </section>

      <Card>
        <CardContent>
          <PanelHeader title="Weekly plan" aside="hours of open tasks by due week" />

          <ul aria-label="Load colors" className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {LEGEND.map(l => (
              <li key={l.label} className="flex items-center gap-1.5">
                <span className={cn("size-2.5 rounded-sm", l.swatch)} aria-hidden />
                <span className="font-mono">{l.label}</span>
              </li>
            ))}
          </ul>
          {saveError && <p role="alert" className="mb-3 text-xs text-bad">{saveError}</p>}

          {loading && <p className="border-t border-border px-1 py-6 text-sm text-muted-foreground">Loading team…</p>}
          {!loading && grid.rows.length === 0 && (
            <p className="border-t border-border px-1 py-6 text-sm text-muted-foreground">No team members yet.</p>
          )}

          {!loading && grid.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1080px] table-fixed border-separate border-spacing-1">
                <caption className="sr-only">
                  Estimated hours of open tasks per person, by due week, as a share of weekly capacity. Select a cell to list its tasks.
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-[230px] px-2 pb-1 text-left font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                      Person
                    </th>
                    {grid.columns.map(c => (
                      <th key={c.key} scope="col" className="px-1 pb-1 text-left font-mono font-medium text-muted-foreground">
                        <span className="block text-[10px] uppercase tracking-[0.1em]">
                          {c.kind === "week" && <span className="sr-only">Week of </span>}
                          {c.label}
                        </span>
                        <span className="block text-[10px] font-normal normal-case tracking-normal opacity-80">{c.caption || "\u00a0"}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.rows.map(row => (
                    <tr key={row.employee.id}>
                      <th scope="row" className="px-2 py-1 text-left align-middle font-normal">
                        <div className="flex items-center gap-2.5">
                          <Avatar employee={row.employee} size={32} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13.5px] font-semibold text-foreground">{row.employee.full_name}</p>
                            {isAdmin ? (
                              <CapacityInput
                                employee={row.employee}
                                capacity={row.capacity}
                                onSave={(id, hours) => capacityMutation.mutate({ id, hours })}
                              />
                            ) : (
                              <p className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
                                {formatHours(row.capacity)} / week
                              </p>
                            )}
                          </div>
                        </div>
                      </th>
                      {grid.columns.map(c => (
                        <td key={c.key} className="p-0 align-top">
                          <GridCell
                            person={row.employee.full_name}
                            column={c}
                            cell={row.cells[c.key]}
                            capacity={row.capacity}
                            selected={selected?.employeeId === row.employee.id && selected.columnKey === c.key}
                            onSelect={() => select(row.employee.id, c.key)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              Add estimates on the <Link href="/dashboard/projects" className="font-semibold text-primary hover:underline">project board</Link> to
              make this accurate. Tasks without an estimate show up in the grid but add 0 h.
              {!isAdmin && " Only admins can change weekly capacity."}
            </p>
            {grid.beyondHorizon > 0 && (
              <p>{plural(grid.beyondHorizon, "open task")} {grid.beyondHorizon === 1 ? "is" : "are"} due after the last week shown.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <div ref={detailRef} role="region" aria-label="Tasks in the selected cell" className="scroll-mt-4">
        <Card>
          <CardContent>
            <PanelHeader
              title={selectedRow && selectedColumn ? `${selectedRow.employee.full_name} · ${columnName(selectedColumn)}` : "Cell details"}
              aside={
                selectedCell && selectedCell.count > 0
                  ? `${plural(selectedCell.count, "task")} · ${formatHours(selectedCell.hours)}`
                  : undefined
              }
            />
            {!selectedRow || !selectedColumn || !selectedCell ? (
              <p className="text-sm text-muted-foreground">Select a cell in the grid to see the tasks behind its hours.</p>
            ) : selectedCell.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open tasks in this cell.</p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[640px]">
                  <div className={cn(TASK_COLS, "px-1 pb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground")}>
                    <span>Task</span><span>Project</span><span>Due</span><span>Estimate</span><span>Status</span>
                  </div>
                  {selectedCell.tasks.map(t => <TaskRow key={`${t.source}-${t.id}`} task={t} today={today} />)}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent>
          <PanelHeader title="Planned vs logged (last 7 days)" aside="hours per person" />
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : grid.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No team members yet.</p>
          ) : (
            <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
              {grid.rows.map(row => {
                const planned = row.cells[grid.currentWeekKey]?.hours ?? 0;
                const done = logged.get(row.employee.id) ?? 0;
                return (
                  <div key={row.employee.id}>
                    <div className="flex items-center gap-2.5">
                      <Avatar employee={row.employee} size={28} />
                      <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-foreground">{row.employee.full_name}</p>
                    </div>
                    <div className="mt-2.5 space-y-2">
                      <div>
                        <div className="mb-1 flex items-baseline justify-between text-[11.5px] text-muted-foreground">
                          <span>Planned this week</span>
                          <span className="font-mono text-[13px] font-bold text-foreground">{formatHours(planned)}</span>
                        </div>
                        <ProgressBar value={planned / planScale} tone="info" className="h-2" />
                      </div>
                      <div>
                        <div className="mb-1 flex items-baseline justify-between text-[11.5px] text-muted-foreground">
                          <span>Logged, last 7 days</span>
                          <span className="font-mono text-[13px] font-bold text-foreground">{formatHours(done)}</span>
                        </div>
                        <ProgressBar value={done / planScale} tone="ok" className="h-2" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-5 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            {totalLogged > 0
              ? "Logged hours come from time entries in the last 7 days; a running timer counts up to now. Planned hours are the estimates of open tasks due this week."
              : "No time logged in the last 7 days. Start a timer on a project to compare logged hours with the plan."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
