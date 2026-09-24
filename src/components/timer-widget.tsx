"use client";

import { useCallback, useEffect, useId, useState, useSyncExternalStore } from "react";
import { parseISO } from "date-fns";
import { Play, Square } from "lucide-react";
import type { TimeEntry } from "@/types";
import { PanelHeader } from "@/components/hub-ui";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// "Now working on" card for My Day. Presentational: the page owns the queries
// and mutations, this file owns the ticking clock and the start/stop controls.

export interface TimerTask {
  id: string;
  title: string;
  projectId: string;
  projectTitle: string;
}

export interface TimerProject {
  id: string;
  title: string;
}

export interface TimerStartInput {
  project_id: string | null;
  task_id: string | null;
}

const FIELD =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";
const LABEL = "mb-1 block font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground";

const pad = (n: number) => String(n).padStart(2, "0");

/** 3725000 ms -> "01:02:05". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/**
 * A coarse shared clock for "what day is it / how much is logged" figures.
 * Returns null on the server and during hydration so time-of-day text never
 * mismatches, then a Date that refreshes every `intervalMs`.
 */
export function useNow(intervalMs = 30_000): Date | null {
  const subscribe = useCallback(
    (notify: () => void) => {
      const id = setInterval(notify, intervalMs);
      return () => clearInterval(id);
    },
    [intervalMs],
  );
  // The snapshot is quantised so consecutive reads return the same value.
  const stamp = useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    () => null,
  );
  return stamp === null ? null : new Date(stamp);
}

function RunningView({ entry, pending, onStop }: { entry: TimeEntry; pending: boolean; onStop: (entryId: string) => void }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const title = entry.task?.title ?? entry.project?.title ?? "General work";
  const detail = entry.task
    ? entry.project?.title ?? "No project"
    : entry.project
      ? "General work"
      : entry.note || "No project";
  const elapsed = tick - parseISO(entry.started_at).getTime();

  return (
    <div className="flex flex-1 flex-col justify-between gap-4">
      <div className="min-w-0">
        <p className="line-clamp-2 break-words text-[15px] font-semibold leading-snug text-foreground">{title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="timer" aria-label="Elapsed time" className="font-mono text-3xl font-bold tabular-nums leading-none text-foreground">
          {formatClock(elapsed)}
        </p>
        <Button type="button" variant="outline" disabled={pending} onClick={() => onStop(entry.id)}>
          <Square className="size-3.5" aria-hidden />
          Stop
        </Button>
      </div>
    </div>
  );
}

function IdleView({
  tasks, projects, pending, onStart,
}: {
  tasks: TimerTask[];
  projects: TimerProject[];
  pending: boolean;
  onStart: (input: TimerStartInput) => void;
}) {
  const uid = useId();
  const [choice, setChoice] = useState(""); // "" = general work, else a task id
  const [projectId, setProjectId] = useState("");
  const task = tasks.find(t => t.id === choice);

  const byProject = new Map<string, { title: string; tasks: TimerTask[] }>();
  for (const t of tasks) {
    const group = byProject.get(t.projectId) ?? { title: t.projectTitle, tasks: [] };
    group.tasks.push(t);
    byProject.set(t.projectId, group);
  }

  return (
    <form
      className="flex flex-1 flex-col justify-between gap-3"
      onSubmit={e => {
        e.preventDefault();
        onStart(task ? { project_id: task.projectId, task_id: task.id } : { project_id: projectId || null, task_id: null });
      }}
    >
      <div className="space-y-3">
        <div>
          <label htmlFor={`${uid}-what`} className={LABEL}>Working on</label>
          <select id={`${uid}-what`} value={task ? choice : ""} onChange={e => setChoice(e.target.value)} className={FIELD}>
            <option value="">General work</option>
            {Array.from(byProject.entries()).map(([id, group]) => (
              <optgroup key={id} label={group.title}>
                {group.tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        {!task && (
          <div>
            <label htmlFor={`${uid}-project`} className={LABEL}>Project</label>
            <select id={`${uid}-project`} value={projectId} onChange={e => setProjectId(e.target.value)} className={FIELD}>
              <option value="">No project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
        )}
        {tasks.length === 0 && (
          <p className="text-xs text-muted-foreground">No open project tasks - track general work or add a task below.</p>
        )}
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        <Play className="size-3.5" aria-hidden />
        Start timer
      </Button>
    </form>
  );
}

export function TimerWidget({
  running, tasks, projects, pending, error, onStart, onStop,
}: {
  running: TimeEntry | null;
  tasks: TimerTask[];
  projects: TimerProject[];
  pending: boolean;
  error?: string | null;
  onStart: (input: TimerStartInput) => void;
  onStop: (entryId: string) => void;
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col">
        <PanelHeader
          title="Now working on"
          aside={
            <span className={cn("flex items-center gap-1.5", running && "text-ok")}>
              <span className={cn("size-1.5 rounded-full", running ? "bg-ok motion-safe:animate-pulse" : "bg-muted-foreground")} aria-hidden />
              {running ? "Tracking" : "Idle"}
            </span>
          }
        />
        {running ? (
          <RunningView key={running.id} entry={running} pending={pending} onStop={onStop} />
        ) : (
          <IdleView tasks={tasks} projects={projects} pending={pending} onStart={onStart} />
        )}
        {error && <p role="alert" className="mt-3 text-xs text-bad">{error}</p>}
      </CardContent>
    </Card>
  );
}
