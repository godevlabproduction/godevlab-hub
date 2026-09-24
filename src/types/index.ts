export type EmployeeRole = "admin" | "member";
export type ProjectStatus = "backlog" | "active" | "review" | "completed";
export type ProjectPriority = "low" | "medium" | "high";
export type TaskStatus = "todo" | "in_progress" | "done";
// Project tasks add a review column; employee/personal tasks stay on TaskStatus.
export type ProjectTaskStatus = TaskStatus | "review";
export type UpdateType = "progress" | "note" | "blocker" | "decision";

export interface Employee {
  id: string;
  full_name: string;
  email: string;
  role: EmployeeRole;
  created_at: string;
  weekly_capacity_hours?: number;
}

export interface Client {
  id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  website: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ProjectLink {
  label: string;
  url: string;
}

export interface ProjectCredential {
  id: string;
  project_id: string;
  service: string;
  username: string;
  password: string;
  created_by: string;
  created_at: string;
}

export interface ProjectAssignment {
  project_id: string;
  employee_id: string;
  created_at: string;
}

export interface Project {
  id: string;
  slug: string;
  title: string;
  client_name: string | null;
  description: string | null;
  status: ProjectStatus;
  priority: ProjectPriority;
  due_date: string | null;
  repo_path: string | null;
  repo_url: string | null;
  deployed_url: string | null;
  stack: string[];
  links: ProjectLink[];
  last_synced_at: string | null;
  last_commit_sha: string | null;
  last_commit_message: string | null;
  start_date: string | null;
  client_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  employee?: Employee;
  client?: Client | null;
}

export interface ProjectTask {
  id: string;
  project_id: string;
  title: string;
  details: string | null;
  status: ProjectTaskStatus;
  due_date: string | null;
  assigned_to: string | null;
  estimate_hours: number | null;
  completed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  employee?: Employee;
  assignee?: Employee | null;
}

export interface ProjectMilestone {
  id: string;
  project_id: string;
  title: string;
  start_date: string | null;
  due_date: string;
  completed_at: string | null;
  position: number;
  created_by: string;
  created_at: string;
}

export interface TimeEntry {
  id: string;
  employee_id: string;
  project_id: string | null;
  task_id: string | null;
  note: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  project?: Pick<Project, "id" | "title"> | null;
  task?: { id: string; title: string } | null;
}

export type NotificationType = "task_assigned" | "blocker" | "project_assigned" | "blocker_resolved";

export interface HubNotification {
  id: string;
  recipient_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  project_id: string | null;
  task_id: string | null;
  actor_id: string | null;
  read_at: string | null;
  created_at: string;
}

export interface ProjectUpdate {
  id: string;
  project_id: string;
  title: string;
  details: string;
  update_type: UpdateType;
  created_by: string;
  created_at: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  employee?: Employee;
  project?: Pick<Project, "id" | "title">;
}

export interface Note {
  id: string;
  title: string;
  description: string;
  project_id: string | null;
  created_by: string;
  created_at: string;
  employee?: Employee;
}

export interface EmployeeTask {
  id: string;
  title: string;
  details: string | null;
  status: TaskStatus;
  due_date: string | null;
  assigned_to: string;
  project_id: string | null;
  estimate_hours?: number | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  assignee?: Employee;
  project?: Pick<Project, "id" | "title">;
}

export interface PersonalTask {
  id: string;
  title: string;
  details: string | null;
  status: TaskStatus;
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ReportJson {
  project: string;
  client: string;
  status: string;
  stack: string[];
  repo_url: string;
  deployed_url: string;
  phases: Array<{
    name: string;
    status: "completed" | "in_progress" | "pending";
    completed_at: string | null;
  }>;
  last_session: {
    date: string;
    summary: string;
  };
  sessions_count: number;
}
