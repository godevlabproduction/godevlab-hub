"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, differenceInCalendarDays, format, formatDistanceToNowStrict, parseISO, startOfDay } from "date-fns";
import { Check, Play, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getProjects, getAllProjectTasks, getEmployeeTasks, getPersonalTasks, getProjectAssignments, getOpenBlockers,
  getRunningTimer, startTimer, stopTimer, getTimeEntries,
  updateProjectTask, updateEmployeeTask, updatePersonalTask, createProjectTask, createPersonalTask,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { DEFAULT_WEEKLY_CAPACITY, taskOwner } from "@/lib/portfolio";
import { dueBucket, formatHours, TASK_STATUS_LABEL, type DueBucket } from "@/lib/planning";
import { KpiTile, PanelHeader, TypeChip } from "@/components/hub-ui";
import { TimerWidget, useNow, type TimerStartInput } from "@/components/timer-widget";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  EmployeeTask, PersonalTask, Project, ProjectTask, ProjectTaskStatus, ProjectUpdate, TimeEntry,
} from "@/types";

type Source = "project" | "assigned" | "personal";

/** One line in the day list, whichever table it came from. */
interface MyTask {
  key: string;
  id: string;
  source: Source;
  title: string;
  due: string | null;
  estimate: number | null;
  status: ProjectTaskStatus;
  projectId: string | null;
  projectTitle: string | null;
}

const SECTIONS: { key: DueBucket; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Today" },
  { key: "week", label: "Coming up" },
  { key: "later", label: "Later" },
  { key: "none", label: "No date" },
];

const TASK_QUERY_KEY: Record<Source, string> = {
  project: "project-tasks",
  assigned: "employee-tasks",
  personal: "personal-tasks",
};

const ROW_STATUSES: ProjectTaskStatus[] = ["todo", "in_progress", "review"];

const FIELD =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";
const LABEL = "mb-1 block font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ago = (iso: string) => formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
const hoursOf = (tasks: MyTask[]) => tasks.reduce((n, t) => n + (t.estimate ?? 0), 0);
const toNumber = (v: unknown): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

function greeting(now: Date): string {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** "1h 05m" style, used for logged time where a decimal hour would be too coarse. */
function formatLogged(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function dueLabel(due: string, today: Date): string {
  const d = parseISO(due);
  const diff = differenceInCalendarDays(d, today);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return format(d, d.getFullYear() === today.getFullYear() ? "EEE d MMM" : "d MMM yyyy");
}

function byDueThenTitle(a: MyTask, b: MyTask): number {
  if (a.due !== b.due) {
    if (!a.due) return 1;
    if (!b.due) return -1;
    return a.due.localeCompare(b.due);
  }
  if ((a.status === "in_progress") !== (b.status === "in_progress")) return a.status === "in_progress" ? -1 : 1;
  return a.title.localeCompare(b.title);
}

function buildMyTasks(input: {
  meId: string; projects: Project[]; tasks: ProjectTask[]; employeeTasks: EmployeeTask[]; personalTasks: PersonalTask[];
}): MyTask[] {
  const { meId } = input;
  const liveProjects = new Map(input.projects.filter(p => p.status !== "completed").map(p => [p.id, p.title]));
  const fromProjects = input.tasks
    .filter(t => taskOwner(t) === meId && t.status !== "done" && liveProjects.has(t.project_id))
    .map((t): MyTask => ({
      key: `project-${t.id}`, id: t.id, source: "project", title: t.title, due: t.due_date ?? null,
      estimate: toNumber(t.estimate_hours), status: t.status,
      projectId: t.project_id, projectTitle: liveProjects.get(t.project_id) ?? null,
    }));
  const assigned = input.employeeTasks
    .filter(t => t.assigned_to === meId && t.status !== "done")
    .map((t): MyTask => ({
      key: `assigned-${t.id}`, id: t.id, source: "assigned", title: t.title, due: t.due_date ?? null,
      estimate: toNumber(t.estimate_hours), status: t.status,
      projectId: t.project_id ?? null, projectTitle: t.project?.title ?? null,
    }));
  const personal = input.personalTasks
    .filter(t => t.created_by === meId && t.status !== "done")
    .map((t): MyTask => ({
      key: `personal-${t.id}`, id: t.id, source: "personal", title: t.title, due: t.due_date ?? null,
      estimate: null, status: t.status, projectId: null, projectTitle: null,
    }));
  return [...fromProjects, ...assigned, ...personal];
}

function SourceChip({ task }: { task: MyTask }) {
  const [text, tone] =
    task.source === "project"
      ? [task.projectTitle ?? "Project", "bg-info-soft text-info"]
      : task.source === "assigned"
        ? ["Assigned to me", "bg-violet-soft text-violet"]
        : ["Personal", "bg-foreground/10 text-muted-foreground"];
  return (
    <span className={cn("max-w-[14rem] truncate rounded-full px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.08em]", tone)}>
      {text}
    </span>
  );
}

function TaskRow({
  task, bucket, today, tracking, timerBusy, onDone, onStatus, onStart,
}: {
  task: MyTask; bucket: DueBucket; today: Date; tracking: boolean; timerBusy: boolean;
  onDone: (t: MyTask) => void; onStatus: (t: MyTask, s: ProjectTaskStatus) => void; onStart: (t: MyTask) => void;
}) {
  const isProject = task.source === "project";
  const daysLate = task.due ? differenceInCalendarDays(today, parseISO(task.due)) : 0;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border py-3 first:border-t-0">
      <button
        type="button"
        aria-label={`Mark "${task.title}" as done`}
        title="Mark as done"
        onClick={() => onDone(task)}
        className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/60 text-transparent transition-colors hover:border-ok hover:bg-ok-soft hover:text-ok focus-visible:border-ok focus-visible:text-ok focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Check className="size-3.5" strokeWidth={3} aria-hidden />
      </button>

      <div className="min-w-0 flex-1 basis-56">
        <p className="line-clamp-2 break-words text-[13.5px] font-semibold leading-snug text-foreground">{task.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <SourceChip task={task} />
          {task.due && (
            bucket === "overdue"
              ? <span className="font-semibold text-bad">{format(parseISO(task.due), "d MMM")} · {plural(daysLate, "day")} overdue</span>
              : <span>{dueLabel(task.due, today)}</span>
          )}
          <span className="font-mono">{formatHours(task.estimate)}</span>
          {!isProject && task.status === "in_progress" && <span className="text-info">In progress</span>}
        </div>
      </div>

      {isProject && (
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <select
            aria-label={`Status of "${task.title}"`}
            value={task.status}
            onChange={e => onStatus(task, e.target.value as ProjectTaskStatus)}
            className="h-7 rounded-full border border-input bg-background px-2.5 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {ROW_STATUSES.map(s => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
          </select>
          {tracking ? (
            <span className="flex h-7 items-center gap-1.5 px-2 font-mono text-xs text-ok">
              <span className="size-1.5 rounded-full bg-ok motion-safe:animate-pulse" aria-hidden />
              Tracking
            </span>
          ) : (
            <Button
              type="button" variant="outline" size="sm" disabled={timerBusy}
              aria-label={`Start timer for "${task.title}"`} onClick={() => onStart(task)}
            >
              <Play aria-hidden />
              Start timer
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

interface AddValues { kind: "personal" | "project"; title: string; projectId: string; due: string; estimate: number | null }

function QuickAdd({
  projects, pending, error, onAdd,
}: {
  projects: Project[]; pending: boolean; error: string | null; onAdd: (v: AddValues, done: () => void) => void;
}) {
  const uid = useId();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<AddValues["kind"]>("personal");
  const [projectId, setProjectId] = useState("");
  const [due, setDue] = useState("");
  const [estimate, setEstimate] = useState("");
  const isProject = kind === "project";
  const canSubmit = title.trim().length > 0 && (!isProject || projectId !== "") && !pending;

  return (
    <Card>
      <CardContent>
        <PanelHeader title="Quick add" aside="assigned to you" />
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={e => {
            e.preventDefault();
            if (!canSubmit) return;
            onAdd(
              { kind, title: title.trim(), projectId, due, estimate: isProject ? toNumber(estimate) : null },
              () => { setTitle(""); setDue(""); setEstimate(""); },
            );
          }}
        >
          <div className="min-w-48 flex-[3_1_14rem]">
            <label htmlFor={`${uid}-title`} className={LABEL}>Task</label>
            <Input id={`${uid}-title`} value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs doing?" maxLength={200} />
          </div>
          <div className="flex-[1_1_9rem]">
            <label htmlFor={`${uid}-kind`} className={LABEL}>Type</label>
            <select id={`${uid}-kind`} value={kind} onChange={e => setKind(e.target.value as AddValues["kind"])} className={FIELD}>
              <option value="personal">Personal task</option>
              <option value="project">Project task</option>
            </select>
          </div>
          {isProject && (
            <div className="flex-[2_1_11rem]">
              <label htmlFor={`${uid}-project`} className={LABEL}>Project</label>
              <select id={`${uid}-project`} value={projectId} onChange={e => setProjectId(e.target.value)} className={FIELD}>
                <option value="">Select project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
            </div>
          )}
          <div className="flex-[1_1_9rem]">
            <label htmlFor={`${uid}-due`} className={LABEL}>Due (optional)</label>
            <Input id={`${uid}-due`} type="date" value={due} onChange={e => setDue(e.target.value)} />
          </div>
          {isProject && (
            <div className="w-28">
              <label htmlFor={`${uid}-est`} className={LABEL}>Hours</label>
              <Input id={`${uid}-est`} type="number" inputMode="decimal" min="0" step="0.25" value={estimate} onChange={e => setEstimate(e.target.value)} placeholder="Estimate" />
            </div>
          )}
          <Button type="submit" disabled={!canSubmit}>
            <Plus aria-hidden />
            Add
          </Button>
        </form>
        {error && <p role="alert" className="mt-3 text-xs text-bad">{error}</p>}
      </CardContent>
    </Card>
  );
}

interface WeekDay { day: Date; count: number; hours: number }

function WeekStrip({ days, capacity }: { days: WeekDay[]; capacity: number }) {
  const hasHours = days.some(d => d.hours > 0);
  const max = Math.max(1, ...days.map(d => (hasHours ? d.hours : d.count)));
  const dayCap = capacity / 5;
  const empty = days.every(d => d.count === 0);
  return (
    <Card>
      <CardContent>
        <PanelHeader title="This week" aside="next 7 days" />
        <ol className="grid grid-cols-7 gap-1.5">
          {days.map((d, i) => {
            const size = hasHours ? d.hours : d.count;
            const pct = d.count === 0 ? 0 : Math.max(8, (size / max) * 100);
            return (
              <li
                key={i}
                title={`${format(d.day, "EEEE d MMM")}: ${plural(d.count, "task")}, ${formatHours(d.hours)}`}
                className={cn("flex flex-col items-center rounded-xl px-0.5 py-2", i === 0 && "bg-foreground/5")}
              >
                <span className="font-mono text-[10px] uppercase text-muted-foreground">{format(d.day, "EEE")}</span>
                <span className={cn("font-mono text-[13px] font-bold", i === 0 ? "text-primary" : "text-foreground")}>{format(d.day, "d")}</span>
                <div className="mt-2 flex h-16 w-full items-end justify-center border-b border-border" aria-hidden>
                  <div className={cn("w-3/5 rounded-t-md", d.hours > dayCap ? "bg-warn" : "bg-primary")} style={{ height: `${pct}%` }} />
                </div>
                <span className="mt-1.5 font-mono text-xs font-semibold text-foreground">{d.count}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{d.hours > 0 ? `${Math.round(d.hours * 10) / 10}h` : "-"}</span>
              </li>
            );
          })}
        </ol>
        <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
          {empty
            ? "Nothing is due in the next 7 days."
            : hasHours
              ? "Bars show estimated hours per due date. Amber means more than a day's share of your weekly capacity."
              : "Bars show task counts. Add estimates to see hours per day."}
        </p>
      </CardContent>
    </Card>
  );
}

function BlockersPanel({ blockers }: { blockers: ProjectUpdate[] }) {
  return (
    <Card>
      <CardContent>
        <PanelHeader title="Blockers on my projects" aside={plural(blockers.length, "open blocker")} />
        {blockers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is blocking your projects.</p>
        ) : (
          <ul className="space-y-2.5">
            {blockers.slice(0, 6).map(b => (
              <li key={b.id}>
                <Link
                  href={`/dashboard/projects/${b.project_id}`}
                  className="block rounded-2xl border border-border bg-foreground/5 p-3.5 transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <TypeChip type="blocker" />
                    <span className="text-[11.5px] text-muted-foreground">{ago(b.created_at)}</span>
                  </div>
                  <p className="mt-2 text-[13.5px] font-semibold leading-snug text-foreground">{b.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{b.project?.title ?? "Unknown project"}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {blockers.length > 6 && <p className="mt-3 text-xs text-muted-foreground">+{blockers.length - 6} more in Command Center</p>}
      </CardContent>
    </Card>
  );
}

export default function MyDayPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: me, isLoading: meLoading } = useCurrentEmployee();
  const meId = me?.id;
  const now = useNow(30_000);
  const clock = useMemo(() => now ?? new Date(), [now]);
  const today = useMemo(() => startOfDay(clock), [clock]);

  const [overrides, setOverrides] = useState<Record<string, ProjectTaskStatus>>({});
  const [taskError, setTaskError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [timerError, setTimerError] = useState<string | null>(null);

  const { data: projects = [], isLoading: projectsLoading } = useQuery({ queryKey: ["projects"], queryFn: () => getProjects(supabase), refetchInterval: 30000 });
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({ queryKey: ["project-tasks"], queryFn: () => getAllProjectTasks(supabase), refetchInterval: 30000 });
  const { data: employeeTasks = [] } = useQuery({ queryKey: ["employee-tasks"], queryFn: () => getEmployeeTasks(supabase) });
  const { data: personalTasks = [] } = useQuery({ queryKey: ["personal-tasks"], queryFn: () => getPersonalTasks(supabase) });
  const { data: assignments = [] } = useQuery({ queryKey: ["project-assignments"], queryFn: () => getProjectAssignments(supabase) });
  const { data: blockers = [] } = useQuery({ queryKey: ["open-blockers"], queryFn: () => getOpenBlockers(supabase), refetchInterval: 30000 });
  const { data: running = null } = useQuery({
    queryKey: ["running-timer", meId], queryFn: () => getRunningTimer(supabase, meId!), enabled: Boolean(meId), refetchInterval: 30000,
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["time-entries", meId],
    queryFn: () => getTimeEntries(supabase, { employeeId: meId!, since: startOfDay(new Date()).toISOString() }),
    enabled: Boolean(meId),
    refetchInterval: 60000,
  });

  const invalidate = (...keys: (string | undefined)[][]) =>
    Promise.all(keys.map(queryKey => queryClient.invalidateQueries({ queryKey })));
  const invalidateTimer = () => invalidate(["running-timer", meId], ["time-entries", meId]);

  const taskMutation = useMutation({
    mutationFn: async ({ task, status }: { task: MyTask; status: ProjectTaskStatus }) => {
      if (task.source === "project") return updateProjectTask(supabase, task.id, { status });
      const plain = status === "review" ? "in_progress" : status;
      return task.source === "assigned"
        ? updateEmployeeTask(supabase, task.id, { status: plain })
        : updatePersonalTask(supabase, task.id, { status: plain });
    },
    onMutate: ({ task, status }) => {
      setTaskError(null);
      setOverrides(o => ({ ...o, [task.key]: status }));
    },
    onSuccess: (_d, { task }) => invalidate([TASK_QUERY_KEY[task.source]]),
    onError: () => setTaskError("Couldn't update that task - check your connection and try again."),
    onSettled: (_d, _e, { task }) =>
      setOverrides(o => {
        const next = { ...o };
        delete next[task.key];
        return next;
      }),
  });

  const addMutation = useMutation({
    mutationFn: async (v: AddValues) => {
      const due_date = v.due || undefined;
      if (v.kind === "personal") return createPersonalTask(supabase, { title: v.title, due_date, created_by: me!.id });
      return createProjectTask(supabase, {
        project_id: v.projectId, title: v.title, due_date, estimate_hours: v.estimate, created_by: me!.id, assigned_to: me!.id,
      });
    },
    onMutate: () => setAddError(null),
    onSuccess: (_d, v) => invalidate([v.kind === "personal" ? "personal-tasks" : "project-tasks"]),
    onError: () => setAddError("Couldn't add the task. Try again."),
  });

  const startMutation = useMutation({
    mutationFn: (input: TimerStartInput) => startTimer(supabase, { employee_id: me!.id, ...input }),
    onMutate: () => setTimerError(null),
    onSuccess: entry => {
      queryClient.setQueryData(["running-timer", meId], entry);
      return invalidateTimer();
    },
    onError: () => setTimerError("Couldn't start the timer. Another tab may already have one running - refresh and try again."),
  });

  const stopMutation = useMutation({
    mutationFn: (entryId: string) => stopTimer(supabase, entryId),
    onMutate: () => setTimerError(null),
    onSuccess: () => {
      queryClient.setQueryData(["running-timer", meId], null);
      return invalidateTimer();
    },
    onError: () => setTimerError("Couldn't stop the timer - try again."),
  });

  const myTasks = useMemo(() => {
    if (!me) return [];
    return buildMyTasks({ meId: me.id, projects, tasks, employeeTasks, personalTasks })
      .map(t => (overrides[t.key] ? { ...t, status: overrides[t.key] } : t))
      .filter(t => t.status !== "done");
  }, [me, projects, tasks, employeeTasks, personalTasks, overrides]);

  const buckets = useMemo(() => {
    const groups: Record<DueBucket, MyTask[]> = { overdue: [], today: [], week: [], later: [], none: [] };
    for (const t of myTasks) groups[dueBucket(t.due, today)].push(t);
    for (const list of Object.values(groups)) list.sort(byDueThenTitle);
    return groups;
  }, [myTasks, today]);

  const activeProjects = useMemo(
    () => projects.filter(p => p.status === "active" || p.status === "review").sort((a, b) => a.title.localeCompare(b.title)),
    [projects],
  );

  const timerTasks = useMemo(
    () => myTasks
      .filter(t => t.source === "project" && t.projectId)
      .map(t => ({ id: t.id, title: t.title, projectId: t.projectId!, projectTitle: t.projectTitle ?? "Project" })),
    [myTasks],
  );

  const week = useMemo<WeekDay[]>(
    () => now === null ? [] : Array.from({ length: 7 }, (_, i) => {
      const list = myTasks.filter(t => t.due && differenceInCalendarDays(parseISO(t.due), today) === i);
      return { day: addDays(today, i), count: list.length, hours: hoursOf(list) };
    }),
    [myTasks, today, now],
  );

  const myBlockers = useMemo(() => {
    if (!meId) return [];
    const mine = new Set([
      ...assignments.filter(a => a.employee_id === meId).map(a => a.project_id),
      ...projects.filter(p => p.created_by === meId).map(p => p.id),
    ]);
    return blockers.filter(b => mine.has(b.project_id));
  }, [meId, assignments, projects, blockers]);

  const loggedMs = useMemo(() => {
    const byId = new Map<string, TimeEntry>(entries.map(e => [e.id, e]));
    if (running) byId.set(running.id, running);
    let total = 0;
    for (const e of byId.values()) {
      const start = Math.max(parseISO(e.started_at).getTime(), today.getTime());
      const end = e.ended_at ? parseISO(e.ended_at).getTime() : clock.getTime();
      if (end > start) total += end - start;
    }
    return total;
  }, [entries, running, today, clock]);

  const capacity = me?.weekly_capacity_hours ?? DEFAULT_WEEKLY_CAPACITY;
  const dueToday = buckets.today;
  const overdue = buckets.overdue;
  const plannedWeek = hoursOf([...overdue, ...dueToday, ...buckets.week]);
  const loading = meLoading || projectsLoading || tasksLoading;
  const firstName = me?.full_name.trim().split(/\s+/)[0];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">
          {now ? `${greeting(now)}${firstName ? `, ${firstName}` : ""}` : "My Day"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {now ? `${format(now, "EEEE, d MMM yyyy")} · ` : ""}
          {plural(dueToday.length, "task")} due today · {formatHours(hoursOf(dueToday))} planned
          {overdue.length > 0 && <span className="font-semibold text-bad"> · {overdue.length} overdue</span>}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <TimerWidget
          running={running}
          tasks={timerTasks}
          projects={activeProjects}
          pending={startMutation.isPending || stopMutation.isPending || !me}
          error={timerError}
          onStart={input => startMutation.mutate(input)}
          onStop={id => stopMutation.mutate(id)}
        />
        <section aria-label="Key numbers" className="grid grid-cols-2 gap-4">
          <KpiTile
            label="Due today" value={dueToday.length}
            sub={dueToday.length > 0 ? `${formatHours(hoursOf(dueToday))} planned` : "Nothing due today"}
          />
          <KpiTile
            label="Overdue" value={overdue.length} valueClassName={overdue.length > 0 ? "text-bad" : undefined}
            sub={overdue.length > 0 ? "Needs your attention" : "You're on schedule"}
          />
          <KpiTile
            label="Planned this week" value={formatHours(plannedWeek)} valueClassName={plannedWeek > capacity ? "text-warn" : undefined}
            sub={`of ${capacity} h capacity`}
          />
          <KpiTile
            label="Logged today" value={formatLogged(loggedMs)}
            sub={running ? "Includes the running timer" : loggedMs > 0 ? "Timer stopped" : "Nothing logged yet"}
          />
        </section>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <QuickAdd
            projects={activeProjects}
            pending={addMutation.isPending || !me}
            error={addError}
            onAdd={(v, done) => addMutation.mutate(v, { onSuccess: done })}
          />

          <Card>
            <CardContent>
              <PanelHeader title="My tasks" aside={`${plural(myTasks.length, "open task")} · ${formatHours(hoursOf(myTasks))} estimated`} />
              {taskError && <p role="alert" className="mb-3 text-xs text-bad">{taskError}</p>}
              {loading && <p className="border-t border-border py-6 text-sm text-muted-foreground">Loading your day…</p>}
              {!loading && myTasks.length === 0 && (
                <div className="flex flex-col items-center gap-2 border-t border-border py-10 text-center">
                  <span className="flex size-10 items-center justify-center rounded-full bg-ok-soft text-ok"><Check className="size-5" aria-hidden /></span>
                  <p className="text-sm font-semibold text-foreground">Nothing on your plate</p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    You have no open tasks. Add one above, or start a timer for general work.
                  </p>
                </div>
              )}
              <div className="space-y-5">
                {!loading && SECTIONS.map(({ key, label }) => {
                  const list = buckets[key];
                  if (list.length === 0) return null;
                  return (
                    <section key={key} aria-label={label}>
                      <div className="mb-1 flex items-baseline justify-between gap-3">
                        <h3 className={cn("font-mono text-[10.5px] font-medium uppercase tracking-[0.1em]", key === "overdue" ? "text-bad" : "text-muted-foreground")}>
                          {label} <span className="ml-1 text-muted-foreground">{list.length}</span>
                        </h3>
                        {hoursOf(list) > 0 && <span className="font-mono text-[11px] text-muted-foreground">{formatHours(hoursOf(list))}</span>}
                      </div>
                      <ul className="border-t border-border">
                        {list.map(t => (
                          <TaskRow
                            key={t.key} task={t} bucket={key} today={today}
                            tracking={t.source === "project" && running?.task_id === t.id}
                            timerBusy={startMutation.isPending || !me}
                            onDone={task => taskMutation.mutate({ task, status: "done" })}
                            onStatus={(task, status) => taskMutation.mutate({ task, status })}
                            onStart={task => startMutation.mutate({ project_id: task.projectId, task_id: task.id })}
                          />
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <BlockersPanel blockers={myBlockers} />
          {now && <WeekStrip days={week} capacity={capacity} />}
        </div>
      </div>
    </div>
  );
}
