# Employee sync tokens (unified live sync + self-registration)

> **Superseded 2026-08-23** by `2026-08-23-project-sync-tokens-design.md`.
> The user reconsidered the per-employee token model (disliked the extra
> personal-setup step) and asked to go back to per-project tokens with a
> lightweight, unverified `employee_email` field for attribution instead.
> This document (and the `employee_sync_tokens` table / per-employee UI it
> describes) is kept for history only — it was fully implemented and
> shipped before being reverted.

## Supersedes

This spec replaces the token-management mechanism from two earlier specs:

- `2026-08-22-live-project-sync-design.md`'s per-project `project_sync_tokens`
  table and its "Live Sync" section on the Projects page (shipped, but
  the table has zero rows — confirmed via `SELECT count(*) FROM
  project_sync_tokens` before writing this migration, so nothing real is
  lost by dropping it).
- `2026-08-22-project-self-registration-design.md`'s `hub_registration_token`
  singleton table and Settings page (never implemented — this spec
  replaces that plan before any code was written for it).

The rest of those specs — `project_updates` as the timeline sink, the
`gdl_sync_` token format, SHA-256 hash-only storage — carries forward
unchanged.

## Problem

Two things surfaced while building the previous design: (1) the owner
wants Claude to register brand-new projects with the Hub on its own, no
manual form; (2) multiple people (the owner and other employees) work on
the same project in parallel, and a single shared per-project token can't
tell them apart — every update looks like it came from whoever generated
the token.

Both problems share one root fix: identity should belong to the *person*,
not the *project*. One token per employee, used for everything they do
across every project, solves both — no per-project setup step, and every
update is correctly attributed to whoever actually posted it.

## Non-goals

- Updating a project's title/description/stack on repeat registration
  calls — `POST /api/projects/register` is find-or-create by `slug`; if
  the project already exists, it's returned as-is, other fields in the
  request are ignored. Editing project details stays a manual Projects-page
  action.
- Employees self-serving their own token — generation stays admin-only,
  same as every other admin-gated action in this app (credentials,
  project assignment, employee creation).
- Local caching of a project's Hub `id` between sessions — registration
  is cheap and idempotent, so the CLAUDE.md convention just calls it at
  the start of every session rather than persisting a marker file.

## Data model

### `employee_sync_tokens` (new table, replaces `project_sync_tokens`)

```sql
DROP TABLE IF EXISTS project_sync_tokens;

CREATE TABLE employee_sync_tokens (
  employee_id    UUID PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
  created_by     UUID NOT NULL REFERENCES employees(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  regenerated_at TIMESTAMPTZ
);

ALTER TABLE employee_sync_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_sync_tokens_admin_only" ON employee_sync_tokens
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));
```

`employee_id` is the primary key — one token per person, ever. `created_by`
records which admin set it up (for audit purposes only; it's `employee_id`
that determines attribution on every synced update, not `created_by`).
Same hash-only storage principle as before: the raw token is generated,
returned once, never persisted.

## API routes

### `GET /api/employees/sync-token?employeeId=...` — status only

Admin-only. Returns `{ exists: boolean, createdAt: string | null, regeneratedAt: string | null }`.

### `POST /api/employees/sync-token` — generate or regenerate

Admin-only. Body `{ employeeId: string }`. Same upsert-by-primary-key
logic as the prior per-project route, keyed on `employee_id` instead of
`project_id`. Returns `{ token: string, employeeId: string, employeeName: string }`
— the raw token, shown once.

### `POST /api/projects/register` — find-or-create a project

No Supabase Auth session — authenticated by the employee token in the
body.

Request:
```ts
{
  token: string;
  slug: string;
  title: string;
  client_name?: string;
  description?: string;
  status?: "backlog" | "active" | "review" | "completed"; // default "active"
  priority?: "low" | "medium" | "high"; // default "medium"
  due_date?: string;
  repo_path?: string;
  repo_url?: string;
  stack?: string[];
}
```

1. Reject if `token`, `slug`, or `title` missing → 400.
2. Hash the token, look up `employee_sync_tokens` by `token_hash` → 401 if
   no match. The matched row's `employee_id` is who this project (if
   newly created) gets attributed to.
3. Look up `projects` by `slug` (service-role client). If found, return
   it as-is — ignore the rest of the request body (see Non-goals).
4. If not found, insert a new project with `created_by = employee_id` and
   the request's other fields (status/priority defaulted as noted).
5. Return `{ project: <the row, found or created> }`.

### `POST /api/sync/update` — post a progress update

No Supabase Auth session — authenticated by the employee token in the
body, same hashing/lookup as before.

Request: `{ token: string; project_id: string; title: string; details?: string; update_type?: "progress" | "note" | "blocker" | "decision" }`

1. Reject if `token`, `project_id`, or `title` missing → 400.
2. Hash the token, look up `employee_sync_tokens` by `token_hash` → 401 if
   no match.
3. Insert into `project_updates`: `{ project_id, title, details: details ?? "", update_type: update_type ?? "progress", created_by: employee_id }`.
   A nonexistent `project_id` fails the row's foreign key constraint,
   surfacing as a 400 from the insert error — no separate existence
   check needed.
4. Return `{ success: true }`.

## UI

### Remove: Projects page "Live Sync" section

The section added by the prior plan (project-scoped generate/regenerate,
snippet display) is removed entirely — sync identity is no longer
project-scoped. `getSyncTokenStatus`/`generateSyncToken` (the
project-scoped query wrappers) and `/api/projects/sync-token` (the
project-scoped route) are removed and replaced by the employee-scoped
versions below.

### Add: Team page, per-employee "Sync token" control

On each employee card (admin view only, same admin-gating pattern as the
existing project-assignment picker on this page):
- **No token yet:** "Set up sync" button.
- **Just generated:** the raw token in a copy-able block, plus the full
  `~/.claude/CLAUDE.md` snippet (below) with that employee's token filled
  in, and a "Copy snippet" button. Shown once.
- **Token exists:** "Sync active — created/regenerated ... ago" plus a
  "Regenerate" button behind a confirm dialog (same pattern as the
  removed per-project one) warning that the old token stops working
  immediately.

## Generated `~/.claude/CLAUDE.md` snippet

```markdown
## GoDevLab Hub — live sync

This is your personal GoDevLab Hub sync token (`<employee name>`). It
works across every project on this laptop — nothing project-specific to
set up.

At the start of a session in any project worth tracking in the Hub,
first make sure it's registered (safe to call every session — it's
find-or-create by slug, so it never duplicates):

\`\`\`bash
curl -s -X POST http://localhost:3000/api/projects/register \
  -H "Content-Type: application/json" \
  -d '{"token":"<TOKEN>","slug":"<short-project-slug>","title":"<project name>","description":"<one-line description>","stack":["..."],"repo_path":"<absolute path to this project>"}'
\`\`\`

This returns `{"project": {"id": "...", ...}}` — note the `id`, you need
it for updates below (just remember it for the rest of this session).

After finishing each meaningful task, milestone, bug fix, or decision,
post a progress update:

\`\`\`bash
curl -s -X POST http://localhost:3000/api/sync/update \
  -H "Content-Type: application/json" \
  -d '{"token":"<TOKEN>","project_id":"<id from above>","title":"<short title>","details":"<1-3 sentences on what changed>","update_type":"progress"}'
\`\`\`

Use `update_type`: `"progress"` (default), `"blocker"`, `"decision"`, or
`"note"`.

This requires the GoDevLab Hub dev server (`npm run dev`) running on this
laptop to receive updates.
```

## Testing

No automated test runner in this repo — manual verification:

- Generate a sync token for an employee from the Team page, confirm it's
  shown only once.
- Run the register curl command with a fresh slug/title — confirm a new
  project appears in the Hub's project list, `created_by` is that
  employee.
- Run the exact same register command again unchanged — confirm it
  returns the same project (no duplicate created).
- Run the sync/update curl command with the returned `project_id` —
  confirm the update appears in that project's timeline, attributed to
  the correct employee.
- Run either endpoint with a bad token — confirm 401, nothing written.
- Regenerate the employee's token — confirm the old one now gets 401 on
  both endpoints, the new one works.
- Confirm a non-admin can't see any employee's sync-token controls on the
  Team page (their own included) and gets 401/403 hitting
  `/api/employees/sync-token` directly.
