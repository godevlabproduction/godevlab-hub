"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { PlusCircle, Trash2, CheckSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getPersonalTasks, createPersonalTask, updatePersonalTask, deletePersonalTask,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { TaskStatus } from "@/types";

const statusStyles: Record<TaskStatus, string> = {
  todo: "border-border bg-foreground/10 text-muted-foreground",
  in_progress: "border-info/30 bg-info-soft text-info",
  done: "border-ok/30 bg-ok-soft text-ok",
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

export default function PersonalTasksPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: employee } = useCurrentEmployee();

  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [dueDate, setDueDate] = useState("");

  const { data: tasks = [] } = useQuery({
    queryKey: ["personal-tasks"],
    queryFn: () => getPersonalTasks(supabase),
  });

  const createMutation = useMutation({
    mutationFn: () => createPersonalTask(supabase, {
      title,
      details: details || undefined,
      due_date: dueDate || undefined,
      created_by: employee!.id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["personal-tasks"] });
      setTitle(""); setDetails(""); setDueDate("");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      updatePersonalTask(supabase, taskId, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["personal-tasks"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => deletePersonalTask(supabase, taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["personal-tasks"] }),
  });

  const canCreate = Boolean(title.trim() && employee);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Tasks</h1>
        <p className="mt-1 text-sm text-muted-foreground">Your private to-do list. Only you can see these.</p>
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
                <label className="mb-1.5 block text-sm font-medium">Due date (optional)</label>
                <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <Button
                type="submit"
                className="w-full bg-brand-700 hover:bg-brand-800"
                disabled={!canCreate || createMutation.isPending}
              >
                <PlusCircle className="mr-2 h-4 w-4" />
                {createMutation.isPending ? "Creating..." : "Add Task"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {tasks.length === 0 ? (
            <Card>
              <CardContent className="flex min-h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <CheckSquare className="h-6 w-6" />
                No tasks yet.
              </CardContent>
            </Card>
          ) : tasks.map(task => (
            <Card key={task.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{task.title}</p>
                    {task.details && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{task.details}</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-red-600"
                      onClick={() => deleteMutation.mutate(task.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
