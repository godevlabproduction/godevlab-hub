# Employee project scoping & in-app employee creation

## Problem

Today any authenticated employee can see every project's `credentials`
field (service logins/passwords) — the `projects` table's RLS policy is
`USING (true)` and `credentials` is just a JSONB array column on that row.
There's also no in-app way to add a new employee; accounts are created
directly in the Supabase dashboard.

The owner wants to assign specific employees to specific projects, and
have project credentials visible only to admins and to employees assigned
to that project. Everything else (project list, tasks, updates, notes,
the employee directory) stays visible to everyone, same as today.

## Non-goals

- Restricting visibility of anything other than `credentials` (projects,
  tasks, notes, other employees all stay fully visible to all employees).
- Invite emails / passwordless signup for new employees — admin sets an
  initial password directly.
- Self-service password change/reset flow for employees.
- Letting non-admins manage assignments or credentials (open question
  resolved below: admin-only for both).

## Data model

### `project_assignments` (new table)

```sql
CREATE TABLE project_assignments (
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
```

Read is open (same pattern as every other table in this schema — the UI
needs to show "assigned to: X, Y" badges to everyone). Write is admin-only,
matching the decision that assignment is managed from the employee's card
by an admin.

### `project_credentials` (new table, replaces `projects.credentials`)

```sql
CREATE TABLE project_credentials (
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
```

This is the enforcement point. Postgres RLS is row-level, not column-level,
so the only reliable way to hide `credentials` from part of a row while
leaving the rest open is to move it into its own table with its own
policy — same pattern this schema already uses for `personal_tasks`.

Write is admin-only (per design approval — non-admins can view credentials
for assigned projects but not add/edit/delete them). Revisit later if the
owner wants assigned members to manage their own project's credentials.

### Migration: move existing data, drop the old column

```sql
INSERT INTO project_credentials (project_id, service, username, password, created_by, created_at)
SELECT p.id, c->>'service', c->>'username', c->>'password', p.created_by, p.created_at
FROM projects p, jsonb_array_elements(p.credentials) AS c
WHERE p.credentials IS NOT NULL AND jsonb_array_length(p.credentials) > 0;

ALTER TABLE projects DROP COLUMN credentials;
```

Ships as one migration file alongside the two `CREATE TABLE` statements
above (`supabase/migrations/<date>_project_scoping.sql`).

## Employee creation

New admin-only Next.js route handler: `POST /api/employees/create`.

1. Reads the caller's session from the request cookies (same
   `createServerClient` pattern as `proxy.ts`), looks up their `employees`
   row, rejects with 403 if not found or not `role = 'admin'`.
2. Creates a second Supabase client using `SUPABASE_SERVICE_ROLE_KEY`
   (server-only env var, never `NEXT_PUBLIC_`) and calls
   `supabase.auth.admin.createUser({ email, password, email_confirm: true })`.
3. Inserts `{ id: newUser.id, full_name, email, role }` into `employees`
   using the same service-role client (bypasses RLS, which is fine — the
   route itself already gated on admin).
4. Returns the new employee row; the client invalidates the `employees`
   query.

Requires adding `SUPABASE_SERVICE_ROLE_KEY` to `.env.local` — the owner
will pull this from Settings → API in the Supabase dashboard and provide
it (not committed, not requested by the assistant beyond asking for the
value).

## UI changes

**Team page** (`src/app/dashboard/employees/page.tsx`):
- "Add employee" button (visible to admins only), opens a form: full
  name, email, initial password, role. Submits to the new route.
- Each employee card gets an "Assigned projects" control (admin view
  only): a multi-select over `getProjects()` results, backed by
  `project_assignments`. Checking/unchecking calls insert/delete against
  that table directly from the client (RLS already restricts writes to
  admins, so no extra route needed here).

**Projects page** (`src/app/dashboard/projects/page.tsx`):
- Credentials section switches from reading `selectedProject.credentials`
  to a `useQuery(["project_credentials", projectId], ...)` against the new
  table. Add/delete forms call new `createProjectCredential` /
  `deleteProjectCredential` query functions instead of folding credentials
  into `updateProject`.
- No client-side role checks needed for hiding the section — if RLS
  returns zero rows, the section just renders empty for a non-assigned,
  non-admin employee. (It should still render the "Credentials" tab/section
  itself, just empty — visually distinguishing "no credentials on this
  project" from "you can't see them" is a minor UX nicety, not required.)

## New types & queries

`src/types/index.ts`:
- `ProjectCredential` gains `id`, `project_id`, `created_by`, `created_at`
  (currently just `{ service, username, password }`); drop `credentials`
  from the `Project` interface.
- New `ProjectAssignment { project_id: string; employee_id: string; created_at: string }`.

`src/lib/supabase/queries.ts`:
- `getProjectCredentials(supabase, projectId)`, `createProjectCredential`,
  `deleteProjectCredential`.
- `getProjectAssignments(supabase, projectId?)`, `assignEmployeeToProject`,
  `unassignEmployeeFromProject`.
- `createEmployee` — thin wrapper posting to `/api/employees/create`.
- Remove `credentials` from `updateProject`'s allowed input fields.

## Testing

- Manual RLS check (this is the part that actually matters): log in as a
  non-admin employee with no assignments, confirm `project_credentials`
  select returns empty for a project with existing credentials; assign
  them via the Team page; confirm the same query now returns rows.
- Manual check that a non-admin cannot write to `project_assignments` or
  `project_credentials` directly (e.g. via the Supabase JS client in a
  browser console) — should fail on RLS, not just be hidden in the UI.
- `POST /api/employees/create` as non-admin → 403. As admin → new
  employee appears in Supabase Auth and in the Team page.
- `npx tsc --noEmit` clean after the type/query changes.
