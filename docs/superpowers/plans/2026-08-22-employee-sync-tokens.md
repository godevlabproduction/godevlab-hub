# Employee Sync Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-project sync token mechanism (shipped, unused —
`project_sync_tokens` has zero rows) with one personal sync token per
employee, usable across every project. Add project self-registration
(find-or-create by slug) authenticated by that same token, so Claude
working in any project — new or existing — can register it and push
progress updates with zero admin browser interaction and correct
per-person attribution when multiple people work in parallel.

**Architecture:** `project_sync_tokens` is dropped and replaced by
`employee_sync_tokens` (one row per employee, hash-only token storage,
admin-only RLS — same security posture as before, just keyed
differently). The Projects page's project-scoped "Live Sync" section is
removed; a new per-employee "Live Sync" control is added to the Team
page. `POST /api/projects/register` (new) and `POST /api/sync/update`
(rewritten) are both authenticated purely by hashing the employee token
in the request body — no Supabase Auth session, matching the existing
pattern from `/api/sync/update`'s first version.

**Tech Stack:** Next.js 16 (App Router), TypeScript, `@supabase/supabase-js`
(service-role client), Node's `crypto` module, TanStack Query, existing
shadcn-style `Dialog`/`Button`/`Textarea` components.

**Spec:** `docs/superpowers/specs/2026-08-22-employee-sync-tokens-design.md`

## Global Constraints

- The raw sync token is never stored anywhere, client or server — only
  its SHA-256 hash, in `employee_sync_tokens.token_hash`. Returned to the
  browser exactly once, at generation/regeneration time.
- `employee_sync_tokens` RLS is admin-only for all operations, matching
  the pattern already used by `project_credentials` and (formerly)
  `project_sync_tokens`.
- No automated test runner exists in this repo. Verification uses
  `npx tsc --noEmit`, `curl`, and manual browser checks.
- This repo has no linked Supabase CLI and the Supabase MCP connection
  lacks permission on project `izgrryarnsbkxmrffcio`. Any SQL against the
  live database must be run by the human operator in the Supabase SQL
  editor.
- `project_sync_tokens` is confirmed to have zero rows (checked live
  before writing this plan) — dropping it loses no real data, only
  unused test-verification artifacts.
- `POST /api/projects/register` is find-or-create by `slug` — on a repeat
  call for an existing slug, the existing project row is returned as-is;
  no field on that row is updated from the request body. Do not add
  update-on-conflict behavior — that's explicitly out of scope per the
  spec's Non-goals.

---

### Task 1: Database migration — employee_sync_tokens

**Files:**
- Create: `supabase/migrations/20260822_employee_sync_tokens.sql`

**Interfaces:**
- Produces: table `employee_sync_tokens(employee_id, token_hash, created_by, created_at, regenerated_at)`, RLS-enabled, admin-only. `project_sync_tokens` no longer exists after this migration.

- [ ] **Step 1: Write the migration file**

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

- [ ] **Step 2: Human operator runs the migration**

Tell the human operator: "Open the Supabase SQL editor for project
`izgrryarnsbkxmrffcio` (https://supabase.com/dashboard/project/izgrryarnsbkxmrffcio/sql/new),
paste in the contents of `supabase/migrations/20260822_employee_sync_tokens.sql`,
and run it. Let me know when it's done."

Wait for confirmation before continuing.

- [ ] **Step 3: Verify the migration applied**

Ask the human operator to run this and paste the result:

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'employee_sync_tokens') AS has_employee_sync_tokens,
  (SELECT count(*) FROM information_schema.tables WHERE table_name = 'project_sync_tokens') AS old_table_still_exists;
```

Expected: `has_employee_sync_tokens = 1`, `old_table_still_exists = 0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260822_employee_sync_tokens.sql
git commit -m "feat: replace project_sync_tokens with employee_sync_tokens"
```

---

### Task 2: Remove the obsolete project-scoped sync code

**Files:**
- Delete: `src/app/api/projects/sync-token/route.ts`
- Modify: `src/lib/supabase/queries.ts`
- Modify: `src/app/dashboard/projects/page.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: a codebase with no references to `getSyncTokenStatus`,
  `generateSyncToken`, or the removed route — Task 3 introduces the
  employee-scoped replacements under different names, so there's no
  naming collision to worry about.

- [ ] **Step 1: Delete the old route file**

```bash
rm src/app/api/projects/sync-token/route.ts
```

- [ ] **Step 2: Remove the old query wrappers**

Find, at the end of `src/lib/supabase/queries.ts`:

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

Delete both functions entirely (remove these lines from the file).

- [ ] **Step 3: Remove the sync-related imports from the Projects page**

Find:

```ts
import { CalendarDays, CheckSquare2, Copy, ExternalLink, Eye, EyeOff, FolderKanban, KeyRound, Link2, ListTodo, PlusCircle, Radio, RefreshCw, Trash2, X } from "lucide-react";
```

Replace with:

```ts
import { CalendarDays, CheckSquare2, Copy, ExternalLink, Eye, EyeOff, FolderKanban, KeyRound, Link2, ListTodo, PlusCircle, Trash2, X } from "lucide-react";
```

Find:

```ts
import {
  getProjects, getAllProjectTasks, getProjectUpdates,
  createProject, updateProject, createProjectTask, updateProjectTask,
  deleteProjectTask, createProjectUpdate, deleteProjectUpdate,
  getProjectCredentials, createProjectCredential, deleteProjectCredential,
  getSyncTokenStatus, generateSyncToken,
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

- [ ] **Step 4: Remove the `buildSyncSnippet` helper**

Find:

```ts
const selectCls = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function buildSyncSnippet(projectTitle: string, token: string): string {
  return `## GoDevLab Hub — live sync

This project is registered with GoDevLab Hub (\`${projectTitle}\`). After finishing each meaningful task, milestone, bug fix, or decision, post a progress update:

\`\`\`bash
curl -s -X POST http://localhost:3000/api/sync/update \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${token}","title":"<short title>","details":"<1-3 sentences on what changed>","update_type":"progress"}'
\`\`\`

Use \`update_type\`: \`"progress"\` for normal work (default if omitted), \`"blocker"\` when stuck, \`"decision"\` for a choice made, \`"note"\` for anything else. Keep \`title\` to one line; \`details\` short.

This requires the GoDevLab Hub dev server (\`npm run dev\`) running on this laptop to receive the update.`;
}
```

Replace with:

```ts
const selectCls = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
```

- [ ] **Step 5: Remove sync-related state and effect**

Find:

```ts
  const [addingCred, setAddingCred] = useState(false);
  const [credService, setCredService] = useState("");
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [syncToken, setSyncToken] = useState<string | null>(null);
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
```

Replace with:

```ts
  const [addingCred, setAddingCred] = useState(false);
  const [credService, setCredService] = useState("");
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
```

Find:

```ts
  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId) ?? null, [projects, selectedProjectId]);
  const { data: projectCredentials = [] } = useQuery({
    queryKey: ["project_credentials", selectedProjectId],
    queryFn: () => getProjectCredentials(supabase, selectedProjectId!),
    enabled: Boolean(selectedProjectId),
  });
  const isAdmin = employee?.role === "admin";
  const { data: syncStatus } = useQuery({
    queryKey: ["sync-token-status", selectedProjectId],
    queryFn: () => getSyncTokenStatus(selectedProjectId!),
    enabled: Boolean(selectedProjectId) && isAdmin,
  });
  useEffect(() => {
    setSyncToken(null);
  }, [selectedProjectId]);
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
  const selectedTasks = useMemo(() => allTasks.filter(t => t.project_id === selectedProjectId), [allTasks, selectedProjectId]);
```

- [ ] **Step 6: Revert the auto-sync-on-create hookup**

Find:

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

Replace with:

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

- [ ] **Step 7: Remove the generate/regenerate mutation**

Find:

```ts
  const deleteCredentialMutation = useMutation({
    mutationFn: (credentialId: string) => deleteProjectCredential(supabase, credentialId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project_credentials", selectedProjectId] }),
  });
  const generateSyncTokenMutation = useMutation({
    mutationFn: (projectId?: string) => generateSyncToken(projectId ?? selectedProject!.id),
    onSuccess: (data) => {
      setSyncToken(data.token);
      setRegenerateDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["sync-token-status", selectedProjectId] });
    },
  });
```

Replace with:

```ts
  const deleteCredentialMutation = useMutation({
    mutationFn: (credentialId: string) => deleteProjectCredential(supabase, credentialId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project_credentials", selectedProjectId] }),
  });
```

- [ ] **Step 8: Remove the Live Sync section from the render**

Find:

```tsx
                {isAdmin && (
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
                )}

                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
```

Replace with:

```tsx
                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
```

- [ ] **Step 9: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add -u src/app/api/projects/sync-token/route.ts src/lib/supabase/queries.ts src/app/dashboard/projects/page.tsx
git commit -m "chore: remove obsolete project-scoped sync token code"
```

(`git add -u` picks up the deletion; the modified files are staged the
normal way alongside it.)

---

### Task 3: New backend — employee tokens, registration, rewritten sync endpoint

**Files:**
- Create: `src/app/api/employees/sync-token/route.ts`
- Create: `src/app/api/projects/register/route.ts`
- Modify: `src/app/api/sync/update/route.ts` (full rewrite)
- Modify: `src/lib/supabase/queries.ts`

**Interfaces:**
- Consumes: `createClient` (server) from `src/lib/supabase/server.ts`, `createAdminClient` from `src/lib/supabase/admin.ts` (both already exist).
- Produces: `GET/POST /api/employees/sync-token`, `POST /api/projects/register`, rewritten `POST /api/sync/update`, and client wrappers `getEmployeeSyncTokenStatus(employeeId)`, `generateEmployeeSyncToken(employeeId)` in `queries.ts` — used by Task 4.

- [ ] **Step 1: Create the admin-authenticated employee token route**

Create `src/app/api/employees/sync-token/route.ts`:

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
  const employeeId = searchParams.get("employeeId");
  if (!employeeId) {
    return NextResponse.json({ error: "Missing employeeId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("employee_sync_tokens")
    .select("created_at, regenerated_at")
    .eq("employee_id", employeeId)
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

  const body = await request.json().catch(() => null) as { employeeId?: string } | null;
  const employeeId = body?.employeeId;
  if (!employeeId) {
    return NextResponse.json({ error: "Missing employeeId" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: targetEmployee } = await admin.from("employees").select("full_name").eq("id", employeeId).single();
  if (!targetEmployee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const token = `gdl_sync_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { data: existing } = await admin
    .from("employee_sync_tokens")
    .select("employee_id")
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("employee_sync_tokens")
      .update({ token_hash: tokenHash, regenerated_at: new Date().toISOString() })
      .eq("employee_id", employeeId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { error } = await admin
      .from("employee_sync_tokens")
      .insert({ employee_id: employeeId, token_hash: tokenHash, created_by: auth.userId });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ token, employeeId, employeeName: targetEmployee.full_name });
}
```

- [ ] **Step 2: Create the project registration endpoint**

Create `src/app/api/projects/register/route.ts`:

```ts
import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    token?: string; slug?: string; title?: string; client_name?: string;
    description?: string; status?: string; priority?: string; due_date?: string;
    repo_path?: string; repo_url?: string; stack?: string[];
  } | null;

  const { token, slug, title } = body ?? {};
  if (!token || !slug?.trim() || !title?.trim()) {
    return NextResponse.json({ error: "Missing token, slug, or title" }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const admin = createAdminClient();

  const { data: tokenRow } = await admin
    .from("employee_sync_tokens")
    .select("employee_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!tokenRow) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { data: existingProject } = await admin
    .from("projects")
    .select("*")
    .eq("slug", slug.trim())
    .maybeSingle();

  if (existingProject) {
    return NextResponse.json({ project: existingProject });
  }

  const { data: created, error } = await admin
    .from("projects")
    .insert({
      slug: slug.trim(),
      title: title.trim(),
      client_name: body?.client_name ?? null,
      description: body?.description ?? null,
      status: body?.status ?? "active",
      priority: body?.priority ?? "medium",
      due_date: body?.due_date ?? null,
      repo_path: body?.repo_path ?? null,
      repo_url: body?.repo_url ?? null,
      stack: body?.stack ?? [],
      created_by: tokenRow.employee_id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ project: created });
}
```

- [ ] **Step 3: Rewrite the sync update endpoint**

Replace the entire contents of `src/app/api/sync/update/route.ts` with:

```ts
import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const VALID_UPDATE_TYPES = ["progress", "note", "blocker", "decision"] as const;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    token?: string; project_id?: string; title?: string; details?: string; update_type?: string;
  } | null;

  const { token, project_id, title, details, update_type } = body ?? {};
  if (!token || !project_id || !title?.trim()) {
    return NextResponse.json({ error: "Missing token, project_id, or title" }, { status: 400 });
  }
  const updateType = VALID_UPDATE_TYPES.includes(update_type as typeof VALID_UPDATE_TYPES[number])
    ? (update_type as typeof VALID_UPDATE_TYPES[number])
    : "progress";

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const admin = createAdminClient();

  const { data: tokenRow } = await admin
    .from("employee_sync_tokens")
    .select("employee_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!tokenRow) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { error } = await admin.from("project_updates").insert({
    project_id,
    title: title.trim(),
    details: details?.trim() || "",
    update_type: updateType,
    created_by: tokenRow.employee_id,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 4: Add the client query wrappers**

Append to the end of `src/lib/supabase/queries.ts`:

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

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Verify the auth-rejection paths**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/employees/sync-token?employeeId=00000000-0000-0000-0000-000000000000
```
Expected: `401`

```bash
curl -s -X POST http://localhost:3000/api/projects/register -H "Content-Type: application/json" -d '{"token":"gdl_sync_bogus","slug":"test","title":"Test"}'
```
Expected: `{"error":"Invalid token"}`, status `401`.

```bash
curl -s -X POST http://localhost:3000/api/sync/update -H "Content-Type: application/json" -d '{"token":"gdl_sync_bogus","project_id":"00000000-0000-0000-0000-000000000000","title":"test"}'
```
Expected: `{"error":"Invalid token"}`, status `401`.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/employees/sync-token/route.ts src/app/api/projects/register/route.ts src/app/api/sync/update/route.ts src/lib/supabase/queries.ts
git commit -m "feat: add employee sync tokens, project registration, rewrite sync endpoint"
```

---

### Task 4: Team page — per-employee Live Sync section

**Files:**
- Modify: `src/app/dashboard/employees/page.tsx`

**Interfaces:**
- Consumes: `getEmployeeSyncTokenStatus`, `generateEmployeeSyncToken` from `src/lib/supabase/queries.ts` (Task 3).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add icon and query imports**

Find:

```ts
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
```

Replace with:

```ts
import { format, formatDistanceToNow } from "date-fns";
import { Users, PlusCircle, X, Radio, RefreshCw, Copy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getEmployees, createEmployee, getProjects,
  getProjectAssignments, assignEmployeeToProject, unassignEmployeeFromProject,
  getEmployeeSyncTokenStatus, generateEmployeeSyncToken,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { EmployeeRole } from "@/types";
```

Note: this file already imports `format` from `date-fns` — find that
existing import line too:

```ts
import { format } from "date-fns";
```

Delete that separate line entirely (it's now covered by the combined
`format, formatDistanceToNow` import above — don't end up with two
`date-fns` imports).

- [ ] **Step 2: Add the snippet-builder helper**

Find:

```ts
const roleStyles: Record<string, string> = {
  admin: "border-brand-300 bg-brand-50 text-brand-700",
  member: "border-gray-200 bg-gray-100 text-gray-600",
};
```

Add immediately after it:

```ts

function buildEmployeeSyncSnippet(employeeName: string, token: string): string {
  return `## GoDevLab Hub — live sync

This is your personal GoDevLab Hub sync token (\`${employeeName}\`). It works across every project on this laptop — nothing project-specific to set up.

At the start of a session in any project worth tracking in the Hub, first make sure it's registered (safe to call every session — it's find-or-create by slug, so it never duplicates):

\`\`\`bash
curl -s -X POST http://localhost:3000/api/projects/register \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${token}","slug":"<short-project-slug>","title":"<project name>","description":"<one-line description>","stack":["..."],"repo_path":"<absolute path to this project>"}'
\`\`\`

This returns \`{"project": {"id": "...", ...}}\` — note the \`id\`, you need it for updates below (just remember it for the rest of this session).

After finishing each meaningful task, milestone, bug fix, or decision, post a progress update:

\`\`\`bash
curl -s -X POST http://localhost:3000/api/sync/update \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${token}","project_id":"<id from above>","title":"<short title>","details":"<1-3 sentences on what changed>","update_type":"progress"}'
\`\`\`

Use \`update_type\`: \`"progress"\` (default), \`"blocker"\`, \`"decision"\`, or \`"note"\`.

This requires the GoDevLab Hub dev server (\`npm run dev\`) running on this laptop to receive updates.`;
}
```

- [ ] **Step 3: Add per-employee sync state, query, and mutation**

Find:

```ts
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
```

Replace with:

```ts
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [syncTokens, setSyncTokens] = useState<Record<string, string>>({});
  const [regenerateDialogEmployeeId, setRegenerateDialogEmployeeId] = useState<string | null>(null);
  const [copiedSnippetFor, setCopiedSnippetFor] = useState<string | null>(null);
```

Find:

```ts
  const unassignMutation = useMutation({
    mutationFn: ({ projectId, employeeId }: { projectId: string; employeeId: string }) =>
      unassignEmployeeFromProject(supabase, projectId, employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project_assignments"] });
      setAssignError(null);
    },
    onError: (err: Error) => setAssignError(err.message),
  });
```

Add immediately after it:

```ts
  const generateEmployeeSyncTokenMutation = useMutation({
    mutationFn: (employeeId: string) => generateEmployeeSyncToken(employeeId),
    onSuccess: (data) => {
      setSyncTokens(t => ({ ...t, [data.employeeId]: data.token }));
      setRegenerateDialogEmployeeId(null);
      queryClient.invalidateQueries({ queryKey: ["employee-sync-status", data.employeeId] });
    },
  });

  function copySnippet(employeeId: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedSnippetFor(employeeId);
    setTimeout(() => setCopiedSnippetFor(null), 1500);
  }
```

- [ ] **Step 4: Render the per-employee Live Sync section**

Find:

```tsx
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
```

Replace with:

```tsx
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
                {isAdmin && (
                  <EmployeeSyncSection
                    employeeId={emp.id}
                    employeeName={emp.full_name}
                    generateMutation={generateEmployeeSyncTokenMutation}
                    syncToken={syncTokens[emp.id] ?? null}
                    regenerateDialogOpen={regenerateDialogEmployeeId === emp.id}
                    onOpenRegenerateDialog={() => setRegenerateDialogEmployeeId(emp.id)}
                    onCloseRegenerateDialog={() => setRegenerateDialogEmployeeId(null)}
                    copiedSnippet={copiedSnippetFor === emp.id}
                    onCopySnippet={text => copySnippet(emp.id, text)}
                  />
                )}
              </CardContent>
```

- [ ] **Step 5: Add the `EmployeeSyncSection` component**

Find the end of the file:

```tsx
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

Replace with (adds a new component after the page's closing brace):

```tsx
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

function EmployeeSyncSection({
  employeeId,
  employeeName,
  generateMutation,
  syncToken,
  regenerateDialogOpen,
  onOpenRegenerateDialog,
  onCloseRegenerateDialog,
  copiedSnippet,
  onCopySnippet,
}: {
  employeeId: string;
  employeeName: string;
  generateMutation: ReturnType<typeof useMutation<{ token: string; employeeId: string; employeeName: string }, Error, string>>;
  syncToken: string | null;
  regenerateDialogOpen: boolean;
  onOpenRegenerateDialog: () => void;
  onCloseRegenerateDialog: () => void;
  copiedSnippet: boolean;
  onCopySnippet: (text: string) => void;
}) {
  const { data: syncStatus } = useQuery({
    queryKey: ["employee-sync-status", employeeId],
    queryFn: () => getEmployeeSyncTokenStatus(employeeId),
  });

  return (
    <div className="mt-3 border-t pt-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
        <Radio className="h-3.5 w-3.5 text-brand-700" />
        Live Sync
      </div>
      {!syncStatus?.exists && !syncToken && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => generateMutation.mutate(employeeId)}
          disabled={generateMutation.isPending}
        >
          {generateMutation.isPending ? "Setting up..." : "Set up sync"}
        </Button>
      )}
      {syncToken && (
        <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-muted-foreground">
            Paste this into your <code>~/.claude/CLAUDE.md</code>. This token is shown only once — copy it now.
          </p>
          <Textarea readOnly rows={8} value={buildEmployeeSyncSnippet(employeeName, syncToken)} className="font-mono text-xs" />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onCopySnippet(buildEmployeeSyncSnippet(employeeName, syncToken))}
          >
            {copiedSnippet ? <span className="text-xs text-green-600">Copied</span> : <><Copy className="mr-1.5 h-3.5 w-3.5" />Copy snippet</>}
          </Button>
        </div>
      )}
      {syncStatus?.exists && !syncToken && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            Sync active — {syncStatus.regeneratedAt
              ? `regenerated ${formatDistanceToNow(new Date(syncStatus.regeneratedAt), { addSuffix: true })}`
              : `set up ${formatDistanceToNow(new Date(syncStatus.createdAt!), { addSuffix: true })}`}
          </span>
          <Dialog open={regenerateDialogOpen} onOpenChange={open => (open ? onOpenRegenerateDialog() : onCloseRegenerateDialog())}>
            <DialogTrigger className={cn(buttonVariants(), "h-7 px-2.5 text-xs bg-white border border-gray-200 text-gray-700 hover:bg-gray-50")}>
              <RefreshCw className="mr-1 h-3 w-3 inline" />Regenerate
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Regenerate sync token?</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">
                The current token will stop working immediately. Any project sync calls using it will get rejected (401) until updated with the new one.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onCloseRegenerateDialog}>Cancel</Button>
                <Button
                  type="button"
                  className="bg-red-600 hover:bg-red-700"
                  onClick={() => generateMutation.mutate(employeeId)}
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending ? "Regenerating..." : "Regenerate anyway"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual smoke test as admin**

With the dev server running and logged in as an admin: open the Team
page, click "Set up sync" on an employee card, confirm the snippet panel
appears with a real token and "Copy snippet" works. Refresh — confirm it
now shows "Sync active" instead of the setup button. Click "Regenerate",
confirm the dialog appears and works.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard/employees/page.tsx
git commit -m "feat: add per-employee Live Sync section to Team page"
```

---

### Task 5: End-to-end verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1–4.

- [ ] **Step 1: Generate a token and confirm it's shown only once**

As admin, on the Team page, generate a sync token for an employee.
**Copy the raw token value now and keep it at hand** — it is never
persisted and Steps 2-5 below need it. Refresh the page. Expected: the
raw token is not shown again — only "Sync active."

- [ ] **Step 2: Register a new project**

```bash
curl -s -X POST http://localhost:3000/api/projects/register \
  -H "Content-Type: application/json" \
  -d '{"token":"<the token from Step 1>","slug":"e2e-test-project","title":"E2E Test Project","description":"Verifying self-registration.","stack":["Test"]}'
```

Expected: `{"project": {"id": "...", "slug": "e2e-test-project", ...}}`.
**Note the returned `project.id`** — Steps 3-4 need it. Reload the Hub's
Projects page and confirm "E2E Test Project" now appears in the list.

- [ ] **Step 3: Confirm registration is idempotent (find, not create)**

Re-run the exact same curl command from Step 2, unchanged.
Expected: the response's `project.id` is identical to Step 2's — no
second project was created. Confirm the Projects page still shows only
one "E2E Test Project."

- [ ] **Step 4: Post a sync update and confirm attribution**

```bash
curl -s -X POST http://localhost:3000/api/sync/update \
  -H "Content-Type: application/json" \
  -d '{"token":"<the token from Step 1>","project_id":"<project.id from Step 2>","title":"Live sync test","details":"Verifying employee-attributed sync end to end.","update_type":"progress"}'
```

Expected: `{"success":true}`. Reload "E2E Test Project" in the Hub and
confirm "Live sync test" appears in its updates timeline, attributed to
the employee whose token was used in Step 1 (not necessarily the admin
who generated it, if they're different people).

- [ ] **Step 5: Confirm bad tokens are rejected everywhere**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/projects/register -H "Content-Type: application/json" -d '{"token":"gdl_sync_wrong","slug":"should-not-exist","title":"Should Not Exist"}'
```
Expected: `401`. Confirm no "Should Not Exist" project appears anywhere.

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/sync/update -H "Content-Type: application/json" -d '{"token":"gdl_sync_wrong","project_id":"<project.id from Step 2>","title":"Should not appear"}'
```
Expected: `401`. Confirm "Should not appear" never shows up in the timeline.

- [ ] **Step 6: Confirm regenerating invalidates the old token**

On the Team page, regenerate the same employee's token from Step 1. Copy
this new raw value. Re-run Step 4's curl command with the Step 1 (now
stale) token value — expected: `401`. Re-run with the new token value —
expected: `{"success":true}`.

- [ ] **Step 7: Confirm the Live Sync UI is admin-only**

Log in as a non-admin employee (`qa-test@example.com` from an earlier
plan's verification, if it still exists, or create one). Open the Team
page. Expected: no "Live Sync" section appears on any employee card, and
direct calls to `/api/employees/sync-token` (with that employee's session
cookie) return 403.

- [ ] **Step 8: Final type-check**

Run: `npx tsc --noEmit`
Expected: clean, no errors anywhere in the project.
