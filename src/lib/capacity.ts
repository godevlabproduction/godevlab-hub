import {
  differenceInCalendarDays, format, isValid, parseISO, startOfDay, startOfWeek, addWeeks, subDays,
} from "date-fns";
import type {
  Employee, EmployeeTask, Project, ProjectTask, ProjectTaskStatus, TimeEntry,
} from "@/types";
import { DEFAULT_WEEKLY_CAPACITY, taskOwner } from "@/lib/portfolio";

// Pure grid math for the Capacity view. No React in here: the page feeds in the
// rows it fetched and gets back a person x week grid of estimated hours.
// Missing data (no estimates, no capacity column, no time_entries table yet) is
// always treated as zero so nothing in this file can throw on empty input.

/** The grid shows the current week plus the next (CAPACITY_WEEKS - 1) weeks. */
export const CAPACITY_WEEKS = 6;

export type ColumnKind = "overdue" | "week" | "none";

export interface CapacityColumn {
  key: string;
  kind: ColumnKind;
  /** Short header label: "Overdue", "23 Sep", "No date". */
  label: string;
  /** Second header line: "This week", "Next week" or "". */
  caption: string;
  /** Monday of the week (week columns only). */
  start: Date | null;
}

export interface CapacityTask {
  id: string;
  source: "project" | "assigned";
  title: string;
  projectTitle: string | null;
  dueDate: string | null;
  estimate: number | null;
  status: ProjectTaskStatus;
  owner: string;
}

export interface CapacityCell {
  key: string;
  hours: number;
  count: number;
  /** Tasks in this cell that have no estimate (they add 0 h). */
  unestimated: number;
  tasks: CapacityTask[];
}

export interface CapacityRow {
  employee: Employee;
  capacity: number;
  cells: Record<string, CapacityCell>;
  openCount: number;
}

export interface CapacityGrid {
  columns: CapacityColumn[];
  rows: CapacityRow[];
  currentWeekKey: string;
  nextWeekKey: string;
  teamCapacity: number;
  /** Open tasks of team members with no estimate, wherever they fall. */
  unestimatedTotal: number;
  /** Open tasks due after the last visible week. */
  beyondHorizon: number;
}

export type LoadLevel = "neutral" | "ok" | "warn" | "bad";

export const OVERDUE_KEY = "overdue";
export const NO_DATE_KEY = "none";
const weekKey = (start: Date) => `week-${format(start, "yyyy-MM-dd")}`;

/** Weeks start on Monday. */
export function weekStartOf(date: Date): Date {
  return startOfWeek(date, { weekStartsOn: 1 });
}

/** A valid Date for a due-date string, or null when empty or unparseable. */
export function parseDue(due: string | null | undefined): Date | null {
  if (!due) return null;
  const d = parseISO(due);
  return isValid(d) ? d : null;
}

export function weeklyCapacityOf(employee: Pick<Employee, "weekly_capacity_hours">): number {
  const raw = employee.weekly_capacity_hours;
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_WEEKLY_CAPACITY;
}

export function estimateOf(task: { estimate_hours?: number | null }): number | null {
  if (task.estimate_hours == null) return null;
  const n = Number(task.estimate_hours);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Overdue, the current week, the following weeks, then "No date". */
export function buildColumns(now: Date, weeks = CAPACITY_WEEKS): CapacityColumn[] {
  const first = weekStartOf(now);
  const columns: CapacityColumn[] = [
    { key: OVERDUE_KEY, kind: "overdue", label: "Overdue", caption: "before today", start: null },
  ];
  for (let i = 0; i < weeks; i++) {
    const start = addWeeks(first, i);
    columns.push({
      key: weekKey(start),
      kind: "week",
      label: format(start, "d MMM"),
      caption: i === 0 ? "This week" : i === 1 ? "Next week" : "",
      start,
    });
  }
  columns.push({ key: NO_DATE_KEY, kind: "none", label: "No date", caption: "not scheduled", start: null });
  return columns;
}

/**
 * Every open task, one flat list. Project tasks belong to taskOwner() and are
 * skipped when their project is completed; assigned (employee) tasks belong to
 * their assignee.
 */
export function collectOpenTasks(input: {
  projects: Project[];
  tasks: ProjectTask[];
  employeeTasks: EmployeeTask[];
}): CapacityTask[] {
  const projectById = new Map((input.projects ?? []).map(p => [p.id, p]));
  const out: CapacityTask[] = [];

  for (const t of input.tasks ?? []) {
    if (t.status === "done") continue;
    const project = projectById.get(t.project_id);
    if (project?.status === "completed") continue;
    const owner = taskOwner(t);
    if (!owner) continue; // unassigned work does not load anyone
    out.push({
      id: t.id,
      source: "project",
      title: t.title,
      projectTitle: project?.title ?? null,
      dueDate: t.due_date ?? null,
      estimate: estimateOf(t),
      status: t.status,
      owner,
    });
  }

  for (const t of input.employeeTasks ?? []) {
    if (t.status === "done") continue;
    out.push({
      id: t.id,
      source: "assigned",
      title: t.title,
      projectTitle: t.project?.title ?? projectById.get(t.project_id ?? "")?.title ?? null,
      dueDate: t.due_date ?? null,
      estimate: estimateOf(t),
      status: t.status,
      owner: t.assigned_to,
    });
  }
  return out;
}

/**
 * Which column a due date lands in: before today is Overdue, no date is No date,
 * otherwise the week it falls in. Null when it is past the last visible week.
 */
export function columnKeyFor(due: string | null | undefined, columns: CapacityColumn[], now: Date): string | null {
  const date = parseDue(due);
  if (!date) return NO_DATE_KEY;
  const today = startOfDay(now);
  if (differenceInCalendarDays(date, today) < 0) return OVERDUE_KEY;
  const firstWeek = columns.find(c => c.kind === "week")?.start;
  if (!firstWeek) return null;
  const index = Math.floor(differenceInCalendarDays(date, firstWeek) / 7);
  return columns.filter(c => c.kind === "week")[index]?.key ?? null;
}

const byDueThenTitle = (a: CapacityTask, b: CapacityTask) => {
  const ad = a.dueDate ?? "9999-12-31";
  const bd = b.dueDate ?? "9999-12-31";
  return ad === bd ? a.title.localeCompare(b.title) : ad.localeCompare(bd);
};

export function buildCapacityGrid(input: {
  employees: Employee[];
  projects: Project[];
  tasks: ProjectTask[];
  employeeTasks: EmployeeTask[];
  now: Date;
  weeks?: number;
}): CapacityGrid {
  const { now } = input;
  const columns = buildColumns(now, input.weeks);
  const weekColumns = columns.filter(c => c.kind === "week");
  const employees = [...(input.employees ?? [])].sort((a, b) => a.full_name.localeCompare(b.full_name));
  const open = collectOpenTasks(input);

  const rowById = new Map<string, CapacityRow>();
  const rows: CapacityRow[] = employees.map(employee => {
    const cells: Record<string, CapacityCell> = {};
    for (const c of columns) cells[c.key] = { key: c.key, hours: 0, count: 0, unestimated: 0, tasks: [] };
    const row: CapacityRow = { employee, capacity: weeklyCapacityOf(employee), cells, openCount: 0 };
    rowById.set(employee.id, row);
    return row;
  });

  let unestimatedTotal = 0;
  let beyondHorizon = 0;
  for (const task of open) {
    const row = rowById.get(task.owner);
    if (!row) continue;
    row.openCount++;
    if (task.estimate == null) unestimatedTotal++;
    const key = columnKeyFor(task.dueDate, columns, now);
    if (key === null) {
      beyondHorizon++;
      continue;
    }
    const cell = row.cells[key];
    cell.tasks.push(task);
    cell.count++;
    cell.hours += task.estimate ?? 0;
    if (task.estimate == null) cell.unestimated++;
  }
  for (const row of rows) for (const c of columns) row.cells[c.key].tasks.sort(byDueThenTitle);

  return {
    columns,
    rows,
    currentWeekKey: weekColumns[0]?.key ?? "",
    nextWeekKey: weekColumns[1]?.key ?? "",
    teamCapacity: rows.reduce((n, r) => n + r.capacity, 0),
    unestimatedTotal,
    beyondHorizon,
  };
}

/**
 * Hours as a whole percent of capacity. With no capacity at all, any hours are
 * infinitely overloaded (Infinity) and no hours is 0.
 */
export function loadPercent(hours: number, capacity: number): number {
  if (hours <= 0) return 0;
  if (capacity <= 0) return Infinity;
  return Math.round((hours / capacity) * 100);
}

export function percentLabel(percent: number): string {
  return Number.isFinite(percent) ? `${percent}%` : "n/a";
}

/** Under 70% neutral, 70-100% ok, 100-115% warn, above 115% bad. */
export function loadLevel(percent: number): LoadLevel {
  if (percent < 70) return "neutral";
  if (percent <= 100) return "ok";
  if (percent <= 115) return "warn";
  return "bad";
}

/** Anything above 100% is over capacity (shown as the word "Over"). */
export const isOver = (percent: number) => percent > 100;

/** The person carrying the most load, as a share of their own capacity, in one column. */
export function mostLoaded(rows: CapacityRow[], columnKey: string): { row: CapacityRow; hours: number; percent: number } | null {
  let best: { row: CapacityRow; hours: number; percent: number } | null = null;
  for (const row of rows) {
    const hours = row.cells[columnKey]?.hours ?? 0;
    if (hours <= 0) continue;
    const percent = loadPercent(hours, row.capacity);
    if (!best || percent > best.percent || (percent === best.percent && hours > best.hours)) {
      best = { row, hours, percent };
    }
  }
  return best;
}

/**
 * Hours logged per employee in the last `days` days. A running entry (no
 * ended_at) counts up to `now`; entries are clipped to the window.
 */
export function loggedHoursByEmployee(entries: TimeEntry[], now: Date, days = 7): Map<string, number> {
  const windowStart = subDays(now, days).getTime();
  const nowMs = now.getTime();
  const totals = new Map<string, number>();
  for (const entry of entries ?? []) {
    const startedAt = entry.started_at ? parseISO(entry.started_at).getTime() : NaN;
    if (!Number.isFinite(startedAt)) continue;
    const endedAt = entry.ended_at ? parseISO(entry.ended_at).getTime() : nowMs;
    const start = Math.max(startedAt, windowStart);
    const end = Math.min(Number.isFinite(endedAt) ? endedAt : nowMs, nowMs);
    if (end <= start) continue;
    totals.set(entry.employee_id, (totals.get(entry.employee_id) ?? 0) + (end - start) / 3_600_000);
  }
  return totals;
}
