import { addDays, differenceInCalendarDays, format, parseISO, startOfDay } from "date-fns";
import type { Project, ProjectTask, ProjectTaskStatus } from "@/types";

// Shared planning helpers for the Project Cockpit, My Day and Capacity views.

export const TASK_COLUMNS: { key: ProjectTaskStatus; label: string }[] = [
  { key: "todo", label: "To do" },
  { key: "in_progress", label: "In progress" },
  { key: "review", label: "In review" },
  { key: "done", label: "Done" },
];

export const TASK_STATUS_LABEL: Record<ProjectTaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
};

export type DueBucket = "overdue" | "today" | "week" | "later" | "none";

/** Where a due date falls relative to today (week = tomorrow up to the 6th day ahead, i.e. within the 7-day window that starts today). */
export function dueBucket(due: string | null | undefined, today: Date): DueBucket {
  if (!due) return "none";
  const diff = differenceInCalendarDays(parseISO(due), today);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff < 7) return "week";
  return "later";
}

export function formatHours(hours: number | null | undefined): string {
  if (hours == null) return "-";
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} h`;
}

export function projectStart(project: Pick<Project, "start_date" | "created_at">): Date {
  return startOfDay(parseISO(project.start_date ?? project.created_at));
}

export interface BurndownPoint {
  date: Date;
  label: string;
  /** Tasks still open on that day; null for days in the future. */
  actual: number | null;
  /** Where the straight line from "everything open" to "nothing open" would be. */
  plan: number;
}

export interface Burndown {
  points: BurndownPoint[];
  total: number;
  remaining: number;
  /** Positive = behind the plan line, negative = ahead. */
  behindBy: number;
  currentPerDay: number;
  neededPerDay: number | null;
  forecast: Date | null;
  forecastDaysLate: number | null;
}

// Scope is treated as fixed: every current task counts from the project's
// start date, which keeps the line honest about tasks added along the way
// (they show up as remaining work, not as retroactive progress).
export function computeBurndown(project: Project, tasks: ProjectTask[], now: Date): Burndown | null {
  if (!project.due_date || tasks.length === 0) return null;
  const today = startOfDay(now);
  const start = projectStart(project);
  const end = startOfDay(parseISO(project.due_date));
  const spanDays = Math.max(1, differenceInCalendarDays(end, start));
  const total = tasks.length;

  const doneBy = (day: Date) => {
    const cutoff = addDays(day, 1).getTime();
    return tasks.filter(t => t.status === "done" && parseISO(t.completed_at ?? t.updated_at).getTime() < cutoff).length;
  };
  const planAt = (day: Date) =>
    Math.max(0, total * (1 - Math.min(1, Math.max(0, differenceInCalendarDays(day, start) / spanDays))));

  const stamps: Date[] = [];
  for (let d = start; d < end; d = addDays(d, 7)) stamps.push(d);
  stamps.push(end);
  if (today > start && today < end) stamps.push(today);
  stamps.sort((a, b) => a.getTime() - b.getTime());

  const points: BurndownPoint[] = stamps.map(date => ({
    date,
    label: format(date, "d MMM"),
    actual: date <= today ? total - doneBy(date) : null,
    plan: planAt(date),
  }));

  const remaining = total - doneBy(today);
  const elapsed = Math.max(1, differenceInCalendarDays(today, start));
  const currentPerDay = doneBy(today) / elapsed;
  const daysLeft = differenceInCalendarDays(end, today);
  const neededPerDay = remaining === 0 ? 0 : daysLeft > 0 ? remaining / daysLeft : null;
  const forecast = remaining === 0 ? today : currentPerDay > 0 ? addDays(today, Math.ceil(remaining / currentPerDay)) : null;

  return {
    points,
    total,
    remaining,
    behindBy: remaining - planAt(today),
    currentPerDay,
    neededPerDay,
    forecast,
    forecastDaysLate: forecast ? differenceInCalendarDays(forecast, end) : null,
  };
}
