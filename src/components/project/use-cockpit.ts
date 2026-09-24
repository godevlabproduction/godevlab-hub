"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startOfDay } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import {
  getAllMilestones, getAllProjectTasks, getClients, getEmployees, getOpenBlockers,
  getProjectAssignments, getProjectUpdates, getProjects, getTimeEntries,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { computeProjectHealth } from "@/lib/portfolio";
import { computeBurndown } from "@/lib/planning";
import type { Employee } from "@/types";

// Everything one project page needs, from the same query keys the rest of the
// Hub uses, so a change made anywhere shows up here without extra plumbing.
export function useCockpit(projectId: string) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: me } = useCurrentEmployee();

  const projectsQ = useQuery({ queryKey: ["projects"], queryFn: () => getProjects(supabase), refetchInterval: 30000 });
  const tasksQ = useQuery({ queryKey: ["project-tasks"], queryFn: () => getAllProjectTasks(supabase), refetchInterval: 30000 });
  const employeesQ = useQuery({ queryKey: ["employees"], queryFn: () => getEmployees(supabase) });
  const assignmentsQ = useQuery({ queryKey: ["project-assignments"], queryFn: () => getProjectAssignments(supabase) });
  const milestonesQ = useQuery({ queryKey: ["milestones"], queryFn: () => getAllMilestones(supabase) });
  const clientsQ = useQuery({ queryKey: ["clients"], queryFn: () => getClients(supabase) });
  const blockersQ = useQuery({ queryKey: ["open-blockers"], queryFn: () => getOpenBlockers(supabase), refetchInterval: 30000 });
  const updatesQ = useQuery({
    queryKey: ["project-updates", projectId],
    queryFn: () => getProjectUpdates(supabase, projectId),
    refetchInterval: 30000,
  });
  const timeQ = useQuery({
    queryKey: ["time-entries", "project", projectId],
    queryFn: () => getTimeEntries(supabase, { projectId }),
  });

  const projects = projectsQ.data;
  const allTasks = tasksQ.data;
  const employees = employeesQ.data;
  const assignments = assignmentsQ.data;

  const project = useMemo(() => (projects ?? []).find(p => p.id === projectId) ?? null, [projects, projectId]);
  const tasks = useMemo(() => (allTasks ?? []).filter(t => t.project_id === projectId), [allTasks, projectId]);
  const milestones = useMemo(
    () => (milestonesQ.data ?? []).filter(m => m.project_id === projectId).sort((a, b) => a.due_date.localeCompare(b.due_date)),
    [milestonesQ.data, projectId],
  );
  const blockers = useMemo(() => (blockersQ.data ?? []).filter(b => b.project_id === projectId), [blockersQ.data, projectId]);

  const projectAssignments = useMemo(
    () => (assignments ?? []).filter(a => a.project_id === projectId),
    [assignments, projectId],
  );

  // Same rule as the portfolio: assigned people, else the person who created it.
  const team = useMemo<Employee[]>(() => {
    const byId = new Map((employees ?? []).map(e => [e.id, e]));
    const assigned = projectAssignments.map(a => byId.get(a.employee_id)).filter((e): e is Employee => Boolean(e));
    if (assigned.length > 0) return assigned;
    const creator = project?.employee ?? (project ? byId.get(project.created_by) : undefined);
    return creator ? [creator] : [];
  }, [employees, projectAssignments, project]);

  const health = useMemo(
    () => (project ? computeProjectHealth(project, tasks, blockers.length, startOfDay(new Date())) : null),
    [project, tasks, blockers],
  );
  const burndown = useMemo(() => (project ? computeBurndown(project, tasks, new Date()) : null), [project, tasks]);

  const isAdmin = me?.role === "admin";
  const isCreator = Boolean(project && me && project.created_by === me.id);
  const isAssigned = Boolean(me && projectAssignments.some(a => a.employee_id === me.id));

  const invalidate = (...keys: (string | number)[][]) => {
    for (const queryKey of keys) queryClient.invalidateQueries({ queryKey });
  };

  return {
    me: me ?? null,
    project,
    tasks,
    milestones,
    blockers,
    updates: updatesQ.data ?? [],
    timeEntries: timeQ.data ?? [],
    employees: employees ?? [],
    clients: clientsQ.data ?? [],
    assignments: projectAssignments,
    team,
    health,
    burndown,
    isAdmin,
    isCreator,
    isAssigned,
    canEdit: isAdmin || isCreator || isAssigned,
    canDelete: isAdmin || isCreator,
    loading: projectsQ.isLoading,
    invalidate,
  };
}

export type Cockpit = ReturnType<typeof useCockpit>;
