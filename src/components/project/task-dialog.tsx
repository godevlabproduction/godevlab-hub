"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { createProjectTask, deleteProjectTask, updateProject, updateProjectTask } from "@/lib/supabase/queries";
import { TASK_COLUMNS } from "@/lib/planning";
import type { ProjectTask, ProjectTaskStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { fieldCls, labelCls } from "./form-styles";
import type { Cockpit } from "./use-cockpit";

interface Props {
  cockpit: Cockpit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create a new task */
  task: ProjectTask | null;
  defaultStatus?: ProjectTaskStatus;
}

export function TaskDialog({ cockpit, open, onOpenChange, task, defaultStatus = "todo" }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {/* mounted only while open, so every open starts from fresh form state */}
        <TaskForm cockpit={cockpit} onOpenChange={onOpenChange} task={task} defaultStatus={defaultStatus} />
      </DialogContent>
    </Dialog>
  );
}

function TaskForm({ cockpit, onOpenChange, task, defaultStatus }: Omit<Props, "open"> & { defaultStatus: ProjectTaskStatus }) {
  const supabase = createClient();
  const { me, project, employees, canEdit, isAdmin, invalidate } = cockpit;

  const [title, setTitle] = useState(task?.title ?? "");
  const [details, setDetails] = useState(task?.details ?? "");
  const [status, setStatus] = useState<ProjectTaskStatus>(task?.status ?? defaultStatus);
  const [assignee, setAssignee] = useState(task ? (task.assigned_to ?? "") : (me?.id ?? ""));
  const [due, setDue] = useState(task?.due_date ?? "");
  const [estimate, setEstimate] = useState(task?.estimate_hours != null ? String(task.estimate_hours) : "");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const done = () => {
    invalidate(["project-tasks"], ["projects"], ["notifications-unread"]);
    onOpenChange(false);
  };

  const save = useMutation({
    mutationFn: async () => {
      const hours = estimate.trim() === "" ? null : Number(estimate);
      if (hours !== null && (Number.isNaN(hours) || hours < 0 || hours > 999)) {
        throw new Error("Estimate must be a number of hours between 0 and 999.");
      }
      const payload = {
        title: title.trim(),
        details: details.trim() || null,
        status,
        due_date: due || null,
        assigned_to: assignee || null,
        estimate_hours: hours,
      };
      if (task) {
        await updateProjectTask(supabase, task.id, payload);
        return;
      }
      await createProjectTask(supabase, {
        project_id: project!.id,
        created_by: me!.id,
        title: payload.title,
        details: payload.details ?? undefined,
        due_date: payload.due_date ?? undefined,
        assigned_to: payload.assigned_to,
        estimate_hours: payload.estimate_hours,
        status,
      });
      if (project && (project.status === "completed" || project.status === "backlog")) {
        await updateProject(supabase, project.id, { status: "active" });
      }
    },
    onSuccess: done,
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteProjectTask(supabase, task!.id),
    onSuccess: done,
    onError: (e: Error) => setError(e.message),
  });

  const canSave = title.trim().length > 0 && Boolean(me && project) && !save.isPending;
  const mayDelete = Boolean(task && (isAdmin || task.created_by === me?.id));

  return (
    <>
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={e => {
            e.preventDefault();
            if (canSave) save.mutate();
          }}
          className="space-y-3"
        >
          <div>
            <label htmlFor="task-title" className={labelCls}>Title</label>
            <Input id="task-title" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="What needs to happen?" />
          </div>
          <div>
            <label htmlFor="task-details" className={labelCls}>Details</label>
            <Textarea id="task-details" rows={3} value={details} onChange={e => setDetails(e.target.value)} placeholder="Context or acceptance criteria" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="task-status" className={labelCls}>Status</label>
              <select id="task-status" className={fieldCls} value={status} onChange={e => setStatus(e.target.value as ProjectTaskStatus)}>
                {TASK_COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="task-assignee" className={labelCls}>Assignee</label>
              <select id="task-assignee" className={fieldCls} value={assignee} onChange={e => setAssignee(e.target.value)}>
                <option value="">Unassigned</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="task-due" className={labelCls}>Due date</label>
              <input id="task-due" type="date" className={fieldCls} value={due} onChange={e => setDue(e.target.value)} />
            </div>
            <div>
              <label htmlFor="task-estimate" className={labelCls}>Estimate (hours)</label>
              <input
                id="task-estimate"
                type="number"
                inputMode="decimal"
                min={0}
                max={999}
                step={0.5}
                className={fieldCls}
                value={estimate}
                onChange={e => setEstimate(e.target.value)}
                placeholder="e.g. 2.5"
              />
            </div>
          </div>
          {error && <p className="text-xs text-bad">{error}</p>}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div>
              {task && mayDelete && (
                confirmDelete ? (
                  <Button type="button" variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
                    {remove.isPending ? "Deleting…" : "Confirm delete"}
                  </Button>
                ) : (
                  <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmDelete(true)}>
                    Delete
                  </Button>
                )
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={!canSave || (task !== null && !canEdit && task.assigned_to !== me?.id && task.created_by !== me?.id)}>
                {save.isPending ? "Saving…" : task ? "Save" : "Create task"}
              </Button>
            </div>
          </div>
        </form>
    </>
  );
}
