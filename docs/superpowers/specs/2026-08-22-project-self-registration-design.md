# Project self-registration (global token)

> **Superseded 2026-08-22** by `2026-08-22-employee-sync-tokens-design.md`,
> before any code from this spec was written. The single global
> `hub_registration_token` and Settings-page idea here were folded into
> the per-employee token model instead. This document is kept for
> history only.

## Problem

Live project sync (previous plan) requires a project to already exist in
the Hub and an admin to click "Set up live sync" from the browser. The
owner wants the whole "New Project" form filled out manually — that's
still friction. The goal: Claude, working locally in any project
(existing or brand new, e.g. `coachfio`), should be able to register that
project with the Hub and start posting live updates entirely on its own —
no admin browser session, no manual form.

## Non-goals

- Removing the existing "New Project" dialog or manual per-project "Set
  up live sync" button — both stay for cases where the owner wants to
  create/manage a project by hand.
- Any UI for editing Hub-wide settings beyond the one registration
  token — YAGNI; add more to the Settings page only when something else
  actually needs it.
- Automatically discovering/scanning the filesystem for projects to
  register — registration is always initiated by a Claude session
  actually working inside that project, per the CLAUDE.md convention
  below, not by the Hub reaching out.

## Data model

### `hub_registration_token` (new table, singleton)

```sql
CREATE TABLE hub_registration_token (
  id             BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  token_hash     TEXT NOT NULL,
  created_by     UUID NOT NULL REFERENCES employees(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  regenerated_at TIMESTAMPTZ
);

ALTER TABLE hub_registration_token ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_registration_token_admin_only" ON hub_registration_token
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));
```

`BOOLEAN PRIMARY KEY DEFAULT true CHECK (id)` is the standard Postgres
singleton-table trick — a second row would violate both the primary key
(only one `true` value possible) and the check. Same hash-only storage
principle as `project_sync_tokens`: the raw token is never persisted,
only returned once at generation/regeneration time.

Losing this token only blocks registering *new* projects until it's
regenerated — it has no effect on already-registered projects, which use
their own project-specific `project_sync_tokens` saved locally per the
convention below.

## API routes

### `GET /api/settings/registration-token` — status only

Admin-only (same session-check pattern as the other admin routes).
Returns `{ exists: boolean, createdAt: string | null, regeneratedAt: string | null }`.

### `POST /api/settings/registration-token` — generate or regenerate

Admin-only. Same upsert-by-singleton logic as the per-project sync-token
route, but against `hub_registration_token` (no `project_id` to key on —
just check whether the one row exists). Returns `{ token: string }` — the
raw value, shown once.

### `POST /api/projects/register` — the public registration endpoint

No Supabase Auth session — authenticated by the registration token in the
body, same hash-and-lookup pattern as `/api/sync/update`.

Request:
```ts
{
  registrationToken: string;
  title: string;
  slug?: string;
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

1. Reject if `registrationToken` or `title` missing → 400.
2. Hash the token, look up `hub_registration_token` by `token_hash` → if
   no match, 401. The matched row's `created_by` becomes the `created_by`
   for both the new project and its sync token (same attribution pattern
   already used for per-project sync tokens).
3. Insert into `projects` (service-role client) — `slug` defaults to a
   slugified `title` if omitted, same logic already used by the "New
   Project" form (`title.toLowerCase().replace(/\s+/g, "-")`).
4. Generate a fresh per-project sync token exactly like
   `POST /api/projects/sync-token` already does (same `gdl_sync_` prefix,
   same SHA-256 hashing, insert into `project_sync_tokens`).
5. Return `{ project: <the created project row>, token: <raw per-project token> }`.

No changes needed to `projects` or `project_sync_tokens` schemas — this
route just orchestrates two inserts that already exist as patterns
elsewhere in the codebase.

## UI

### New Settings page (`/dashboard/settings`)

Added to the sidebar's "Operations" section (`src/components/sidebar.tsx`),
admin-only content (matches the existing convention: page renders for
everyone, but shows "Admin access required" for non-admins rather than a
route-level redirect, since no route-guard mechanism exists elsewhere in
this app either).

One section, "Project Registration," with the exact same three-state UI
pattern as the per-project Live Sync section (reused visually, not as a
shared component — YAGNI, it's one small block):
- **No token yet:** "Generate registration token" button.
- **Just generated:** the raw token in a copy-able block, plus the full
  `~/.claude/CLAUDE.md` snippet (below) with that token filled in, and a
  "Copy snippet" button. Shown once.
- **Token exists:** "Registration active — created/regenerated ... ago"
  plus a "Regenerate" button behind the same confirm-dialog pattern as
  per-project regeneration, with a warning that regenerating does NOT
  affect already-registered projects, only blocks new registrations
  until the new token is distributed.

## Generated `~/.claude/CLAUDE.md` snippet

```markdown
## GoDevLab Hub — project registration & live sync

At the start of a session in any project on this laptop, check whether
`.claude/hub-sync-token` exists in that project's root.

- If it exists: read the token from that file and use it for live-sync
  updates (see below) — skip registration.
- If it does not exist and this project is worth tracking in GoDevLab
  Hub, register it once:

\`\`\`bash
curl -s -X POST http://localhost:3000/api/projects/register \
  -H "Content-Type: application/json" \
  -d '{"registrationToken":"<TOKEN>","title":"<project name>","description":"<one-line description>","stack":["..."],"repo_path":"<absolute path to this project>"}'
\`\`\`

This returns `{"project": {...}, "token": "<new per-project token>"}`.
Save that `token` value to `.claude/hub-sync-token` in the project root
(create the `.claude` directory if it doesn't exist) so future sessions
skip registration.

Then, after finishing each meaningful task, milestone, bug fix, or
decision, post a progress update using the per-project token from that
file:

\`\`\`bash
curl -s -X POST http://localhost:3000/api/sync/update \
  -H "Content-Type: application/json" \
  -d '{"token":"<token from .claude/hub-sync-token>","title":"<short title>","details":"<1-3 sentences>","update_type":"progress"}'
\`\`\`

This requires the GoDevLab Hub dev server (`npm run dev`) running on this
laptop to receive updates.
```

The `<TOKEN>` placeholder is filled with the real registration token
value before display.

## Testing

No automated test runner in this repo — manual verification:

- Generate the registration token from Settings, confirm it's shown only
  once (refresh shows "active" status, not the value again).
- Run the register curl command with a fresh title/description — confirm
  a new project appears in the Hub's project list, and the response
  includes a working per-project `token`.
- Run the same command with a bad `registrationToken` — confirm 401, no
  project created.
- Use the returned per-project token against `/api/sync/update` — confirm
  it posts to the new project's timeline (this reuses the existing,
  already-verified sync endpoint from the prior plan — the two must issue
  compatible token formats/hashing, which they do since registration
  reuses the identical generation logic).
- Confirm a non-admin can't see the Settings page's token section or hit
  either admin-only settings route successfully.
