import { addDays, differenceInCalendarDays, parseISO, startOfDay, subDays } from "date-fns";
import type {
  Employee, EmployeeTask, Project, ProjectAssignment, ProjectTask, ProjectUpdate,
} from "@/types";

export type HealthState = "ok" | "risk" | "late" | "none" | "done";

export interface ProjectHealth {
  state: HealthState;
  label: string;
  reasons: string[];
  total: number;
  done: number;
  progress: number;
  overdueTasks: number;
  openBlockers: number;
  daysLeft: number | null;
  timeUsed: number | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pct = (n: number) => Math.round(n * 100);

// Health is derived, never typed in: due date vs. progress, open blockers and
// overdue tasks. Staleness of Live Sync is surfaced separately in "Needs
// attention" because a quiet project is not necessarily an unhealthy one.
export function computeProjectHealth(
  project: Project,
  tasks: ProjectTask[],
  openBlockers: number,
  today: Date,
): ProjectHealth {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === "done").length;
  const progress = total === 0 ? 0 : done / total;
  const overdueTasks = tasks.filter(
    t => t.status !== "done" && t.due_date && differenceInCalendarDays(today, parseISO(t.due_date)) > 0,
  ).length;
  const daysLeft = project.due_date ? differenceInCalendarDays(parseISO(project.due_date), today) : null;

  let timeUsed: number | null = null;
  if (project.due_date) {
    const start = startOfDay(parseISO(project.start_date ?? project.created_at));
    const span = differenceInCalendarDays(parseISO(project.due_date), start);
    timeUsed = span <= 0 ? 1 : Math.min(1, Math.max(0, differenceInCalendarDays(today, start) / span));
  }

  const base = { total, done, progress, overdueTasks, openBlockers, daysLeft, timeUsed };

  if (project.status === "completed") {
    return { ...base, progress: 1, state: "done", label: "Completed", reasons: [] };
  }
  if (project.status === "backlog") {
    return { ...base, state: "none", label: "Backlog", reasons: ["Not started yet"] };
  }
  if (total === 0) {
    return { ...base, state: "none", label: "No plan", reasons: ["No tasks yet"] };
  }
  if (daysLeft !== null && daysLeft < 0) {
    return {
      ...base,
      state: "late",
      label: "Late",
      reasons: [`${plural(-daysLeft, "day")} past the due date`],
    };
  }

  const reasons: string[] = [];
  if (openBlockers > 0) reasons.push(`${plural(openBlockers, "open blocker")}`);
  if (overdueTasks > 0) reasons.push(`${plural(overdueTasks, "overdue task")}`);
  if (timeUsed !== null && progress < 1 && timeUsed - progress > 0.25) {
    reasons.push(`${pct(timeUsed)}% of the time used, ${pct(progress)}% done`);
  }
  if (reasons.length > 0) return { ...base, state: "risk", label: "At risk", reasons };
  return { ...base, state: "ok", label: "On track", reasons: [] };
}

export interface PortfolioRow {
  project: Project;
  health: ProjectHealth;
  team: Employee[];
  stale: boolean;
}

export type AttentionKind = "blocker" | "late" | "overdue" | "stale" | "noplan";

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  projectId: string;
  projectTitle: string;
  title: string;
  detail: string;
  at: string | null;
  blockerId?: string;
  /** Who reported the blocker (only set for blockers). */
  createdBy?: string;
}

export interface WorkloadRow {
  employee: Employee;
  openTasks: number;
  overdue: number;
  projects: number;
  /** Estimated hours of open work that is overdue or due within the next 7 days. */
  weekHours: number;
  /** Estimated hours of every open task, scheduled or not. */
  openHours: number;
  /** Open tasks that have no estimate yet, so the hour numbers undercount. */
  unestimated: number;
  capacity: number;
}

export interface Kpis {
  active: number;
  total: number;
  backlog: number;
  completed: number;
  health: { ok: number; risk: number; late: number; none: number };
  openBlockers: number;
  blockerProjects: string[];
  doneThisWeek: number;
  doneLastWeek: number;
  overdueTasks: number;
  overdueProjects: number;
}

export interface Portfolio {
  rows: PortfolioRow[];
  attention: AttentionItem[];
  workload: WorkloadRow[];
  kpis: Kpis;
}

export interface PortfolioInput {
  projects: Project[];
  tasks: ProjectTask[];
  employeeTasks: EmployeeTask[];
  assignments: ProjectAssignment[];
  employees: Employee[];
  blockers: ProjectUpdate[];
  now: Date;
}

const STALE_DAYS = 5;
export const DEFAULT_WEEKLY_CAPACITY = 40;

/** Who a project task belongs to. Null means it is deliberately unassigned. */
export function taskOwner(t: Pick<ProjectTask, "assigned_to">): string | null {
  return t.assigned_to;
}
const SEVERITY: Record<HealthState, number> = { late: 0, risk: 1, ok: 2, none: 3, done: 4 };
const ATTENTION_ORDER: Record<AttentionKind, number> = { blocker: 0, late: 1, overdue: 2, stale: 3, noplan: 4 };

export function buildPortfolio({
  projects, tasks, employeeTasks, assignments, employees, blockers, now,
}: PortfolioInput): Portfolio {
  const today = startOfDay(now);
  const employeeById = new Map(employees.map(e => [e.id, e]));

  const tasksByProject = new Map<string, ProjectTask[]>();
  for (const t of tasks) {
    const list = tasksByProject.get(t.project_id) ?? [];
    list.push(t);
    tasksByProject.set(t.project_id, list);
  }

  const blockersByProject = new Map<string, ProjectUpdate[]>();
  for (const b of blockers) {
    const list = blockersByProject.get(b.project_id) ?? [];
    list.push(b);
    blockersByProject.set(b.project_id, list);
  }

  const teamOf = (project: Project): Employee[] => {
    const assigned = assignments
      .filter(a => a.project_id === project.id)
      .map(a => employeeById.get(a.employee_id))
      .filter((e): e is Employee => Boolean(e));
    if (assigned.length > 0) return assigned;
    const creator = project.employee ?? employeeById.get(project.created_by);
    return creator ? [creator] : [];
  };

  const rows: PortfolioRow[] = projects.map(project => {
    const health = computeProjectHealth(
      project,
      tasksByProject.get(project.id) ?? [],
      (blockersByProject.get(project.id) ?? []).length,
      today,
    );
    const stale =
      project.status === "active" &&
      project.last_synced_at !== null &&
      differenceInCalendarDays(today, startOfDay(parseISO(project.last_synced_at))) >= STALE_DAYS;
    return { project, health, team: teamOf(project), stale };
  });

  rows.sort((a, b) => {
    const bySeverity = SEVERITY[a.health.state] - SEVERITY[b.health.state];
    if (bySeverity !== 0) return bySeverity;
    const ad = a.project.due_date ?? "9999-12-31";
    const bd = b.project.due_date ?? "9999-12-31";
    if (ad !== bd) return ad.localeCompare(bd);
    return a.project.title.localeCompare(b.project.title);
  });

  const attention: AttentionItem[] = [];
  for (const b of blockers) {
    attention.push({
      id: `blocker-${b.id}`,
      kind: "blocker",
      projectId: b.project_id,
      projectTitle: b.project?.title ?? "Unknown project",
      title: b.title,
      detail: `Reported by ${b.employee?.full_name ?? "someone"}`,
      at: b.created_at,
      blockerId: b.id,
      createdBy: b.created_by,
    });
  }
  for (const r of rows) {
    const { project, health } = r;
    if (health.state === "late") {
      attention.push({
        id: `late-${project.id}`, kind: "late", projectId: project.id, projectTitle: project.title,
        title: "Past its due date", detail: health.reasons[0] ?? "", at: project.due_date,
      });
    } else if (health.overdueTasks > 0 && health.state !== "done") {
      attention.push({
        id: `overdue-${project.id}`, kind: "overdue", projectId: project.id, projectTitle: project.title,
        title: `${plural(health.overdueTasks, "overdue task")}`, detail: "Tasks past their due date", at: null,
      });
    }
    if (r.stale && project.last_synced_at) {
      const days = differenceInCalendarDays(today, startOfDay(parseISO(project.last_synced_at)));
      attention.push({
        id: `stale-${project.id}`, kind: "stale", projectId: project.id, projectTitle: project.title,
        title: `No Live Sync for ${plural(days, "day")}`,
        detail: project.last_commit_message ? `Last commit: ${project.last_commit_message}` : "No recent activity reported",
        at: project.last_synced_at,
      });
    }
    if (health.state === "none" && project.status !== "backlog" && project.status !== "completed") {
      attention.push({
        id: `noplan-${project.id}`, kind: "noplan", projectId: project.id, projectTitle: project.title,
        title: "Active but has no tasks", detail: "Add a plan or move it to Backlog", at: null,
      });
    }
  }
  attention.sort((a, b) => ATTENTION_ORDER[a.kind] - ATTENTION_ORDER[b.kind]);

  const liveProjectIds = new Set(rows.filter(r => r.health.state !== "done").map(r => r.project.id));
  const weekEnd = addDays(today, 7);
  const workload: WorkloadRow[] = employees.map(employee => {
    const mineProjectTasks = tasks.filter(
      t => taskOwner(t) === employee.id && t.status !== "done" && liveProjectIds.has(t.project_id),
    );
    const mineEmployeeTasks = employeeTasks.filter(t => t.assigned_to === employee.id && t.status !== "done");
    const open = [...mineProjectTasks, ...mineEmployeeTasks];
    const isOverdue = (due: string | null) => Boolean(due) && differenceInCalendarDays(today, parseISO(due as string)) > 0;
    const dueThisWeek = (due: string | null) => Boolean(due) && parseISO(due as string) < weekEnd;
    const hours = (t: { estimate_hours?: number | null }) => Number(t.estimate_hours ?? 0);
    const projectsCount = rows.filter(
      r => r.health.state !== "done" && r.team.some(m => m.id === employee.id),
    ).length;
    return {
      employee,
      openTasks: open.length,
      overdue: open.filter(t => isOverdue(t.due_date)).length,
      projects: projectsCount,
      weekHours: open.filter(t => dueThisWeek(t.due_date)).reduce((n, t) => n + hours(t), 0),
      openHours: open.reduce((n, t) => n + hours(t), 0),
      unestimated: open.filter(t => t.estimate_hours == null).length,
      capacity: employee.weekly_capacity_hours ?? DEFAULT_WEEKLY_CAPACITY,
    };
  }).sort((a, b) => b.openTasks - a.openTasks);

  const weekAgo = subDays(now, 7);
  const twoWeeksAgo = subDays(now, 14);
  const doneTimes = [
    ...tasks.filter(t => t.status === "done").map(t => parseISO(t.completed_at ?? t.updated_at)),
    ...employeeTasks.filter(t => t.status === "done").map(t => parseISO(t.updated_at)),
  ];
  const doneThisWeek = doneTimes.filter(d => d >= weekAgo).length;
  const doneLastWeek = doneTimes.filter(d => d >= twoWeeksAgo && d < weekAgo).length;

  const notCompleted = rows.filter(r => r.health.state !== "done");
  const health = { ok: 0, risk: 0, late: 0, none: 0 };
  for (const r of notCompleted) {
    if (r.health.state === "ok") health.ok++;
    else if (r.health.state === "risk") health.risk++;
    else if (r.health.state === "late") health.late++;
    else health.none++;
  }

  const overdueTaskCount = rows.reduce((n, r) => n + (r.health.state === "done" ? 0 : r.health.overdueTasks), 0);
  const blockerProjects = Array.from(new Set(blockers.map(b => b.project?.title).filter((t): t is string => Boolean(t))));

  return {
    rows,
    attention,
    workload,
    kpis: {
      active: projects.filter(p => p.status === "active" || p.status === "review").length,
      total: projects.length,
      backlog: projects.filter(p => p.status === "backlog").length,
      completed: projects.filter(p => p.status === "completed").length,
      health,
      openBlockers: blockers.length,
      blockerProjects,
      doneThisWeek,
      doneLastWeek,
      overdueTasks: overdueTaskCount,
      overdueProjects: rows.filter(r => r.health.state !== "done" && r.health.overdueTasks > 0).length,
    },
  };
}
