# Project sync tokens (final design: per-project + employee_email attribution)

## Supersedes

This spec replaces `2026-08-22-employee-sync-tokens-design.md` (the
per-employee token model — fully built and shipped, then reverted) and,
transitively, the two specs it had already superseded
(`2026-08-22-live-project-sync-design.md`,
`2026-08-22-project-self-registration-design.md`). This is the third and
final iteration.

## Problem

The per-employee token model worked but added friction the owner didn't
want: every employee needs their own personal setup step (visit Team
page, get a token, add it to their own `~/.claude/CLAUDE.md`) before they
can sync anything, even though in practice most projects have one or two
people on them. The owner wants back to the simpler model — one token per
project, generated at the moment the project is created — while still
being able to tell who posted a given update when more than one person
works on the same project.

## Non-goals

- Cryptographic verification of *who* posted an update — the
  `employee_email` field on a sync request is a plain, unverified claim.
  Anyone holding a project's token could claim to be any employee. This
  is an accepted, explicit tradeoff (the owner chose this over the
  stronger per-employee-token guarantee) — do not add signing, per-user
  sub-tokens, or any other verification layer.
- Self-registration of brand-new projects by Claude with no browser
  session involved — removed entirely. A project must be created through
  the Hub's own "New Project" form (an authenticated admin action) before
  any sync token for it can exist. `/api/projects/register` and the
  `hub_registration_token` concept from the superseded specs are gone.
- Any UI for editing a project's sync token from anywhere other than its
  own detail view (no Settings page, no bulk management).

## Data model

### `project_sync_tokens` (new table, replaces `employee_sync_tokens`)

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

This is structurally identical to the very first `project_sync_tokens`
table from the first superseded spec (project-keyed, hash-only storage,
admin-only RLS) — the design has come back to it, now combined with the
`employee_email` attribution field below and the create-time snippet flow.

## API routes

No new route is needed to create a project with a token in one step —
the browser already has an authenticated session at project-creation
time, so this is just the existing `createProject` call followed by the
existing per-project token-generate call below, chained client-side
(`createProjectMutation`'s `onSuccess` calls
`generateSyncTokenMutation.mutate(project.id)` — the same pattern already
built and shipped once for the per-project token model, reintroduced
here). No atomic server-side transaction is needed since both calls are
already scoped to the same authenticated admin and a failure of the
second call just leaves the project without a token yet, recoverable via
the regenerate flow below.

### `GET /api/projects/sync-token?projectId=...` — status only

Admin-only. Returns `{ exists: boolean, createdAt: string | null, regeneratedAt: string | null }`.
(Used by the project detail page's Live Sync section to show "active"
status rather than the raw token again, once the create-time snippet has
already been dismissed.)

### `POST /api/projects/sync-token` — generate or regenerate a project's token

Admin-only. Body `{ projectId: string }`. Upsert-by-primary-key: creates
the row if it doesn't exist yet, updates `token_hash` and
`regenerated_at` if it does. Returns `{ token: string, projectId: string, projectTitle: string }`.
This single route covers both the automatic call right after project
creation (below) and manual regeneration from the project detail page.

### `POST /api/sync/update` — post a progress update

No Supabase Auth session — authenticated by the project's token in the
body, same hash-and-lookup pattern used throughout this app's sync
routes.

Request: `{ token: string; employee_email?: string; title: string; details?: string; update_type?: "progress" | "note" | "blocker" | "decision" }`

1. Reject if `token` or `title` missing → 400.
2. Hash the token, look up `project_sync_tokens` by `token_hash` → 401 if
   no match. The matched row gives `project_id` and `created_by` (the
   token's own creator — used as the attribution fallback).
3. If `employee_email` is present: look up `employees` by `email`
   (case-sensitive exact match, matching how emails are stored/compared
   elsewhere in this app). If a matching employee is found, use their
   `id` as `created_by` for the update. If no match is found, or
   `employee_email` was omitted, fall back to the token row's own
   `created_by`.
4. Insert into `project_updates`: `{ project_id, title, details: details ?? "", update_type: update_type ?? "progress", created_by: <resolved above> }`.
5. Return `{ success: true }`.

No `/api/projects/register` — removed.

## UI

### Projects page — "New Project" auto-generates a token on success

The existing "New Project" dialog and its `createProject` submit call
are unchanged. What changes is `createProjectMutation`'s `onSuccess`: in
addition to selecting the new project and closing the dialog (existing
behavior), it also calls the token-generate route
(`POST /api/projects/sync-token`) for the new project's id. The
resulting snippet then shows up automatically in the per-project Live
Sync section below, since that new project is now selected — no separate
dialog step, no new route; this is the exact same chained-mutation
pattern already built once for this app's very first per-project sync
iteration.

### Projects page — per-project "Live Sync" section (brought back)

Same three-state section as the first superseded spec described,
reintroduced in the selected-project detail panel (admin-only):

- **No token yet:** "Set up live sync" button. In practice this only
  shows momentarily for a brand-new project (before the automatic
  generate call above resolves) or for a project that predates this
  feature.
- **Just generated (or just auto-generated on creation):** the raw token
  in a copy-able block, plus the full CLAUDE.md snippet (below) with that
  token filled in, and a "Copy snippet" button. Shown once.
- **Token exists:** "Live sync active — created/regenerated ... ago" plus
  a "Regenerate" button behind a confirm dialog, same pattern as before.

## Generated CLAUDE.md snippet

```markdown
## GoDevLab Hub — live sync

This project (`<project title>`) is registered with GoDevLab Hub. After
finishing each meaningful task, milestone, bug fix, or decision, post a
progress update:

\`\`\`bash
curl -s -X POST http://localhost:3000/api/sync/update \
  -H "Content-Type: application/json" \
  -d '{"token":"<TOKEN>","employee_email":"<your email>","title":"<short title>","details":"<1-3 sentences on what changed>","update_type":"progress"}'
\`\`\`

`employee_email` is optional but recommended when more than one person
works on this project — it attributes the update to you specifically
(unverified — just fill in your own GoDevLab Hub email). Omit it and
updates are attributed to whoever set up this project's sync.

Use `update_type`: `"progress"` (default), `"blocker"`, `"decision"`, or
`"note"`.

This requires the GoDevLab Hub dev server (`npm run dev`) running on this
laptop to receive updates.
```

## Testing

No automated test runner in this repo — manual verification:

- Create a new project via "New Project" — confirm the snippet panel
  appears immediately with a real token, and the project appears in the
  list.
- Run the snippet's curl command with `employee_email` set to a real
  employee's email — confirm the update appears in the timeline,
  attributed to that employee (not the token's creator, if different).
- Run it again with `employee_email` omitted — confirm the update is
  attributed to the token's creator (the admin who made the project).
- Run it with `employee_email` set to a non-existent email — confirm it
  still succeeds and falls back to the token's creator (no error).
- Run it with a bad token — confirm 401, nothing written.
- Regenerate a project's token from its detail page — confirm the old
  token now 401s, the new one works.
- Confirm a non-admin can't see the Live Sync section and gets 401/403
  hitting `/api/projects/sync-token` directly.
