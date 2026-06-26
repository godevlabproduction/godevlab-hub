"use client";

import { useQuery } from "@tanstack/react-query";
import { addDays, format, formatDistanceToNow, isAfter } from "date-fns";
import { CheckSquare, Clock, FolderKanban, Lightbulb } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  getProjects, getAllProjectTasks, getRecentUpdates, getNotes,
  getEmployeeTasks, getPersonalTasks,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

type DeadlineItem = { id: string; title: string; subtitle: string; due_date: string };
type ActivityItem =
  | { kind: "update"; id: string; title: string; details: string; who: string; type: string; date: string }
  | { kind: "task"; id: string; title: string; source: string; date: string };

export default function DashboardPage() {
  const supabase = createClient();
  const { data: employee } = useCurrentEmployee();

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(supabase),
    refetchInterval: 30000,
  });

  const { data: projectTasks = [] } = useQuery({
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

  const { data: employeeTasks = [] } = useQuery({
    queryKey: ["employee-tasks"],
    queryFn: () => getEmployeeTasks(supabase),
  });

  const { data: personalTasks = [] } = useQuery({
    queryKey: ["personal-tasks"],
    queryFn: () => getPersonalTasks(supabase),
  });

  const myEmployeeTasks = employee ? employeeTasks.filter(t => t.assigned_to === employee.id) : [];

  const allOpenTasks = [
    ...projectTasks.filter(t => t.status !== "done"),
    ...myEmployeeTasks.filter(t => t.status !== "done"),
    ...personalTasks.filter(t => t.status !== "done"),
  ];

  const allCompletedTasks = [
    ...projectTasks.filter(t => t.status === "done"),
    ...myEmployeeTasks.filter(t => t.status === "done"),
    ...personalTasks.filter(t => t.status === "done"),
  ];

  const totalTasks = projectTasks.length + myEmployeeTasks.length + personalTasks.length;
  const taskCompletionRate = totalTasks === 0 ? 0 : Math.round((allCompletedTasks.length / totalTasks) * 100);
  const activeProjects = projects.filter(p => p.status !== "completed");

  const upcomingDeadlines: DeadlineItem[] = [
    ...projects
      .filter(p => p.due_date && p.status !== "completed" && isAfter(addDays(new Date(p.due_date), 1), new Date()))
      .map(p => ({ id: p.id, title: p.title, subtitle: p.status, due_date: p.due_date! })),
    ...myEmployeeTasks
      .filter(t => t.due_date && t.status !== "done" && isAfter(addDays(new Date(t.due_date), 1), new Date()))
      .map(t => ({ id: t.id, title: t.title, subtitle: `→ ${t.assignee?.full_name ?? "me"}`, due_date: t.due_date! })),
    ...personalTasks
      .filter(t => t.due_date && t.status !== "done" && isAfter(addDays(new Date(t.due_date), 1), new Date()))
      .map(t => ({ id: t.id, title: t.title, subtitle: "Personal", due_date: t.due_date! })),
  ]
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 5);

  const recentActivity: ActivityItem[] = [
    ...recentUpdates.map(u => ({
      kind: "update" as const,
      id: u.id,
      title: u.title,
      details: u.details,
      who: u.employee?.full_name ?? "Unknown",
      type: u.update_type,
      date: u.created_at,
    })),
    ...employeeTasks
      .filter(t => t.status === "done")
      .map(t => ({
        kind: "task" as const,
        id: t.id,
        title: t.title,
        source: `Employee task · ${t.assignee?.full_name ?? "Unknown"}`,
        date: t.updated_at,
      })),
    ...personalTasks
      .filter(t => t.status === "done")
      .map(t => ({
        kind: "task" as const,
        id: t.id,
        title: t.title,
        source: "Personal task",
        date: t.updated_at,
      })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Team pulse, active work, and the latest progress from GoDevLab.
          </p>
        </div>
        <Link href="/dashboard/projects" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <FolderKanban className="mr-2 h-4 w-4" />
          Open Projects
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Active Projects" value={activeProjects.length} subtitle={`${projects.length} total`} icon={FolderKanban} iconColor="text-sky-600" />
        <StatCard title="Open Tasks" value={allOpenTasks.length} subtitle={`${taskCompletionRate}% completion rate`} icon={CheckSquare} iconColor="text-emerald-600" />
        <StatCard title="Completed Tasks" value={allCompletedTasks.length} subtitle="across all task types" icon={Clock} iconColor="text-brand-700" />
        <StatCard title="Notes" value={notes.length} subtitle="global and per-project" icon={Lightbulb} iconColor="text-amber-600" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <div className="space-y-4">
                {recentActivity.map(item => (
                  <div key={item.id} className="flex items-start justify-between gap-4 border-b pb-4 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{item.title}</p>
                      {item.kind === "update" && (
                        <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{item.details}</p>
                      )}
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        {item.kind === "update" ? (
                          <>
                            <span className="font-medium text-brand-700">{item.who}</span>
                            <span className="capitalize">{item.type}</span>
                          </>
                        ) : (
                          <span className="text-muted-foreground">{item.source} · completed</span>
                        )}
                      </div>
                    </div>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(item.date), { addSuffix: true })}
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
                  {upcomingDeadlines.map(item => (
                    <div key={item.id} className="rounded-lg border border-gray-200 px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{item.title}</p>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="capitalize">{item.subtitle}</span>
                        <span>{format(new Date(item.due_date), "MMM d, yyyy")}</span>
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
                  <span className="font-medium text-gray-900">{allCompletedTasks.length}/{totalTasks}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div className="h-2 rounded-full bg-brand-700 transition-all" style={{ width: `${taskCompletionRate}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">My open tasks</span>
                  <span className="font-medium text-gray-900">
                    {myEmployeeTasks.filter(t => t.status !== "done").length + personalTasks.filter(t => t.status !== "done").length}
                  </span>
                </div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Active projects</span>
                  <span className="font-medium text-gray-900">{activeProjects.length}</span>
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
                <p className="text-sm text-muted-foreground">
                  {totalTasks === 0
                    ? "Add tasks to start tracking work."
                    : `${allOpenTasks.length} open task${allOpenTasks.length !== 1 ? "s" : ""} across ${activeProjects.length} active project${activeProjects.length !== 1 ? "s" : ""}.`}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
