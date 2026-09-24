"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { differenceInCalendarDays, format, parseISO, startOfDay } from "date-fns";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { updateProjectTask } from "@/lib/supabase/queries";
import { TASK_COLUMNS, formatHours } from "@/lib/planning";
import type { ProjectTask, ProjectTaskStatus } from "@/types";
import { Avatar } from "@/components/hub-ui";
import { cn } from "@/lib/utils";
import { fieldCls } from "./form-styles";
import { TaskDialog } from "./task-dialog";
import type { Cockpit } from "./use-cockpit";

const COLUMN_DOT: Record<ProjectTaskStatus, string> = {
  todo: "bg-muted-foreground",
  in_progress: "bg-info",
  review: "bg-violet",
  done: "bg-ok",
};

export function BoardTab({ cockpit }: { cockpit: Cockpit }) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { tasks, employees, me, canEdit } = cockpit;

  const [filter, setFilter] = useState<string>("all");
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<ProjectTaskStatus | null>(null);
  const [dialog, setDialog] = useState<{ task: ProjectTask | null; status: ProjectTaskStatus } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const today = startOfDay(new Date());
  const byId = new Map(employees.map(e => [e.id, e]));

  // Tasks can be moved by their owner or anyone who can edit the project.
  const canMove = (t: ProjectTask) => canEdit || t.assigned_to === me?.id;

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProjectTaskStatus }) => updateProjectTask(supabase, id, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["project-tasks"] });
      const previous = queryClient.getQueryData<ProjectTask[]>(["project-tasks"]);
      queryClient.setQueryData<ProjectTask[]>(["project-tasks"], old => (old ?? []).map(t => (t.id === id ? { ...t, status } : t)));
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(["project-tasks"], ctx.previous);
      setError("Couldn't move that task. You may not have permission on this project.");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["project-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const requestMove = (task: ProjectTask, status: ProjectTaskStatus) => {
    if (task.status === status || !canMove(task)) return;
    setError(null);
    move.mutate({ id: task.id, status });
  };

  const people = Array.from(new Set(tasks.map(t => t.assigned_to).filter((id): id is string => Boolean(id))))
    .map(id => byId.get(id))
    .filter((e): e is (typeof employees)[number] => Boolean(e));
  const unassignedCount = tasks.filter(t => !t.assigned_to).length;
  const visible = tasks.filter(t => filter === "all" || (filter === "unassigned" ? !t.assigned_to : t.assigned_to === filter));

  const chip = (key: string, label: string, count: number) => (
    <button
      key={key}
      type="button"
      aria-pressed={filter === key}
      onClick={() => setFilter(key)}
      className={cn(
        "flex h-8 items-center gap-2 rounded-full border px-3.5 font-mono text-xs font-medium transition-colors",
        filter === key ? "border-foreground bg-foreground text-background" : "border-foreground/15 text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      {label}
      <span className={cn("text-[11px]", filter === key ? "opacity-70" : "text-muted-foreground")}>{count}</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter tasks by person" className="flex flex-wrap gap-2">
          {chip("all", "Everyone", tasks.length)}
          {people.map(p => chip(p.id, p.id === me?.id ? "Me" : p.full_name.split(" ")[0], tasks.filter(t => t.assigned_to === p.id).length))}
          {unassignedCount > 0 && chip("unassigned", "Unassigned", unassignedCount)}
        </div>
        {error && <p className="text-xs text-bad">{error}</p>}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {TASK_COLUMNS.map(col => {
          const cards = visible.filter(t => t.status === col.key);
          const hours = cards.reduce((n, t) => n + Number(t.estimate_hours ?? 0), 0);
          return (
            <section
              key={col.key}
              aria-label={col.label}
              onDragOver={e => { if (dragId) { e.preventDefault(); setOverCol(col.key); } }}
              onDragLeave={() => setOverCol(c => (c === col.key ? null : c))}
              onDrop={e => {
                e.preventDefault();
                const task = tasks.find(t => t.id === dragId);
                setDragId(null);
                setOverCol(null);
                if (task) requestMove(task, col.key);
              }}
              className={cn(
                "glass-panel glass-panel--tile flex min-h-[220px] flex-col gap-3 p-3.5 transition-shadow",
                overCol === col.key && "ring-2 ring-primary/60",
              )}
            >
              <header className="flex items-center justify-between gap-2 px-1">
                <h3 className="flex items-center gap-2 font-mono text-[13px] font-semibold text-foreground">
                  <span className={cn("size-2 rounded-full", COLUMN_DOT[col.key])} aria-hidden />
                  {col.label}
                  <span className="text-muted-foreground">{cards.length}</span>
                </h3>
                <div className="flex items-center gap-1.5">
                  {hours > 0 && <span className="font-mono text-[11px] text-muted-foreground">{formatHours(hours)}</span>}
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Add a task to ${col.label}`}
                      onClick={() => setDialog({ task: null, status: col.key })}
                      className="rounded-full p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </header>

              {cards.length === 0 && (
                <p className="rounded-xl border border-dashed border-foreground/15 px-3 py-6 text-center text-xs text-muted-foreground">
                  {dragId ? "Drop here" : "Nothing here"}
                </p>
              )}

              {cards.map(task => {
                const owner = task.assigned_to ? byId.get(task.assigned_to) : undefined;
                const overdue = task.status !== "done" && task.due_date ? differenceInCalendarDays(today, parseISO(task.due_date)) > 0 : false;
                return (
                  <div
                    key={task.id}
                    role="button"
                    tabIndex={0}
                    draggable={canMove(task)}
                    onDragStart={e => {
                      // Firefox only starts a drag when the event carries data
                      e.dataTransfer.setData("text/plain", task.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(task.id);
                    }}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    onClick={() => setDialog({ task, status: task.status })}
                    onKeyDown={e => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setDialog({ task, status: task.status });
                      }
                    }}
                    className={cn(
                      "cursor-pointer rounded-2xl border border-border bg-foreground/[0.04] p-3 text-left outline-none transition-colors hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-ring/60",
                      dragId === task.id && "opacity-40",
                    )}
                  >
                    <p className={cn("text-[13.5px] font-medium leading-snug text-foreground", task.status === "done" && "text-muted-foreground line-through")}>
                      {task.title}
                    </p>
                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                        {owner ? <Avatar employee={owner} size={22} /> : <span className="text-[11px] font-semibold text-bad">Unassigned</span>}
                        {task.due_date && (
                          <span className={cn("truncate", overdue && "font-semibold text-bad")}>
                            {format(parseISO(task.due_date), "d MMM")}{overdue ? " · overdue" : ""}
                          </span>
                        )}
                      </div>
                      {task.estimate_hours != null && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{formatHours(task.estimate_hours)}</span>}
                    </div>
                    {canMove(task) && (
                      <div className="mt-2.5" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                        <label className="sr-only" htmlFor={`status-${task.id}`}>Status of {task.title}</label>
                        <select
                          id={`status-${task.id}`}
                          className={cn(fieldCls, "h-8 text-xs")}
                          value={task.status}
                          onChange={e => requestMove(task, e.target.value as ProjectTaskStatus)}
                        >
                          {TASK_COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      <TaskDialog
        cockpit={cockpit}
        open={dialog !== null}
        onOpenChange={o => { if (!o) setDialog(null); }}
        task={dialog?.task ?? null}
        defaultStatus={dialog?.status}
      />
    </div>
  );
}
