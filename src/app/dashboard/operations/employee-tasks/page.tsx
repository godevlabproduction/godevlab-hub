"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { PlusCircle, Trash2, ClipboardList } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getEmployeeTasks, createEmployeeTask, updateEmployeeTask, deleteEmployeeTask,
  getEmployees, getProjects,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { TaskStatus } from "@/types";

const statusStyles: Record<TaskStatus, string> = {
  todo: "border-gray-200 bg-gray-100 text-gray-600",
  in_progress: "border-brand-300 bg-brand-50 text-brand-700",
  done: "border-green-200 bg-green-50 text-green-700",
};

const statusLabels: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
};

const nextStatus: Record<TaskStatus, TaskStatus> = {
  todo: "in_progress",
  in_progress: "done",
  done: "todo",
};

export default function EmployeeTasksPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: employee } = useCurrentEmployee();

  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [projectId, setProjectId] = useState("");
  const [dueDate, setDueDate] = useState("");

  const { data: tasks = [] } = useQuery({ queryKey: ["employee-tasks"], queryFn: () => getEmployeeTasks(supabase) });
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: () => getEmployees(supabase) });
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => getProjects(supabase) });

  const createMutation = useMutation({
    mutationFn: () => createEmployeeTask(supabase, {
      title,
      details: details || undefined,
      assigned_to: assignedTo,
      project_id: projectId || undefined,
      due_date: dueDate || undefined,
      created_by: employee!.id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-tasks"] });
      setTitle(""); setDetails(""); setAssignedTo(""); setProjectId(""); setDueDate("");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      updateEmployeeTask(supabase, taskId, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee-tasks"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => deleteEmployeeTask(supabase, taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["employee-tasks"] }),
  });

  const canCreate = Boolean(title.trim() && assignedTo && employee);
  const canManage = (createdBy: string) => employee?.role === "admin" || createdBy === employee?.id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Employee Tasks</h1>
        <p className="mt-1 text-sm text-muted-foreground">Assign tasks to team members.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader><CardTitle className="text-base">New Task</CardTitle></CardHeader>
          <CardContent>
            <form
              onSubmit={e => { e.preventDefault(); if (canCreate) createMutation.mutate(); }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1.5 block text-sm font-medium">Title</label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Task title" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Details</label>
                <Textarea value={details} onChange={e => setDetails(e.target.value)} placeholder="Optional details..." rows={3} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Assign to</label>
                <select
                  value={assignedTo}
                  onChange={e => setAssignedTo(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">Select employee</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}{emp.id === employee?.id ? " (you)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Project (optional)</label>
                <select
                  value={projectId}
                  onChange={e => setProjectId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">No project</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Due date (optional)</label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <Button
                type="submit"
                className="w-full bg-brand-700 hover:bg-brand-800"
                disabled={!canCreate || createMutation.isPending}
              >
                <PlusCircle className="mr-2 h-4 w-4" />
                {createMutation.isPending ? "Creating..." : "Create Task"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {tasks.length === 0 ? (
            <Card>
              <CardContent className="flex min-h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <ClipboardList className="h-6 w-6" />
                No tasks yet.
              </CardContent>
            </Card>
          ) : tasks.map(task => (
            <Card key={task.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">{task.title}</p>
                    {task.details && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{task.details}</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-medium text-brand-700">
                        → {task.assignee?.full_name ?? "Unknown"}
                      </span>
                      {task.project && <span>{task.project.title}</span>}
                      {task.due_date && <span>Due {format(new Date(task.due_date), "MMM d, yyyy")}</span>}
                      <span>{formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => updateMutation.mutate({ taskId: task.id, status: nextStatus[task.status] })}
                      disabled={updateMutation.isPending}
                    >
                      <Badge variant="outline" className={`cursor-pointer text-xs ${statusStyles[task.status]}`}>
                        {statusLabels[task.status]}
                      </Badge>
                    </button>
                    {canManage(task.created_by) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-red-600"
                        onClick={() => deleteMutation.mutate(task.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
