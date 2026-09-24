import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Employee, EmployeeRole, Project, ProjectTask, ProjectUpdate, Note,
  ProjectStatus, ProjectPriority, ProjectTaskStatus, TaskStatus, UpdateType,
  EmployeeTask, PersonalTask, ProjectCredential, ProjectAssignment,
  Client, ProjectMilestone, TimeEntry, HubNotification,
} from "@/types";


export async function getCurrentEmployee(supabase: SupabaseClient): Promise<Employee | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("employees").select("*").eq("id", user.id).single();
  return data;
}

export async function getEmployees(supabase: SupabaseClient): Promise<Employee[]> {
  const { data } = await supabase.from("employees").select("*").order("created_at", { ascending: true });
  return data ?? [];
}

export async function getProjects(supabase: SupabaseClient): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*, employee:employees!projects_created_by_fkey(id, full_name, email, role, created_at), client:clients(*)")
    .order("updated_at", { ascending: false });
  if (error) {
    // The clients join needs the agency-platform migration; without it, keep
    // the list working instead of showing an empty Hub.
    const fallback = await supabase
      .from("projects")
      .select("*, employee:employees!projects_created_by_fkey(id, full_name, email, role, created_at)")
      .order("updated_at", { ascending: false });
    return fallback.data ?? [];
  }
  return data ?? [];
}

export async function createProject(
  supabase: SupabaseClient,
  input: {
    slug: string; title: string; client_name?: string; client_id?: string | null; description?: string;
    status: ProjectStatus; priority: ProjectPriority; due_date?: string; start_date?: string;
    repo_path?: string; repo_url?: string; deployed_url?: string; stack?: string[];
    created_by: string;
  }
): Promise<Project> {
  const { data, error } = await supabase.from("projects").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateProject(
  supabase: SupabaseClient,
  projectId: string,
  input: Partial<Pick<Project, "status" | "priority" | "due_date" | "start_date" | "title" | "client_name" | "client_id" | "description" | "repo_url" | "deployed_url" | "stack" | "links" | "last_synced_at">>
): Promise<void> {
  const { error } = await supabase.from("projects").update(input).eq("id", projectId);
  if (error) throw error;
}

export async function getAllProjectTasks(supabase: SupabaseClient): Promise<ProjectTask[]> {
  const { data, error } = await supabase
    .from("project_tasks")
    .select("*, employee:employees!project_tasks_created_by_fkey(id, full_name, email, role, created_at), assignee:employees!project_tasks_assigned_to_fkey(id, full_name, email, role, created_at)")
    .order("created_at", { ascending: false });
  if (error) {
    // Same story: the assignee join needs the agency-platform migration.
    const fallback = await supabase
      .from("project_tasks")
      .select("*, employee:employees!project_tasks_created_by_fkey(id, full_name, email, role, created_at)")
      .order("created_at", { ascending: false });
    return fallback.data ?? [];
  }
  return data ?? [];
}

export async function createProjectTask(
  supabase: SupabaseClient,
  input: {
    project_id: string; title: string; details?: string; due_date?: string; created_by: string;
    assigned_to?: string | null; estimate_hours?: number | null; status?: ProjectTaskStatus;
  }
): Promise<ProjectTask> {
  const { data, error } = await supabase
    .from("project_tasks")
    .insert({ status: "todo", ...input })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateProjectTask(
  supabase: SupabaseClient,
  taskId: string,
  input: Partial<{
    status: ProjectTaskStatus; title: string; details: string | null; due_date: string | null;
    assigned_to: string | null; estimate_hours: number | null;
  }>
): Promise<void> {
  const { error } = await supabase.from("project_tasks").update(input).eq("id", taskId);
  if (error) throw error;
}

export async function deleteProjectTask(supabase: SupabaseClient, taskId: string): Promise<void> {
  const { error } = await supabase.from("project_tasks").delete().eq("id", taskId);
  if (error) throw error;
}

export async function getProjectUpdates(supabase: SupabaseClient, projectId: string): Promise<ProjectUpdate[]> {
  const { data } = await supabase
    .from("project_updates")
    .select("*, employee:employees!project_updates_created_by_fkey(id, full_name, email, role, created_at)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getRecentUpdates(supabase: SupabaseClient, limit = 5): Promise<ProjectUpdate[]> {
  const { data } = await supabase
    .from("project_updates")
    .select("*, employee:employees!project_updates_created_by_fkey(id, full_name, email, role, created_at), project:projects(id, title)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

// Unresolved is decided client-side (resolved_at empty) so this keeps working
// before the blocker-resolution migration adds the column.
export async function getOpenBlockers(supabase: SupabaseClient): Promise<ProjectUpdate[]> {
  const { data } = await supabase
    .from("project_updates")
    .select("*, employee:employees!project_updates_created_by_fkey(id, full_name, email, role, created_at), project:projects(id, title)")
    .eq("update_type", "blocker")
    .order("created_at", { ascending: false });
  return ((data ?? []) as ProjectUpdate[]).filter(u => !u.resolved_at);
}

export async function resolveBlocker(supabase: SupabaseClient, updateId: string, employeeId: string): Promise<void> {
  const { data, error } = await supabase
    .from("project_updates")
    .update({ resolved_at: new Date().toISOString(), resolved_by: employeeId })
    .eq("id", updateId)
    .select("id");
  if (error) throw error;
  // Row Level Security filters rows you may not change out silently (0 rows, no error).
  if (!data || data.length === 0) throw new Error("You don't have permission to resolve this blocker.");
}

export async function createProjectUpdate(
  supabase: SupabaseClient,
  input: { project_id: string; title: string; details: string; update_type: UpdateType; created_by: string }
): Promise<ProjectUpdate> {
  const { data, error } = await supabase.from("project_updates").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function deleteProjectUpdate(supabase: SupabaseClient, updateId: string): Promise<void> {
  const { error } = await supabase.from("project_updates").delete().eq("id", updateId);
  if (error) throw error;
}

export async function getNotes(supabase: SupabaseClient): Promise<Note[]> {
  const { data } = await supabase
    .from("notes")
    .select("*, employee:employees(id, full_name, email, role, created_at)")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function createNote(
  supabase: SupabaseClient,
  input: { title: string; description: string; project_id?: string; created_by: string }
): Promise<Note> {
  const { data, error } = await supabase.from("notes").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function deleteNote(supabase: SupabaseClient, noteId: string): Promise<void> {
  const { error } = await supabase.from("notes").delete().eq("id", noteId);
  if (error) throw error;
}

export async function getEmployeeTasks(supabase: SupabaseClient): Promise<EmployeeTask[]> {
  const { data } = await supabase
    .from("employee_tasks")
    .select("*, assignee:employees!assigned_to(id, full_name, email, role, created_at), project:projects(id, title)")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function createEmployeeTask(
  supabase: SupabaseClient,
  input: { title: string; details?: string; due_date?: string; assigned_to: string; project_id?: string; estimate_hours?: number | null; created_by: string }
): Promise<EmployeeTask> {
  const { data, error } = await supabase.from("employee_tasks").insert({ ...input, status: "todo" }).select().single();
  if (error) throw error;
  return data;
}

export async function updateEmployeeTask(
  supabase: SupabaseClient,
  taskId: string,
  input: { status: TaskStatus }
): Promise<void> {
  const { error } = await supabase.from("employee_tasks").update(input).eq("id", taskId);
  if (error) throw error;
}

export async function deleteEmployeeTask(supabase: SupabaseClient, taskId: string): Promise<void> {
  const { error } = await supabase.from("employee_tasks").delete().eq("id", taskId);
  if (error) throw error;
}

export async function getPersonalTasks(supabase: SupabaseClient): Promise<PersonalTask[]> {
  const { data } = await supabase
    .from("personal_tasks")
    .select("*")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function createPersonalTask(
  supabase: SupabaseClient,
  input: { title: string; details?: string; due_date?: string; created_by: string }
): Promise<PersonalTask> {
  const { data, error } = await supabase.from("personal_tasks").insert({ ...input, status: "todo" }).select().single();
  if (error) throw error;
  return data;
}

export async function updatePersonalTask(
  supabase: SupabaseClient,
  taskId: string,
  input: { status: TaskStatus }
): Promise<void> {
  const { error } = await supabase.from("personal_tasks").update(input).eq("id", taskId);
  if (error) throw error;
}

export async function deletePersonalTask(supabase: SupabaseClient, taskId: string): Promise<void> {
  const { error } = await supabase.from("personal_tasks").delete().eq("id", taskId);
  if (error) throw error;
}

export async function getProjectCredentials(supabase: SupabaseClient, projectId: string): Promise<ProjectCredential[]> {
  const { data } = await supabase
    .from("project_credentials")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function createProjectCredential(
  supabase: SupabaseClient,
  input: { project_id: string; service: string; username: string; password: string; created_by: string }
): Promise<ProjectCredential> {
  const { data, error } = await supabase.from("project_credentials").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function deleteProjectCredential(supabase: SupabaseClient, credentialId: string): Promise<void> {
  const { error } = await supabase.from("project_credentials").delete().eq("id", credentialId);
  if (error) throw error;
}

export async function getProjectAssignments(supabase: SupabaseClient): Promise<ProjectAssignment[]> {
  const { data } = await supabase.from("project_assignments").select("*");
  return data ?? [];
}

export async function assignEmployeeToProject(supabase: SupabaseClient, projectId: string, employeeId: string): Promise<void> {
  const { error } = await supabase.from("project_assignments").insert({ project_id: projectId, employee_id: employeeId });
  if (error) throw error;
}

export async function unassignEmployeeFromProject(supabase: SupabaseClient, projectId: string, employeeId: string): Promise<void> {
  const { error } = await supabase
    .from("project_assignments")
    .delete()
    .eq("project_id", projectId)
    .eq("employee_id", employeeId);
  if (error) throw error;
}

export async function createEmployee(input: {
  full_name: string; email: string; password: string; role: EmployeeRole;
}): Promise<Employee> {
  const res = await fetch("/api/employees/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to create employee");
  return json.employee as Employee;
}

export async function getSyncTokenStatus(projectId: string): Promise<{ exists: boolean; createdAt: string | null; regeneratedAt: string | null }> {
  const res = await fetch(`/api/projects/sync-token?projectId=${projectId}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to fetch sync token status");
  return json;
}

export async function generateSyncToken(projectId: string): Promise<{ token: string; projectId: string; projectTitle: string }> {
  const res = await fetch("/api/projects/sync-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to generate sync token");
  return json;
}

export async function deleteProject(supabase: SupabaseClient, projectId: string): Promise<void> {
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) throw error;
}

// ---- milestones -------------------------------------------------------

export async function getAllMilestones(supabase: SupabaseClient): Promise<ProjectMilestone[]> {
  const { data } = await supabase.from("project_milestones").select("*").order("due_date", { ascending: true });
  return data ?? [];
}

export async function createMilestone(
  supabase: SupabaseClient,
  input: { project_id: string; title: string; start_date?: string | null; due_date: string; position?: number; created_by: string }
): Promise<ProjectMilestone> {
  const { data, error } = await supabase.from("project_milestones").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateMilestone(
  supabase: SupabaseClient,
  id: string,
  input: Partial<Pick<ProjectMilestone, "title" | "start_date" | "due_date" | "completed_at" | "position">>
): Promise<void> {
  const { error } = await supabase.from("project_milestones").update(input).eq("id", id);
  if (error) throw error;
}

export async function deleteMilestone(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("project_milestones").delete().eq("id", id);
  if (error) throw error;
}

// ---- clients ----------------------------------------------------------

export async function getClients(supabase: SupabaseClient): Promise<Client[]> {
  const { data } = await supabase.from("clients").select("*").order("name", { ascending: true });
  return data ?? [];
}

export async function createClientRow(
  supabase: SupabaseClient,
  input: { name: string; contact_name?: string | null; contact_email?: string | null; website?: string | null; notes?: string | null; created_by: string }
): Promise<Client> {
  const { data, error } = await supabase.from("clients").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateClientRow(
  supabase: SupabaseClient,
  id: string,
  input: Partial<Pick<Client, "name" | "contact_name" | "contact_email" | "website" | "notes">>
): Promise<void> {
  const { error } = await supabase.from("clients").update(input).eq("id", id);
  if (error) throw error;
}

export async function deleteClientRow(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) throw error;
}

// ---- capacity ---------------------------------------------------------

export async function updateEmployeeCapacity(supabase: SupabaseClient, employeeId: string, hours: number): Promise<void> {
  const { error } = await supabase.from("employees").update({ weekly_capacity_hours: hours }).eq("id", employeeId);
  if (error) throw error;
}

// ---- time tracking ----------------------------------------------------

const TIME_ENTRY_SELECT = "*, project:projects(id, title), task:project_tasks(id, title)";

export async function getRunningTimer(supabase: SupabaseClient, employeeId: string): Promise<TimeEntry | null> {
  const { data } = await supabase
    .from("time_entries")
    .select(TIME_ENTRY_SELECT)
    .eq("employee_id", employeeId)
    .is("ended_at", null)
    .maybeSingle();
  return data ?? null;
}

// Starting a timer stops the running one first (the DB allows only one).
export async function startTimer(
  supabase: SupabaseClient,
  input: { employee_id: string; project_id?: string | null; task_id?: string | null; note?: string | null }
): Promise<TimeEntry> {
  const now = new Date().toISOString();
  await supabase.from("time_entries").update({ ended_at: now }).eq("employee_id", input.employee_id).is("ended_at", null);
  const { data, error } = await supabase.from("time_entries").insert({ ...input, started_at: now }).select(TIME_ENTRY_SELECT).single();
  if (error) throw error;
  return data;
}

export async function stopTimer(supabase: SupabaseClient, entryId: string): Promise<void> {
  const { error } = await supabase.from("time_entries").update({ ended_at: new Date().toISOString() }).eq("id", entryId);
  if (error) throw error;
}

export async function getTimeEntries(
  supabase: SupabaseClient,
  opts: { employeeId?: string; projectId?: string; since?: string } = {}
): Promise<TimeEntry[]> {
  let q = supabase.from("time_entries").select(TIME_ENTRY_SELECT).order("started_at", { ascending: false });
  if (opts.employeeId) q = q.eq("employee_id", opts.employeeId);
  if (opts.projectId) q = q.eq("project_id", opts.projectId);
  // Overlap, not "started after": an entry that began before the window but ended
  // inside it (or is still running) still counts toward it.
  if (opts.since) q = q.or(`ended_at.is.null,ended_at.gte.${opts.since}`);
  const { data } = await q;
  return data ?? [];
}

export async function deleteTimeEntry(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("time_entries").delete().eq("id", id);
  if (error) throw error;
}

// ---- notifications ----------------------------------------------------

export async function getNotifications(supabase: SupabaseClient, limit = 50): Promise<HubNotification[]> {
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function getUnreadNotificationCount(supabase: SupabaseClient): Promise<number> {
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  return count ?? 0;
}

export async function markNotificationRead(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function markAllNotificationsRead(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (error) throw error;
}

export async function deleteNotification(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("notifications").delete().eq("id", id);
  if (error) throw error;
}
