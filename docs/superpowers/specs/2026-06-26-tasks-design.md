# Tasks Feature Design

**Date:** 2026-06-26
**Scope:** Add Employee Tasks and Personal Tasks as separate pages under Operations

---

## Overview

Two new task management pages added to the Operations sidebar section:

- **Employee Tasks** — tasks anyone can create and assign to any employee, optionally linked to a project
- **Personal Tasks** — private to-do items visible only to the creator, enforced at the DB level

---

## Database

### `employee_tasks`

```sql
CREATE TABLE employee_tasks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT NOT NULL,
  details     TEXT,
  status      TEXT NOT NULL DEFAULT 'todo'
              CHECK (status IN ('todo', 'in_progress', 'done')),
  due_date    DATE,
  assigned_to UUID NOT NULL REFERENCES employees(id),
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  created_by  UUID NOT NULL REFERENCES employees(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

RLS:
- `SELECT`: all authenticated
- `INSERT`: `created_by = auth.uid()`
- `UPDATE`: creator or admin
- `DELETE`: creator or admin

### `personal_tasks`

```sql
CREATE TABLE personal_tasks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,
  details    TEXT,
  status     TEXT NOT NULL DEFAULT 'todo'
             CHECK (status IN ('todo', 'in_progress', 'done')),
  due_date   DATE,
  created_by UUID NOT NULL REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

RLS:
- All operations (`SELECT`, `INSERT`, `UPDATE`, `DELETE`): `created_by = auth.uid()` — no admin override

Both tables get the `set_updated_at` trigger.

---

## Types

Add to `src/types/index.ts`:

```ts
export interface EmployeeTask {
  id: string;
  title: string;
  details: string | null;
  status: TaskStatus;
  due_date: string | null;
  assigned_to: string;
  project_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  assignee?: Employee;
  project?: Pick<Project, 'id' | 'title'>;
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
```

---

## Queries

Add to `src/lib/supabase/queries.ts`:

- `getEmployeeTasks(supabase)` — select all, join assignee + project title
- `createEmployeeTask(supabase, input)` — insert
- `updateEmployeeTask(supabase, taskId, input)` — update status (or full patch)
- `deleteEmployeeTask(supabase, taskId)` — delete
- `getPersonalTasks(supabase)` — select (RLS filters to current user automatically)
- `createPersonalTask(supabase, input)` — insert
- `updatePersonalTask(supabase, taskId, input)` — update status
- `deletePersonalTask(supabase, taskId)` — delete

---

## Pages

### `/dashboard/operations/employee-tasks`

Route: `src/app/dashboard/operations/employee-tasks/page.tsx`

Layout: two-column (matches Notes page pattern)
- **Left panel — Create Task form**
  - Title (required)
  - Details (optional textarea)
  - Assign to (employee select, required)
  - Project (optional select)
  - Due date (optional date input)
  - Submit button
- **Right panel — Task list**
  - All employee tasks, newest first
  - Each card shows: title, assignee name, project (if set), due date, status badge
  - Inline status toggle (todo → in_progress → done)
  - Delete button visible to creator or admin

### `/dashboard/operations/personal-tasks`

Route: `src/app/dashboard/operations/personal-tasks/page.tsx`

Layout: two-column (same pattern)
- **Left panel — Create Task form**
  - Title (required)
  - Details (optional textarea)
  - Due date (optional date input)
  - Submit button
- **Right panel — Task list**
  - Only current user's tasks (RLS enforces this)
  - Same card layout minus assignee
  - Inline status toggle
  - Delete button (always visible — you own all your tasks)

---

## Sidebar

Update `src/components/sidebar.tsx` — add to Operations section:

```ts
{ href: "/dashboard/operations/employee-tasks", label: "Employee Tasks", icon: ClipboardList },
{ href: "/dashboard/operations/personal-tasks", label: "My Tasks", icon: CheckSquare },
```

Note: existing `/dashboard/employees` href stays unchanged. The new routes use `/dashboard/operations/` prefix to namespace them cleanly without breaking existing links.

---

## Migration

Add `supabase/migrations/20260626_tasks.sql` with:
1. `CREATE TABLE employee_tasks`
2. `CREATE TABLE personal_tasks`
3. RLS enables + policies for both tables
4. `updated_at` triggers for both tables

The migration runs against the Supabase project via the Supabase dashboard or CLI.
