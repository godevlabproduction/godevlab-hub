import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Employee, Project, ProjectTask, ProjectUpdate, Note,
  ProjectStatus, ProjectPriority, TaskStatus, UpdateType,
  EmployeeTask, PersonalTask, Booking, Expense, BookingSource,
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
  const { data } = await supabase
    .from("projects")
    .select("*, employee:employees(id, full_name, email, role, created_at)")
    .order("updated_at", { ascending: false });
  return data ?? [];
}

export async function createProject(
  supabase: SupabaseClient,
  input: {
    slug: string; title: string; client_name?: string; description?: string;
    status: ProjectStatus; priority: ProjectPriority; due_date?: string;
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
  input: Partial<Pick<Project, "status" | "priority" | "due_date" | "title" | "client_name" | "description" | "repo_url" | "deployed_url" | "stack" | "links" | "credentials" | "last_synced_at">>
): Promise<void> {
  const { error } = await supabase.from("projects").update(input).eq("id", projectId);
  if (error) throw error;
}

export async function getAllProjectTasks(supabase: SupabaseClient): Promise<ProjectTask[]> {
  const { data } = await supabase
    .from("project_tasks")
    .select("*, employee:employees(id, full_name, email, role, created_at)")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function createProjectTask(
  supabase: SupabaseClient,
  input: { project_id: string; title: string; details?: string; due_date?: string; created_by: string }
): Promise<ProjectTask> {
  const { data, error } = await supabase.from("project_tasks").insert({ ...input, status: "todo" }).select().single();
  if (error) throw error;
  return data;
}

export async function updateProjectTask(
  supabase: SupabaseClient,
  taskId: string,
  input: { status: TaskStatus }
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
    .select("*, employee:employees(id, full_name, email, role, created_at)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getRecentUpdates(supabase: SupabaseClient, limit = 5): Promise<ProjectUpdate[]> {
  const { data } = await supabase
    .from("project_updates")
    .select("*, employee:employees(id, full_name, email, role, created_at)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
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
  input: { title: string; details?: string; due_date?: string; assigned_to: string; project_id?: string; created_by: string }
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

export async function getBookings(supabase: SupabaseClient): Promise<Booking[]> {
  const { data } = await supabase
    .from("bookings")
    .select("*")
    .order("check_in", { ascending: false });
  return data ?? [];
}

export async function createBooking(
  supabase: SupabaseClient,
  input: {
    guest_name: string; phone: string; country: string;
    check_in: string; check_out: string; nights: number; guests: number;
    price_per_night: number; total_price: number;
    notes?: string; source: BookingSource; created_by: string;
  }
): Promise<Booking> {
  const { data, error } = await supabase.from("bookings").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateBooking(
  supabase: SupabaseClient,
  bookingId: string,
  input: {
    guest_name: string; phone: string; country: string;
    check_in: string; check_out: string; nights: number; guests: number;
    price_per_night: number; total_price: number;
    notes?: string; source: BookingSource;
  }
): Promise<void> {
  const { error } = await supabase.from("bookings").update(input).eq("id", bookingId);
  if (error) throw error;
}

export async function confirmBooking(supabase: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await supabase.from("bookings").update({ confirmed: true }).eq("id", bookingId);
  if (error) throw error;
}

export async function deleteBooking(supabase: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await supabase.from("bookings").delete().eq("id", bookingId);
  if (error) throw error;
}

export async function getExpenses(supabase: SupabaseClient): Promise<Expense[]> {
  const { data } = await supabase
    .from("expenses")
    .select("*")
    .order("date", { ascending: false });
  return data ?? [];
}

export async function createExpense(
  supabase: SupabaseClient,
  input: { description: string; amount: number; date: string; created_by: string }
): Promise<Expense> {
  const { data, error } = await supabase.from("expenses").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function deleteExpense(supabase: SupabaseClient, expenseId: string): Promise<void> {
  const { error } = await supabase.from("expenses").delete().eq("id", expenseId);
  if (error) throw error;
}
