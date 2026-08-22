# Live project sync (token-based push updates)

> **Superseded 2026-08-22** by `2026-08-22-employee-sync-tokens-design.md`.
> The per-project `project_sync_tokens` table and the Projects page "Live
> Sync" section this spec describes were replaced by a per-employee token
> model. This document is kept for history only.

## Problem

GoDevLab Hub already has a pull-based sync mechanism (`scripts/sync.ts`,
`projects.config.json`, the `ReportJson` type) for pulling a
`report.json` file from each registered project's local folder. It's
manual to register a project, and it only ever stamps `last_synced_at` —
it doesn't carry real progress content into the Hub.

The owner wants: from inside the Hub, click something on a project and
get everything needed to paste into that project's own Claude Code
session on their laptop, so that as Claude works on that project (e.g.
`coachfio`), it pushes live progress updates back into the Hub — visible
as a running timeline on that project's page — without distributing the
Hub's actual Supabase credentials into every client project's folder.

## Non-goals

- Replacing or removing the existing `scripts/sync.ts` / `report.json`
  pull-based mechanism — it can stay; this is a separate, additive path.
- Deploying the Hub publicly. The generated instructions default to
  `http://localhost:3000`, since today everything runs locally on one
  laptop with `npm run dev`. If the Hub is later deployed, the base URL
  becomes configurable at generation time — not solved here.
- Rate limiting / abuse protection beyond basic input validation — this
  is a single-operator internal tool, not a public API.
- Editing or deleting individual synced updates differently from
  existing manual ones — synced updates land in `project_updates`, which
  already supports delete.

## Data model

### `project_sync_tokens` (new table)

```sql
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

Only the **hash** of the token is ever stored — same reasoning as
`project_credentials`: `projects` has an open `USING(true)` SELECT
policy, so anything sensitive needs its own table regardless. The raw
token is generated server-side, returned to the admin exactly once, and
never persisted anywhere. RLS on this table is defense-in-depth — the
client never actually queries it directly; both API routes below use the
service-role client, gated by their own admin checks.

`created_by` records which admin generated the token, and doubles as the
`created_by` value used when the sync endpoint later inserts into
`project_updates` (that column is `NOT NULL REFERENCES employees(id)`,
and a token-authenticated request has no employee session of its own).

## API routes

### `POST /api/projects/sync-token` — generate or regenerate

Admin-only (same pattern as `/api/employees/create`: verify the caller's
session via the cookie-aware server client, reject non-admins with 403).

Request: `{ projectId: string }`

1. Generate a random token: `` `gdl_sync_${crypto.randomBytes(32).toString("hex")}` ``.
2. Hash it: `crypto.createHash("sha256").update(token).digest("hex")`.
3. Upsert into `project_sync_tokens` (service-role client): if a row
   already exists for this `project_id`, update `token_hash` and set
   `regenerated_at = now()`; otherwise insert with `created_by` = the
   calling admin's id.
4. Return `{ token, projectId, projectTitle }` — the **raw** token, this
   is the only time it's ever sent back.

### `GET /api/projects/sync-token?projectId=...` — status only

Admin-only, same auth check. Returns
`{ exists: boolean, createdAt: string | null, regeneratedAt: string | null }`
— metadata only, never the hash. Used by the UI to decide whether to
show "Set up live sync" or "Regenerate".

### `POST /api/sync/update` — the public sync endpoint

No Supabase Auth session — authenticated purely by the token in the body.
This is what the *other* project's Claude session calls.

Request: `{ token: string; title: string; details?: string; update_type?: "progress" | "note" | "blocker" | "decision" }`

1. Reject if `token` or `title` missing/empty → 400.
2. Hash the incoming token, look up `project_sync_tokens` by
   `token_hash` (service-role client) → if no match, 401.
3. Insert into `project_updates` (service-role client):
   `{ project_id: <from token row>, title, details: details ?? null, update_type: update_type ?? "progress", created_by: <token row's created_by> }`.
4. Return `{ success: true }`.

No changes needed to `project_updates`' schema or its existing RLS —
synced rows are indistinguishable from manually-created ones once
inserted, and the existing timeline UI already renders whatever's in
that table.

## UI

**Projects page** (`src/app/dashboard/projects/page.tsx`), in the
selected-project detail panel, admin-only, as a new section (same visual
pattern as the existing "Logins & Passwords" section):

- **No token yet:** a "Set up live sync" button. Clicking it calls
  `POST /api/projects/sync-token`, then opens a panel showing the
  generated CLAUDE.md snippet (below) with the real token filled in, and
  a "Copy" button. A note makes clear this is the only time the token is
  shown.
- **Token exists:** shows when it was created/last regenerated (from the
  `GET` status endpoint), plus a "Regenerate" button. Regenerating opens
  the existing `Dialog` component (already imported in this file, used
  for the "New Project" flow) with a warning that the old token stops
  working immediately — any project still using it will start getting
  401s from `/api/sync/update` until updated with the new one — and a
  "Regenerate anyway" confirm button.

## Generated CLAUDE.md snippet

```markdown
## GoDevLab Hub — live sync

This project is registered with GoDevLab Hub (`<project title>`). After
finishing each meaningful task, milestone, bug fix, or decision, post a
progress update:

\`\`\`bash
curl -s -X POST http://localhost:3000/api/sync/update \
  -H "Content-Type: application/json" \
  -d '{"token":"<TOKEN>","title":"<short title>","details":"<1-3 sentences on what changed>","update_type":"progress"}'
\`\`\`

Use `update_type`: `"progress"` for normal work (default if omitted),
`"blocker"` when stuck, `"decision"` for a choice made, `"note"` for
anything else. Keep `title` to one line; `details` short.

This requires the GoDevLab Hub dev server (`npm run dev`) running on this
laptop to receive the update.
```

The `<TOKEN>` placeholder is filled with the real value before display;
`<project title>` with the actual project's title.

## Testing

No automated test runner in this repo (consistent with the rest of the
app) — manual verification:

- Generate a token for a project, confirm the raw value only appears
  once (page refresh shows "exists" state, not the value again).
- Run the generated curl command from a terminal — confirm a new row
  appears in that project's update timeline in the Hub UI.
- Run it with a garbage token — confirm 401, no row inserted.
- Regenerate — confirm the old token now gets 401, the new one works.
- Confirm a non-admin employee doesn't see the "Set up live sync"
  section at all (client-side gate, same pattern as credentials/team
  assignment UI elsewhere in this app).
