# Employee Project Scoping & In-App Employee Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin assign employees to specific projects, restrict project credentials (`service`/`username`/`password`) so only admins and assigned employees can see them, and let an admin create new employee accounts from inside the app instead of the Supabase dashboard.

**Architecture:** Move `credentials` off the `projects` row into its own `project_credentials` table guarded by RLS (Postgres RLS is row-level, so column-level hiding requires a separate table — this mirrors the existing `personal_tasks` pattern in this schema). Add a `project_assignments` join table that RLS on `project_credentials` reads from. Add a server-only Next.js route that uses the Supabase service-role key to create auth users, since that key must never reach the browser.

**Tech Stack:** Next.js 16 (App Router, Turbopack), TypeScript, `@supabase/ssr` + `@supabase/supabase-js`, TanStack Query, Tailwind, Postgres RLS on Supabase project `izgrryarnsbkxmrffcio`.

**Spec:** `docs/superpowers/specs/2026-08-22-employee-project-scoping-design.md`

## Global Constraints

- No automated test runner exists in this repo (no `jest`/`vitest`, no `test` script in `package.json`). Verification steps in this plan use `npx tsc --noEmit`, `curl`, and manual browser checks — consistent with how the rest of this codebase is verified. Do not introduce a test framework as part of this plan.
- This repo has no linked Supabase CLI and the Supabase MCP connection lacks permission on project `izgrryarnsbkxmrffcio`. Any SQL against the live database must be run by the human operator in the Supabase SQL editor — do not attempt `supabase db push` or MCP `execute_sql`/`apply_migration` calls against this project.
- `SUPABASE_SERVICE_ROLE_KEY` must be added to `.env.local` only, must never be prefixed `NEXT_PUBLIC_`, and must never be logged, printed in full, or committed.
- Credential writes (`project_credentials` INSERT/UPDATE/DELETE) and assignment writes (`project_assignments` INSERT/DELETE) are admin-only per the spec — do not relax this while implementing.

---

### Task 1: Database migration — project_assignments, project_credentials, drop old column

**Files:**
- Create: `supabase/migrations/20260822_project_scoping.sql`

**Interfaces:**
- Produces: tables `project_assignments(project_id, employee_id, created_at)` and `project_credentials(id, project_id, service, username, password, created_by, created_at)`, both RLS-enabled. `projects.credentials` column is dropped after migrating its data.

- [ ] **Step 1: Write the migration file**

```sql
-- Assign employees to projects (drives credential visibility below).
CREATE TABLE IF NOT EXISTS project_assignments (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, employee_id)
);

ALTER TABLE project_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_assignments_select" ON project_assignments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "project_assignments_write" ON project_assignments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));

-- Project credentials, split out of projects.credentials so RLS can
-- restrict them independently of the rest of the project row.
CREATE TABLE IF NOT EXISTS project_credentials (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service    TEXT NOT NULL,
  username   TEXT NOT NULL,
  password   TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_credentials_select" ON project_credentials
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM project_assignments
      WHERE project_id = project_credentials.project_id AND employee_id = auth.uid()
    )
  );

CREATE POLICY "project_credentials_write" ON project_credentials
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));

-- Migrate any existing credentials off the old JSONB column.
INSERT INTO project_credentials (project_id, service, username, password, created_by, created_at)
SELECT p.id, c->>'service', c->>'username', c->>'password', p.created_by, p.created_at
FROM projects p, jsonb_array_elements(p.credentials) AS c
WHERE p.credentials IS NOT NULL AND jsonb_array_length(p.credentials) > 0;

ALTER TABLE projects DROP COLUMN IF EXISTS credentials;
```

- [ ] **Step 2: Human operator runs the migration**

This step cannot be automated — there is no linked Supabase CLI and the
MCP connection lacks permission on this project (see Global Constraints).

Tell the human operator: "Open the Supabase SQL editor for project
`izgrryarnsbkxmrffcio` (https://supabase.com/dashboard/project/izgrryarnsbkxmrffcio/sql/new),
paste in the contents of `supabase/migrations/20260822_project_scoping.sql`,
and run it. Let me know when it's done."

Wait for the human operator to confirm before continuing to Step 3.

- [ ] **Step 3: Verify the migration applied**

Ask the human operator to run this query in the same SQL editor and paste
back the result:

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'project_assignments') AS has_assignments,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'project_credentials') AS has_credentials,
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'projects' AND column_name = 'credentials') AS old_column_still_exists;
```

Expected: `has_assignments = 1`, `has_credentials = 1`, `old_column_still_exists = 0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260822_project_scoping.sql
git commit -m "feat: add project_assignments and project_credentials tables"
```

---

### Task 2: Types and query functions

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/supabase/queries.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `ProjectCredential { id, project_id, service, username, password, created_by, created_at }`, `ProjectAssignment { project_id, employee_id, created_at }`, and query functions `getProjectCredentials(supabase, projectId)`, `createProjectCredential(supabase, input)`, `deleteProjectCredential(supabase, credentialId)`, `getProjectAssignments(supabase)`, `assignEmployeeToProject(supabase, projectId, employeeId)`, `unassignEmployeeFromProject(supabase, projectId, employeeId)`, `createEmployee(input)` — used by Task 4 and Task 5.

- [ ] **Step 1: Update `src/types/index.ts`**

Remove the `credentials` field from `Project` — find:

```ts
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
```

Replace with:

```ts
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
  created_by: string;
  created_at: string;
  updated_at: string;
  employee?: Employee;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: New errors at every place that referenced `Project["credentials"]`
or the old 3-field `ProjectCredential` shape (this is expected — Tasks 4
and 5 fix these call sites). Confirm the errors are limited to
`src/app/dashboard/projects/page.tsx` and `src/lib/supabase/queries.ts`.

- [ ] **Step 3: Update `src/lib/supabase/queries.ts` imports**

Find:

```ts
import type {
  Employee, Project, ProjectTask, ProjectUpdate, Note,
  ProjectStatus, ProjectPriority, TaskStatus, UpdateType,
  EmployeeTask, PersonalTask,
} from "@/types";
```

Replace with:

```ts
import type {
  Employee, EmployeeRole, Project, ProjectTask, ProjectUpdate, Note,
  ProjectStatus, ProjectPriority, TaskStatus, UpdateType,
  EmployeeTask, PersonalTask, ProjectCredential, ProjectAssignment,
} from "@/types";
```

- [ ] **Step 4: Remove `credentials` from `updateProject`'s allowed fields**

Find:

```ts
export async function updateProject(
  supabase: SupabaseClient,
  projectId: string,
  input: Partial<Pick<Project, "status" | "priority" | "due_date" | "title" | "client_name" | "description" | "repo_url" | "deployed_url" | "stack" | "links" | "credentials" | "last_synced_at">>
): Promise<void> {
```

Replace with:

```ts
export async function updateProject(
  supabase: SupabaseClient,
  projectId: string,
  input: Partial<Pick<Project, "status" | "priority" | "due_date" | "title" | "client_name" | "description" | "repo_url" | "deployed_url" | "stack" | "links" | "last_synced_at">>
): Promise<void> {
```

- [ ] **Step 5: Append the new query functions**

Add at the end of `src/lib/supabase/queries.ts`:

```ts
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
```

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/lib/supabase/queries.ts
git commit -m "feat: add types and query functions for project scoping"
```

---

### Task 3: Server-only admin client and employee creation route

**Files:**
- Create: `src/lib/supabase/admin.ts`
- Create: `src/app/api/employees/create/route.ts`
- Modify: `.env.local` (human operator provides the value)

**Interfaces:**
- Consumes: `createClient` (server) from `src/lib/supabase/server.ts` (existing), nothing from Task 2 directly (route reads/writes `employees` by table name, not through `queries.ts`, so it stays usable outside the browser-only Supabase client context).
- Produces: `createAdminClient()` from `src/lib/supabase/admin.ts`, and `POST /api/employees/create` which `createEmployee` (Task 2, Step 5) calls.

- [ ] **Step 1: Ask the human operator for the service-role key**

Tell them: "I need the service-role key for the GoDevLab Hub Supabase
project to build the employee-creation endpoint. Grab it from
https://supabase.com/dashboard/project/izgrryarnsbkxmrffcio/settings/api
— it's the `service_role` secret, not the `anon`/publishable key. Paste
it here and I'll add it to `.env.local`; it never gets committed."

Wait for the value before continuing.

- [ ] **Step 2: Add the key to `.env.local`**

Append to the existing `.env.local` (do not overwrite the existing
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` lines):

```
SUPABASE_SERVICE_ROLE_KEY=<value the operator provided>
```

Confirm `.env.local` is listed in `.gitignore` (it already is, per
`# env files (can opt-in for committing if needed)` / `.env*`) before
moving on — do not proceed if it isn't.

- [ ] **Step 3: Create the admin client factory**

Create `src/lib/supabase/admin.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
```

- [ ] **Step 4: Create the route handler**

Create `src/app/api/employees/create/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: caller } = await supabase
    .from("employees")
    .select("role")
    .eq("id", user.id)
    .single();
  if (caller?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as {
    full_name?: string; email?: string; password?: string; role?: string;
  } | null;

  const { full_name, email, password, role } = body ?? {};
  if (!full_name?.trim() || !email?.trim() || !password || password.length < 8 || (role !== "admin" && role !== "member")) {
    return NextResponse.json({ error: "Missing or invalid fields (password must be at least 8 characters)" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? "Failed to create user" }, { status: 400 });
  }

  const { data: employee, error: insertError } = await admin
    .from("employees")
    .insert({ id: created.user.id, full_name: full_name.trim(), email: email.trim(), role })
    .select()
    .single();
  if (insertError) {
    // Roll back the auth user so a failed insert doesn't leave an orphaned login.
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({ employee });
}
```

- [ ] **Step 5: Restart the dev server**

Run: kill the existing `npm run dev` process and restart it (Next.js
only reads `.env.local` at startup).

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors from `src/lib/supabase/admin.ts` or
`src/app/api/employees/create/route.ts`.

- [ ] **Step 7: Verify the route rejects unauthenticated requests**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/employees/create -H "Content-Type: application/json" -d '{"full_name":"Test","email":"test@example.com","password":"testpassword123","role":"member"}'`
Expected: `401`

- [ ] **Step 8: Commit**

```bash
git add src/lib/supabase/admin.ts src/app/api/employees/create/route.ts
git commit -m "feat: add admin-only employee creation endpoint"
```

(`.env.local` is gitignored and is not committed.)

---

### Task 4: Team page — add employee form and project assignment picker

**Files:**
- Modify: `src/app/dashboard/employees/page.tsx`

**Interfaces:**
- Consumes: `createEmployee`, `getProjects`, `getProjectAssignments`, `assignEmployeeToProject`, `unassignEmployeeFromProject` from `src/lib/supabase/queries.ts` (Task 2); `Employee`, `EmployeeRole`, `Project` types (existing + Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the full file**

Replace all of `src/app/dashboard/employees/page.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Users, PlusCircle, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getEmployees, createEmployee, getProjects,
  getProjectAssignments, assignEmployeeToProject, unassignEmployeeFromProject,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { EmployeeRole } from "@/types";

const roleStyles: Record<string, string> = {
  admin: "border-brand-300 bg-brand-50 text-brand-700",
  member: "border-gray-200 bg-gray-100 text-gray-600",
};

export default function EmployeesPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: employee } = useCurrentEmployee();
  const isAdmin = employee?.role === "admin";

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => getEmployees(supabase),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(supabase),
    enabled: isAdmin,
  });
  const { data: assignments = [] } = useQuery({
    queryKey: ["project_assignments"],
    queryFn: () => getProjectAssignments(supabase),
    enabled: isAdmin,
  });

  const [addingEmployee, setAddingEmployee] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<EmployeeRole>("member");
  const [createError, setCreateError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const createEmployeeMutation = useMutation({
    mutationFn: () => createEmployee({ full_name: newName, email: newEmail, password: newPassword, role: newRole }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setNewName(""); setNewEmail(""); setNewPassword(""); setNewRole("member");
      setAddingEmployee(false); setCreateError(null);
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const assignMutation = useMutation({
    mutationFn: ({ projectId, employeeId }: { projectId: string; employeeId: string }) =>
      assignEmployeeToProject(supabase, projectId, employeeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project_assignments"] }),
  });
  const unassignMutation = useMutation({
    mutationFn: ({ projectId, employeeId }: { projectId: string; employeeId: string }) =>
      unassignEmployeeFromProject(supabase, projectId, employeeId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project_assignments"] }),
  });

  const canCreate = Boolean(newName.trim() && newEmail.trim() && newPassword.length >= 8);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">{employees.length} member{employees.length !== 1 ? "s" : ""}</p>
        </div>
        {isAdmin && !addingEmployee && (
          <Button size="sm" className="bg-brand-700 hover:bg-brand-800" onClick={() => setAddingEmployee(true)}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add employee
          </Button>
        )}
      </div>

      {isAdmin && addingEmployee && (
        <Card>
          <CardHeader><CardTitle className="text-base">New employee</CardTitle></CardHeader>
          <CardContent>
            <form
              onSubmit={e => { e.preventDefault(); if (canCreate) createEmployeeMutation.mutate(); }}
              className="grid gap-3 sm:grid-cols-2"
            >
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full name" />
              <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email" />
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Initial password (min 8 chars)" />
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value as EmployeeRole)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              {createError && <p className="sm:col-span-2 text-sm text-red-600">{createError}</p>}
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={!canCreate || createEmployeeMutation.isPending} className="bg-brand-700 hover:bg-brand-800">
                  {createEmployeeMutation.isPending ? "Creating..." : "Create employee"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setAddingEmployee(false); setCreateError(null); }}>
                  <X className="mr-1 h-4 w-4" /> Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {employees.map(emp => {
          const empAssignments = assignments.filter(a => a.employee_id === emp.id);
          const isExpanded = expandedId === emp.id;
          return (
            <Card key={emp.id} className={emp.id === employee?.id ? "border-brand-300" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
                    {emp.full_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <Badge variant="outline" className={roleStyles[emp.role]}>{emp.role}</Badge>
                </div>
                <CardTitle className="mt-3 text-base">{emp.full_name}{emp.id === employee?.id && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}</CardTitle>
                <CardDescription>{emp.email}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Joined {format(new Date(emp.created_at), "MMM d, yyyy")}</p>
                {isAdmin && emp.role === "member" && (
                  <div className="mt-3 border-t pt-3">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : emp.id)}
                      className="text-xs font-medium text-brand-700 hover:text-brand-800"
                    >
                      {empAssignments.length} project{empAssignments.length !== 1 ? "s" : ""} assigned {isExpanded ? "▲" : "▼"}
                    </button>
                    {isExpanded && (
                      <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                        {projects.length === 0 && <p className="text-xs text-muted-foreground">No projects yet.</p>}
                        {projects.map(p => {
                          const checked = empAssignments.some(a => a.project_id === p.id);
                          return (
                            <label key={p.id} className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  if (checked) unassignMutation.mutate({ projectId: p.id, employeeId: emp.id });
                                  else assignMutation.mutate({ projectId: p.id, employeeId: emp.id });
                                }}
                              />
                              <span className="truncate">{p.title}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {employees.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-12 text-center text-sm text-muted-foreground">
            <Users className="mx-auto mb-2 h-6 w-6" />
            No employees found. Make sure the schema is applied in Supabase.
          </div>
        )}
      </div>
    </div>
  );
}
```

Note: assignment picker is shown only for `role === "member"` cards —
admins already see every project's credentials, so assigning them is a
no-op. If a future task wants to assign admins too, drop that condition.

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors in `src/app/dashboard/employees/page.tsx`.

- [ ] **Step 3: Manual smoke test**

With the dev server running and logged in as an admin, open
`http://localhost:3000/dashboard/employees`:
- Click "Add employee", fill the form, submit — confirm a new card
  appears and (separately) that a new user shows up in Supabase Auth →
  Users in the dashboard.
- On a `member` card, expand the project list and toggle a checkbox —
  confirm it stays checked after a page refresh.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/employees/page.tsx
git commit -m "feat: add employee creation and project assignment UI"
```

---

### Task 5: Projects page — credentials from the new table

**Files:**
- Modify: `src/app/dashboard/projects/page.tsx`

**Interfaces:**
- Consumes: `getProjectCredentials`, `createProjectCredential`, `deleteProjectCredential` from `src/lib/supabase/queries.ts` (Task 2); `ProjectCredential` type (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the query import and drop the now-unused type import**

Find (near the top of the file):

```ts
import {
  getProjects, getAllProjectTasks, getProjectUpdates,
  createProject, updateProject, createProjectTask, updateProjectTask,
  deleteProjectTask, createProjectUpdate, deleteProjectUpdate,
} from "@/lib/supabase/queries";
```

Replace with:

```ts
import {
  getProjects, getAllProjectTasks, getProjectUpdates,
  createProject, updateProject, createProjectTask, updateProjectTask,
  deleteProjectTask, createProjectUpdate, deleteProjectUpdate,
  getProjectCredentials, createProjectCredential, deleteProjectCredential,
} from "@/lib/supabase/queries";
```

Also find, a few lines below:

```ts
import type { ProjectStatus, ProjectPriority, ProjectLink, ProjectCredential, TaskStatus } from "@/types";
```

Replace with (dropping `ProjectCredential` — after Step 6 below, this file
no longer names that type directly, it only consumes values returned by
`getProjectCredentials`):

```ts
import type { ProjectStatus, ProjectPriority, ProjectLink, TaskStatus } from "@/types";
```

- [ ] **Step 2: Change `visiblePasswords` to key by credential id**

Find:

```ts
  const [visiblePasswords, setVisiblePasswords] = useState<Record<number, boolean>>({});
```

Replace with:

```ts
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
```

- [ ] **Step 3: Add the credentials query, scoped to the selected project**

Find (this line already exists, defining `selectedProject`):

```ts
  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId) ?? null, [projects, selectedProjectId]);
```

Immediately after it, add:

```ts
  const { data: projectCredentials = [] } = useQuery({
    queryKey: ["project_credentials", selectedProjectId],
    queryFn: () => getProjectCredentials(supabase, selectedProjectId!),
    enabled: Boolean(selectedProjectId),
  });
```

- [ ] **Step 4: Add credential create/delete mutations**

Find the existing `updateProjectMutation` definition (starts with
`const updateProjectMutation = useMutation({`) and add these two new
mutations directly after its closing `});`:

```ts
  const createCredentialMutation = useMutation({
    mutationFn: (input: { service: string; username: string; password: string }) =>
      createProjectCredential(supabase, { project_id: selectedProject!.id, created_by: employee!.id, ...input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project_credentials", selectedProjectId] }),
  });
  const deleteCredentialMutation = useMutation({
    mutationFn: (credentialId: string) => deleteProjectCredential(supabase, credentialId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project_credentials", selectedProjectId] }),
  });
```

- [ ] **Step 5: Replace the credentials add-form submit handler**

Find:

```tsx
                  {addingCred && (
                    <form onSubmit={e => {
                      e.preventDefault();
                      if (!credService.trim() || !credUsername.trim() || !credPassword.trim()) return;
                      const updated: ProjectCredential[] = [...(selectedProject.credentials ?? []), { service: credService.trim(), username: credUsername.trim(), password: credPassword.trim() }];
                      updateProjectMutation.mutate({ projectId: selectedProject.id, credentials: updated });
                      setCredService(""); setCredUsername(""); setCredPassword(""); setAddingCred(false);
                    }} className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
```

Replace with:

```tsx
                  {addingCred && (
                    <form onSubmit={e => {
                      e.preventDefault();
                      if (!credService.trim() || !credUsername.trim() || !credPassword.trim()) return;
                      createCredentialMutation.mutate({ service: credService.trim(), username: credUsername.trim(), password: credPassword.trim() });
                      setCredService(""); setCredUsername(""); setCredPassword(""); setAddingCred(false);
                    }} className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
```

- [ ] **Step 6: Replace the credentials list rendering**

Find:

```tsx
                  {(selectedProject.credentials ?? []).length === 0 && !addingCred && (
                    <p className="text-xs text-muted-foreground">No logins saved yet.</p>
                  )}
                  <div className="space-y-2">
                    {(selectedProject.credentials ?? []).map((cred, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm">
                        <span className="w-28 shrink-0 font-medium text-gray-900 truncate">{cred.service}</span>
                        <div className="flex flex-1 items-center gap-1.5 min-w-[140px]">
                          <span className="truncate text-muted-foreground">{cred.username}</span>
                          <button type="button" onClick={() => copyToClipboard(cred.username, `u${i}`)} className="shrink-0 text-muted-foreground hover:text-brand-700">
                            {copiedIndex === `u${i}` ? <span className="text-xs text-green-600">Copied</span> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        <div className="flex flex-1 items-center gap-1.5 min-w-[140px]">
                          <span className="truncate font-mono text-muted-foreground">{visiblePasswords[i] ? cred.password : "••••••••"}</span>
                          <button type="button" onClick={() => setVisiblePasswords(v => ({ ...v, [i]: !v[i] }))} className="shrink-0 text-muted-foreground hover:text-gray-700">
                            {visiblePasswords[i] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button type="button" onClick={() => copyToClipboard(cred.password, `p${i}`)} className="shrink-0 text-muted-foreground hover:text-brand-700">
                            {copiedIndex === `p${i}` ? <span className="text-xs text-green-600">Copied</span> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        <button type="button" onClick={() => {
                          const updated = (selectedProject.credentials ?? []).filter((_, idx) => idx !== i);
                          updateProjectMutation.mutate({ projectId: selectedProject.id, credentials: updated });
                        }} className="shrink-0 text-muted-foreground hover:text-red-500">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
```

Replace with:

```tsx
                  {projectCredentials.length === 0 && !addingCred && (
                    <p className="text-xs text-muted-foreground">No logins saved yet.</p>
                  )}
                  <div className="space-y-2">
                    {projectCredentials.map(cred => (
                      <div key={cred.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm">
                        <span className="w-28 shrink-0 font-medium text-gray-900 truncate">{cred.service}</span>
                        <div className="flex flex-1 items-center gap-1.5 min-w-[140px]">
                          <span className="truncate text-muted-foreground">{cred.username}</span>
                          <button type="button" onClick={() => copyToClipboard(cred.username, `u${cred.id}`)} className="shrink-0 text-muted-foreground hover:text-brand-700">
                            {copiedIndex === `u${cred.id}` ? <span className="text-xs text-green-600">Copied</span> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        <div className="flex flex-1 items-center gap-1.5 min-w-[140px]">
                          <span className="truncate font-mono text-muted-foreground">{visiblePasswords[cred.id] ? cred.password : "••••••••"}</span>
                          <button type="button" onClick={() => setVisiblePasswords(v => ({ ...v, [cred.id]: !v[cred.id] }))} className="shrink-0 text-muted-foreground hover:text-gray-700">
                            {visiblePasswords[cred.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button type="button" onClick={() => copyToClipboard(cred.password, `p${cred.id}`)} className="shrink-0 text-muted-foreground hover:text-brand-700">
                            {copiedIndex === `p${cred.id}` ? <span className="text-xs text-green-600">Copied</span> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        <button type="button" onClick={() => deleteCredentialMutation.mutate(cred.id)} className="shrink-0 text-muted-foreground hover:text-red-500">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
```

- [ ] **Step 7: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Manual smoke test as admin**

With the dev server running and logged in as an admin: open a project,
add a credential, confirm it appears; toggle password visibility; copy
username/password; delete it. Confirm the row disappears from
`project_credentials` in the Supabase dashboard too.

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard/projects/page.tsx
git commit -m "feat: move project credentials UI to project_credentials table"
```

---

### Task 6: End-to-end RLS verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1–5.

- [ ] **Step 1: Verify a non-assigned member cannot see credentials**

Using the "Add employee" form from Task 4, create a test employee with
role `member` (e.g. `qa-test@example.com`) and do NOT assign them to any
project that has credentials. Log in as that employee in a private/
incognito browser window, open a project with existing credentials.
Expected: the "Logins & Passwords" section renders with "No logins saved
yet." (RLS returns zero rows), even though the project itself and its
tasks/updates are fully visible.

- [ ] **Step 2: Verify assignment unlocks visibility**

While still logged in as admin in the original window, assign the test
employee to that project from the Team page (Task 4). In the incognito
window, refresh the project page.
Expected: the credentials now appear.

- [ ] **Step 3: Verify direct client-side access is also blocked, not just hidden in the UI**

Steps 1–2 already prove this, but through the app's own query functions.
To confirm the database itself enforces it (not just `queries.ts`), ask
the human operator to run this in the Supabase SQL editor, substituting
the test employee's UUID (Authentication → Users) and a project id they
are not assigned to:

```sql
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "<test-employee-uuid>", "role": "authenticated"}';
SELECT * FROM project_credentials WHERE project_id = '<project-id>';
```

Expected: 0 rows, even though the same query as the `service_role` (no
`SET LOCAL ROLE`) returns the credentials. This confirms the RLS policy
itself blocks access, not just the app's UI or query layer.

- [ ] **Step 4: Verify the create-employee endpoint's admin gate**

Log in as the non-admin test employee, open browser devtools console on
any dashboard page, and run:

```js
fetch("/api/employees/create", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ full_name: "Should Fail", email: "shouldfail@example.com", password: "testpassword123", role: "admin" }),
}).then(r => r.json()).then(console.log);
```

Expected: `{ error: "Admin access required" }` and no new row in
`employees` or Supabase Auth Users.

- [ ] **Step 5: Clean up the test employee**

Ask the human operator to delete the `qa-test@example.com` user from
Supabase Auth → Users (this cascades to the `employees` row via foreign
key, per the `employees` schema's existing `ON DELETE` behavior — if it
does not cascade, delete the `employees` row manually first, then the
auth user).

- [ ] **Step 6: Final full type-check**

Run: `npx tsc --noEmit`
Expected: clean, no errors anywhere in the project.
