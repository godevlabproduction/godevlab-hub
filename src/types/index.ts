export type EmployeeRole = "admin" | "member";
export type ProjectStatus = "backlog" | "active" | "review" | "completed";
export type ProjectPriority = "low" | "medium" | "high";
export type TaskStatus = "todo" | "in_progress" | "done";
export type UpdateType = "progress" | "note" | "blocker" | "decision";

export interface Employee {
  id: string;
  full_name: string;
  email: string;
  role: EmployeeRole;
  created_at: string;
}

export interface ProjectLink {
  label: string;
  url: string;
}

export interface ProjectCredential {
  service: string;
  username: string;
  password: string;
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
  credentials: ProjectCredential[];
  last_synced_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  employee?: Employee;
}

export interface ProjectTask {
  id: string;
  project_id: string;
  title: string;
  details: string | null;
  status: TaskStatus;
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  employee?: Employee;
}

export interface ProjectUpdate {
  id: string;
  project_id: string;
  title: string;
  details: string;
  update_type: UpdateType;
  created_by: string;
  created_at: string;
  employee?: Employee;
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
