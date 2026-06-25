"use client";

import { useQuery } from "@tanstack/react-query";
import { addDays, format, formatDistanceToNow, isAfter } from "date-fns";
import { CheckSquare, Clock, FolderKanban, Lightbulb } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getProjects, getAllProjectTasks, getRecentUpdates, getNotes } from "@/lib/supabase/queries";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

export default function DashboardPage() {
  const supabase = createClient();

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(supabase),
    refetchInterval: 30000,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["project-tasks"],
    queryFn: () => getAllProjectTasks(supabase),
  });

  const { data: recentUpdates = [] } = useQuery({
    queryKey: ["recent-updates"],
    queryFn: () => getRecentUpdates(supabase, 5),
  });

  const { data: notes = [] } = useQuery({
    queryKey: ["notes"],
    queryFn: () => getNotes(supabase),
  });

  const activeProjects = projects.filter(p => p.status !== "completed");
  const openTasks = tasks.filter(t => t.status !== "done");
  const completedTasks = tasks.filter(t => t.status === "done");
  const taskCompletionRate = tasks.length === 0 ? 0 : Math.round((completedTasks.length / tasks.length) * 100);

  const upcomingDeadlines = projects
    .filter(p =>
      p.due_date &&
      p.status !== "completed" &&
      isAfter(addDays(new Date(p.due_date), 1), new Date())
    )
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Team pulse, active work, and the latest project progress from GoDevLab.
          </p>
        </div>
        <Link href="/dashboard/projects" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <FolderKanban className="mr-2 h-4 w-4" />
          Open Projects
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Active Projects" value={activeProjects.length} subtitle={`${projects.length} total`} icon={FolderKanban} iconColor="text-sky-600" />
        <StatCard title="Open Tasks" value={openTasks.length} subtitle={`${taskCompletionRate}% completion rate`} icon={CheckSquare} iconColor="text-emerald-600" />
        <StatCard title="Completed Tasks" value={completedTasks.length} subtitle={`across all projects`} icon={Clock} iconColor="text-brand-700" />
        <StatCard title="Notes" value={notes.length} subtitle="global and per-project" icon={Lightbulb} iconColor="text-amber-600" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Project Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {recentUpdates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No project updates yet.</p>
            ) : (
              <div className="space-y-4">
                {recentUpdates.map(update => (
                  <div key={update.id} className="flex items-start justify-between gap-4 border-b pb-4 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{update.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{update.details}</p>
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-brand-700">{update.employee?.full_name ?? "Unknown"}</span>
                        <span className="capitalize">{update.update_type}</span>
                      </div>
                    </div>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(update.created_at), { addSuffix: true })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Upcoming Deadlines</CardTitle></CardHeader>
            <CardContent>
              {upcomingDeadlines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No due dates scheduled.</p>
              ) : (
                <div className="space-y-3">
                  {upcomingDeadlines.map(project => (
                    <div key={project.id} className="rounded-lg border border-gray-200 px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{project.title}</p>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="capitalize">{project.status}</span>
                        <span>{project.due_date ? format(new Date(project.due_date), "MMM d, yyyy") : ""}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Workflow Snapshot</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Tasks completed</span>
                  <span className="font-medium text-gray-900">{completedTasks.length}/{tasks.length}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div className="h-2 rounded-full bg-brand-700 transition-all" style={{ width: `${taskCompletionRate}%` }} />
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
                <p className="text-sm text-muted-foreground">
                  {activeProjects.length === 0
                    ? "Add a project to start tracking work."
                    : `${activeProjects.length} active project${activeProjects.length > 1 ? "s" : ""} moving, ${openTasks.length} open tasks in progress.`}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
