# Project Sync Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-employee sync token model (shipped, then
reverted by the owner) with per-project tokens generated automatically
when a project is created, plus a lightweight, unverified `employee_email`
field on each sync update for attribution when more than one person
works on the same project.

**Architecture:** `employee_sync_tokens` is dropped and replaced by
`project_sync_tokens` (project-keyed, hash-only storage, admin-only RLS —
structurally identical to this app's very first sync-token table). The
Team page's per-employee "Live Sync" section is removed entirely
(reverting that file to its pre-sync-feature state); the Projects page
regains a per-project "Live Sync" section, and `createProjectMutation`
automatically generates that project's token right after creation.
`/api/projects/register` is removed (no longer needed — projects are
always created through the authenticated browser form now).
`POST /api/sync/update` is rewritten again to authenticate by project
token and resolve `created_by` from an optional `employee_email` in the
request body, falling back to the token's own creator.

**Tech Stack:** Next.js 16 (App Router), TypeScript, `@supabase/supabase-js`
(service-role client), Node's `crypto` module, TanStack Query, existing
shadcn-style `Dialog`/`Button`/`Textarea` components.

**Spec:** `docs/superpowers/specs/2026-08-23-project-sync-tokens-design.md`

## Global Constraints

- The raw sync token is never stored anywhere, client or server — only
  its SHA-256 hash, in `project_sync_tokens.token_hash`.
- `project_sync_tokens` RLS is admin-only for all operations, matching
  every other sensitive table in this app.
- `employee_email` on `/api/sync/update` is an unverified, plain lookup —
  do not add any verification layer (signing, per-user sub-tokens, etc.);
  this is an explicit, accepted tradeoff, not a gap to close.
- No automated test runner exists in this repo. Verification uses
  `npx tsc --noEmit`, `curl`, and manual browser checks.
- This repo has no linked Supabase CLI and the Supabase MCP connection
  lacks permission on project `izgrryarnsbkxmrffcio`. Any SQL against the
  live database must be run by the human operator in the Supabase SQL
  editor.
- `/api/projects/register` and the per-employee sync mechanism
  (`employee_sync_tokens`, `EmployeeSyncSection`, `getEmployeeSyncTokenStatus`,
  `generateEmployeeSyncToken`) are removed entirely by this plan — do not
  leave any dangling reference to them.

---

### Task 1: Database migration — project_sync_tokens

**Files:**
- Create: `supabase/migrations/20260823_project_sync_tokens.sql`

**Interfaces:**
- Produces: table `project_sync_tokens(project_id, token_hash, created_by, created_at, regenerated_at)`, RLS-enabled, admin-only. `employee_sync_tokens` no longer exists after this migration.

- [ ] **Step 1: Write the migration file**

```sql
DROP TABLE IF EXISTS employee_sync_tokens;

CREATE TABLE project_sync_tokens (
  project_id     UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
  created_by     UUID NOT NULL REFERENCES employees(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  regenerated_at TIMESTAMPTZ
);

ALTER TABLE project_sync_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_sync_tokens_admin_only" ON project_sync_tokens
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));
```

- [ ] **Step 2: Human operator runs the migration**

Tell the human operator: "Open the Supabase SQL editor for project
`izgrryarnsbkxmrffcio` (https://supabase.com/dashboard/project/izgrryarnsbkxmrffcio/sql/new),
paste in the contents of `supabase/migrations/20260823_project_sync_tokens.sql`,
and run it. Let me know when it's done."

Wait for confirmation before continuing.

- [ ] **Step 3: Verify the migration applied**

Ask the human operator to run this and paste the result:

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'project_sync_tokens') AS has_new,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'employee_sync_tokens') AS old_still_exists;
```

Expected: `has_new = 1`, `old_still_exists = 0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260823_project_sync_tokens.sql
git commit -m "feat: replace employee_sync_tokens with project_sync_tokens"
```

---

### Task 2: Remove the per-employee sync mechanism

**Files:**
- Delete: `src/app/api/employees/sync-token/route.ts`
- Delete: `src/app/api/projects/register/route.ts`
- Modify: `src/lib/supabase/queries.ts`
- Modify: `src/app/dashboard/employees/page.tsx` (full replacement)

**Interfaces:**
- Consumes: nothing new.
- Produces: a codebase with no references to `getEmployeeSyncTokenStatus`, `generateEmployeeSyncToken`, `EmployeeSyncSection`, or the two deleted routes.

- [ ] **Step 1: Delete the two obsolete route files**

```bash
rm src/app/api/employees/sync-token/route.ts
rm src/app/api/projects/register/route.ts
```

- [ ] **Step 2: Remove the employee-scoped query wrappers**

Find, at the end of `src/lib/supabase/queries.ts`:

```ts
export async function getEmployeeSyncTokenStatus(employeeId: string): Promise<{ exists: boolean; createdAt: string | null; regeneratedAt: string | null }> {
  const res = await fetch(`/api/employees/sync-token?employeeId=${employeeId}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to fetch sync token status");
  return json;
}

export async function generateEmployeeSyncToken(employeeId: string): Promise<{ token: string; employeeId: string; employeeName: string }> {
  const res = await fetch("/api/employees/sync-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ employeeId }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Failed to generate sync token");
  return json;
}
```

Delete both functions entirely.

- [ ] **Step 3: Replace the entire Team page file**

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
  const [assignError, setAssignError] = useState<string | null>(null);

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project_assignments"] });
      setAssignError(null);
    },
    onError: (err: Error) => setAssignError(err.message),
  });
  const unassignMutation = useMutation({
    mutationFn: ({ projectId, employeeId }: { projectId: string; employeeId: string }) =>
      unassignEmployeeFromProject(supabase, projectId, employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project_assignments"] });
      setAssignError(null);
    },
    onError: (err: Error) => setAssignError(err.message),
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
                        {assignError && <p className="text-xs text-red-600">{assignError}</p>}
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

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors from `employees/page.tsx` or `queries.ts`. (Errors
may still appear in `projects/page.tsx` referencing the now-removed
`/api/sync/update` shape or nothing at all — Task 3/4 handle that file;
if any appear here, note them but don't fix them in this task.)

- [ ] **Step 5: Commit**

```bash
git add -u src/app/api/employees/sync-token/route.ts src/app/api/projects/register/route.ts src/lib/supabase/queries.ts src/app/dashboard/employees/page.tsx
git commit -m "chore: remove per-employee sync mechanism"
```

---

### Task 3: New backend — project tokens, employee_email attribution

**Files:**
- Create: `src/app/api/projects/sync-token/route.ts`
- Modify: `src/app/api/sync/update/route.ts` (full rewrite)
- Modify: `src/lib/supabase/queries.ts`

**Interfaces:**
- Consumes: `createClient` (server) from `src/lib/supabase/server.ts`, `createAdminClient` from `src/lib/supabase/admin.ts` (both already exist).
- Produces: `GET/POST /api/projects/sync-token`, rewritten `POST /api/sync/update`, and client wrappers `getSyncTokenStatus(projectId)`, `generateSyncToken(projectId)` in `queries.ts` — used by Task 4.

- [ ] **Step 1: Create the admin-authenticated project token route**

Create `src/app/api/projects/sync-token/route.ts`:

```ts
import { randomBytes, createHash } from "crypto";
import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  const { data: caller } = await supabase.from("employees").select("role").eq("id", user.id).single();
  if (caller?.role !== "admin") {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }

  return { userId: user.id };
}

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("project_sync_tokens")
    .select("created_at, regenerated_at")
    .eq("project_id", projectId)
    .maybeSingle();

  return NextResponse.json({
    exists: Boolean(data),
    createdAt: data?.created_at ?? null,
    regeneratedAt: data?.regenerated_at ?? null,
  });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null) as { projectId?: string } | null;
  const projectId = body?.projectId;
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: project } = await admin.from("projects").select("title").eq("id", projectId).single();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const token = `gdl_sync_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { data: existing } = await admin
    .from("project_sync_tokens")
    .select("project_id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("project_sync_tokens")
      .update({ token_hash: tokenHash, regenerated_at: new Date().toISOString() })
      .eq("project_id", projectId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { error } = await admin
      .from("project_sync_tokens")
      .insert({ project_id: projectId, token_hash: tokenHash, created_by: auth.userId });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ token, projectId, projectTitle: project.title });
}
```

- [ ] **Step 2: Rewrite the sync update endpoint**

Replace the entire contents of `src/app/api/sync/update/route.ts` with:

```ts
import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const VALID_UPDATE_TYPES = ["progress", "note", "blocker", "decision"] as const;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    token?: string; employee_email?: string; title?: string; details?: string; update_type?: string;
  } | null;

  const { token, employee_email, title, details, update_type } = body ?? {};
  if (!token || !title?.trim()) {
    return NextResponse.json({ error: "Missing token or title" }, { status: 400 });
  }
  const updateType = VALID_UPDATE_TYPES.includes(update_type as typeof VALID_UPDATE_TYPES[number])
    ? (update_type as typeof VALID_UPDATE_TYPES[number])
    : "progress";

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const admin = createAdminClient();

  const { data: tokenRow } = await admin
    .from("project_sync_tokens")
    .select("project_id, created_by")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!tokenRow) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  let attributedTo = tokenRow.created_by;
  if (employee_email?.trim()) {
    const { data: matchedEmployee } = await admin
      .from("employees")
      .select("id")
      .eq("email", employee_email.trim())
      .maybeSingle();
    if (matchedEmployee) {
      attributedTo = matchedEmployee.id;
    }
  }

  const { error } = await admin.from("project_updates").insert({
    project_id: tokenRow.project_id,
    title: title.trim(),
    details: details?.trim() || "",
    update_type: updateType,
    created_by: attributedTo,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 3: Add the client query wrappers**

Append to the end of `src/lib/supabase/queries.ts`:

```ts
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
```

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors from any of the three files touched in this task.
(Task 4 still needs to run before `projects/page.tsx` compiles clean,
since it doesn't yet import these new functions — that's expected.)

- [ ] **Step 5: Verify the auth-rejection paths**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/projects/sync-token?projectId=00000000-0000-0000-0000-000000000000
```
Expected: `401`

```bash
curl -s -X POST http://localhost:3000/api/sync/update -H "Content-Type: application/json" -d '{"token":"gdl_sync_bogus","title":"test"}'
```
Expected: `{"error":"Invalid token"}`, status `401`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/projects/sync-token/route.ts src/app/api/sync/update/route.ts src/lib/supabase/queries.ts
git commit -m "feat: add project sync tokens with employee_email attribution"
```

---

### Task 4: Projects page — Live Sync section + auto-generate on create

**Files:**
- Modify: `src/app/dashboard/projects/page.tsx`

**Interfaces:**
- Consumes: `getSyncTokenStatus`, `generateSyncToken` from `src/lib/supabase/queries.ts` (Task 3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add new icon imports**

Find:

```ts
import { CalendarDays, CheckSquare2, Copy, ExternalLink, Eye, EyeOff, FolderKanban, KeyRound, Link2, ListTodo, PlusCircle, Trash2, X } from "lucide-react";
```

Replace with:

```ts
import { CalendarDays, CheckSquare2, Copy, ExternalLink, Eye, EyeOff, FolderKanban, KeyRound, Link2, ListTodo, PlusCircle, Radio, RefreshCw, Trash2, X } from "lucide-react";
```

- [ ] **Step 2: Add the query import**

Find:

```ts
import {
  getProjects, getAllProjectTasks, getProjectUpdates,
  createProject, updateProject, createProjectTask, updateProjectTask,
  deleteProjectTask, createProjectUpdate, deleteProjectUpdate,
  getProjectCredentials, createProjectCredential, deleteProjectCredential,
} from "@/lib/supabase/queries";
```

Replace with:

```ts
import {
  getProjects, getAllProjectTasks, getProjectUpdates,
  createProject, updateProject, createProjectTask, updateProjectTask,
  deleteProjectTask, createProjectUpdate, deleteProjectUpdate,
  getProjectCredentials, createProjectCredential, deleteProjectCredential,
  getSyncTokenStatus, generateSyncToken,
} from "@/lib/supabase/queries";
```

- [ ] **Step 3: Add the snippet-builder helper function**

Find:

```ts
const selectCls = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
```

Add immediately after it:

```ts

function buildSyncSnippet(projectTitle: string, token: string): string {
  return `## GoDevLab Hub — live sync

This project (\`${projectTitle}\`) is registered with GoDevLab Hub. After finishing each meaningful task, milestone, bug fix, or decision, post a progress update:

\`\`\`bash
curl -s -X POST http://localhost:3000/api/sync/update \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${token}","employee_email":"<your email>","title":"<short title>","details":"<1-3 sentences on what changed>","update_type":"progress"}'
\`\`\`

\`employee_email\` is optional but recommended when more than one person works on this project — it attributes the update to you specifically (unverified — just fill in your own GoDevLab Hub email). Omit it and updates are attributed to whoever set up this project's sync.

Use \`update_type\`: \`"progress"\` (default), \`"blocker"\`, \`"decision"\`, or \`"note"\`.

This requires the GoDevLab Hub dev server (\`npm run dev\`) running on this laptop to receive updates.`;
}
```

- [ ] **Step 4: Add state for the sync UI**

Find:

```ts
  const [addingCred, setAddingCred] = useState(false);
  const [credService, setCredService] = useState("");
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
```

Replace with:

```ts
  const [addingCred, setAddingCred] = useState(false);
  const [credService, setCredService] = useState("");
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [syncToken, setSyncToken] = useState<string | null>(null);
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
  const [syncGenerateError, setSyncGenerateError] = useState<string | null>(null);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
```

- [ ] **Step 5: Add the sync status query and reset effect**

Find:

```ts
  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId) ?? null, [projects, selectedProjectId]);
  const { data: projectCredentials = [] } = useQuery({
    queryKey: ["project_credentials", selectedProjectId],
    queryFn: () => getProjectCredentials(supabase, selectedProjectId!),
    enabled: Boolean(selectedProjectId),
  });
  const selectedTasks = useMemo(() => allTasks.filter(t => t.project_id === selectedProjectId), [allTasks, selectedProjectId]);
```

Replace with:

```ts
  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId) ?? null, [projects, selectedProjectId]);
  const { data: projectCredentials = [] } = useQuery({
    queryKey: ["project_credentials", selectedProjectId],
    queryFn: () => getProjectCredentials(supabase, selectedProjectId!),
    enabled: Boolean(selectedProjectId),
  });
  const { data: syncStatus } = useQuery({
    queryKey: ["sync-token-status", selectedProjectId],
    queryFn: () => getSyncTokenStatus(selectedProjectId!),
    enabled: Boolean(selectedProjectId),
  });
  useEffect(() => {
    setSyncToken(null);
    setSyncGenerateError(null);
  }, [selectedProjectId]);
  const selectedTasks = useMemo(() => allTasks.filter(t => t.project_id === selectedProjectId), [allTasks, selectedProjectId]);
```

- [ ] **Step 6: Add the generate/regenerate mutation and wire it into project creation**

Find:

```ts
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSelectedProjectId(project.id);
      setProjectTitle(""); setProjectSlug(""); setProjectClientName(""); setProjectDescription("");
      setProjectStatus("active"); setProjectPriority("medium"); setProjectDueDate("");
      setProjectRepoPath(""); setProjectRepoUrl(""); setProjectStack("");
      setProjectDialogOpen(false);
    },
  });
```

Replace with:

```ts
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSelectedProjectId(project.id);
      setProjectTitle(""); setProjectSlug(""); setProjectClientName(""); setProjectDescription("");
      setProjectStatus("active"); setProjectPriority("medium"); setProjectDueDate("");
      setProjectRepoPath(""); setProjectRepoUrl(""); setProjectStack("");
      setProjectDialogOpen(false);
      generateSyncTokenMutation.mutate(project.id);
    },
  });
```

Find:

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

Replace with:

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
  const generateSyncTokenMutation = useMutation({
    mutationFn: (projectId?: string) => generateSyncToken(projectId ?? selectedProject!.id),
    onSuccess: (data) => {
      setSyncToken(data.token);
      setRegenerateDialogOpen(false);
      setSyncGenerateError(null);
      queryClient.invalidateQueries({ queryKey: ["sync-token-status", data.projectId] });
    },
    onError: (err: Error) => setSyncGenerateError(err.message),
  });
```

Note: `createProjectMutation` is defined before `generateSyncTokenMutation`
in the file but references it inside a callback — this is safe in
JavaScript (the callback isn't invoked until well after both `const`
declarations have run), same pattern this codebase already uses
elsewhere.

- [ ] **Step 7: Render the Live Sync section**

Find the end of the credentials section (immediately after the closing
of the credentials list `<div>`, right before the due-date/task-stats
row):

```tsx
                        <button type="button" onClick={() => deleteCredentialMutation.mutate(cred.id)} className="shrink-0 text-muted-foreground hover:text-red-500">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
```

Replace with:

```tsx
                        <button type="button" onClick={() => deleteCredentialMutation.mutate(cred.id)} className="shrink-0 text-muted-foreground hover:text-red-500">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                      <Radio className="h-4 w-4 text-brand-700" />
                      Live Sync
                    </div>
                  </div>
                  {!syncStatus?.exists && !syncToken && (
                    <Button
                      type="button"
                      size="sm"
                      className="bg-brand-700 hover:bg-brand-800"
                      onClick={() => generateSyncTokenMutation.mutate(undefined)}
                      disabled={generateSyncTokenMutation.isPending}
                    >
                      {generateSyncTokenMutation.isPending ? "Setting up..." : "Set up live sync"}
                    </Button>
                  )}
                  {syncGenerateError && <p className="mt-2 text-xs text-red-600">{syncGenerateError}</p>}
                  {syncToken && (
                    <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <p className="text-xs text-muted-foreground">
                        Paste this into the project&apos;s CLAUDE.md. This token is shown only once — copy it now.
                      </p>
                      <Textarea readOnly rows={8} value={buildSyncSnippet(selectedProject.title, syncToken)} className="font-mono text-xs" />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => copyToClipboard(buildSyncSnippet(selectedProject.title, syncToken), "sync-snippet")}
                      >
                        {copiedIndex === "sync-snippet" ? <span className="text-xs text-green-600">Copied</span> : <><Copy className="mr-1.5 h-3.5 w-3.5" />Copy snippet</>}
                      </Button>
                    </div>
                  )}
                  {syncStatus?.exists && !syncToken && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm">
                      <span className="text-xs text-muted-foreground">
                        Live sync active — {syncStatus.regeneratedAt
                          ? `regenerated ${formatDistanceToNow(new Date(syncStatus.regeneratedAt), { addSuffix: true })}`
                          : `set up ${formatDistanceToNow(new Date(syncStatus.createdAt!), { addSuffix: true })}`}
                      </span>
                      <Dialog open={regenerateDialogOpen} onOpenChange={setRegenerateDialogOpen}>
                        <DialogTrigger className={cn(buttonVariants(), "h-8 px-3 text-xs bg-white border border-gray-200 text-gray-700 hover:bg-gray-50")}>
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5 inline" />Regenerate
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Regenerate sync token?</DialogTitle></DialogHeader>
                          <p className="text-sm text-muted-foreground">
                            The current token will stop working immediately. Any project still using it will get rejected (401) until you update it with the new one.
                          </p>
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="ghost" onClick={() => setRegenerateDialogOpen(false)}>Cancel</Button>
                            <Button
                              type="button"
                              className="bg-red-600 hover:bg-red-700"
                              onClick={() => generateSyncTokenMutation.mutate(undefined)}
                              disabled={generateSyncTokenMutation.isPending}
                            >
                              {generateSyncTokenMutation.isPending ? "Regenerating..." : "Regenerate anyway"}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
```

- [ ] **Step 8: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the project.

- [ ] **Step 9: Manual smoke test as admin**

With the dev server running and logged in as an admin: create a new
project and confirm the Live Sync snippet panel appears automatically
with a real token, without a separate "Set up live sync" click. Refresh
— confirm it now shows "Live sync active." Click "Regenerate," confirm
the dialog works.

- [ ] **Step 10: Commit**

```bash
git add src/app/dashboard/projects/page.tsx
git commit -m "feat: add project Live Sync section with auto-generate on create"
```

---

### Task 5: End-to-end verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1–4.

- [ ] **Step 1: Create a project and capture its token**

As admin, create a new project via "New Project." Confirm the snippet
panel shows immediately with a real token. **Copy the raw token value
now and keep it at hand** — Steps 2-5 below need it.

- [ ] **Step 2: Post an update attributed to a specific employee**

```bash
curl -s -X POST http://localhost:3000/api/sync/update \
  -H "Content-Type: application/json" \
  -d '{"token":"<the token from Step 1>","employee_email":"<a real employee email>","title":"Live sync test","details":"Verifying employee_email attribution.","update_type":"progress"}'
```

Expected: `{"success":true}`. Reload the project and confirm "Live sync
test" appears in its timeline, attributed to that employee (not
necessarily the admin who created the project, if they're different
people).

- [ ] **Step 3: Post an update with no employee_email**

```bash
curl -s -X POST http://localhost:3000/api/sync/update \
  -H "Content-Type: application/json" \
  -d '{"token":"<the token from Step 1>","title":"No email test","update_type":"note"}'
```

Expected: `{"success":true}`, attributed to the project's creator (the
admin who ran Step 1) — no `employee_email` was given.

- [ ] **Step 4: Post an update with an unknown employee_email**

```bash
curl -s -X POST http://localhost:3000/api/sync/update \
  -H "Content-Type: application/json" \
  -d '{"token":"<the token from Step 1>","employee_email":"nobody@example.com","title":"Unknown email test"}'
```

Expected: `{"success":true}` (not an error), attributed to the project's
creator — falling back gracefully rather than failing.

- [ ] **Step 5: Confirm bad tokens are rejected**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/sync/update -H "Content-Type: application/json" -d '{"token":"gdl_sync_wrong","title":"Should not appear"}'
```
Expected: `401`. Confirm "Should not appear" never shows up anywhere.

- [ ] **Step 6: Confirm regenerating invalidates the old token**

Regenerate the project's token from its Live Sync section. Re-run Step
2's curl with the Step-1 (now stale) token — expected: `401`. Re-run with
the new token — expected: `{"success":true}`.

- [ ] **Step 7: Confirm the Live Sync section and Team page are correctly scoped**

Log in as a non-admin employee. Confirm no "Live Sync" section appears
on any project, and the Team page shows no per-employee sync controls
(that whole mechanism no longer exists). Confirm
`GET /api/projects/sync-token?projectId=...` returns 401/403 for this
non-admin session.

- [ ] **Step 8: Final type-check**

Run: `npx tsc --noEmit`
Expected: clean, no errors anywhere in the project.
