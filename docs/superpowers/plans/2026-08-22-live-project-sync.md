# Live Project Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin generate a per-project token from GoDevLab Hub, paste a generated CLAUDE.md snippet into that project's own Claude Code session on the laptop, and have that session push live progress updates back into the Hub's existing project-updates timeline — without distributing any Supabase credentials into client projects.

**Architecture:** A new `project_sync_tokens` table stores only a SHA-256 hash of each project's token (never the raw value) behind admin-only RLS. Two new API routes: one admin-authenticated route to generate/regenerate a token and check its status, and one public route — authenticated purely by the token in the request body — that hashes the incoming token, looks up the owning project, and inserts a row into the existing `project_updates` table. No new timeline UI is needed since that table already renders as a timeline on the Projects page.

**Tech Stack:** Next.js 16 (App Router), TypeScript, `@supabase/supabase-js` (service-role client), Node's built-in `crypto` module, TanStack Query, existing shadcn-style `Dialog`/`Button`/`Textarea` components.

**Spec:** `docs/superpowers/specs/2026-08-22-live-project-sync-design.md`

## Global Constraints

- The raw sync token is never stored anywhere, client or server — only its SHA-256 hash, in `project_sync_tokens.token_hash`. It is returned to the browser exactly once, at generation/regeneration time.
- `project_sync_tokens` RLS is admin-only for all operations (SELECT/INSERT/UPDATE/DELETE), matching `project_credentials`'s pattern from the prior plan — the `projects` table itself has an open `USING(true)` SELECT policy, so anything sensitive must live in its own table.
- No automated test runner exists in this repo. Verification uses `npx tsc --noEmit`, `curl`, and manual browser checks.
- This repo has no linked Supabase CLI and the Supabase MCP connection lacks permission on project `izgrryarnsbkxmrffcio`. Any SQL against the live database must be run by the human operator in the Supabase SQL editor.
- The generated CLAUDE.md snippet's endpoint defaults to `http://localhost:3000` — the Hub is not deployed publicly; this is a known, accepted limitation (see spec's Non-goals), not a defect to fix in this plan.

---

### Task 1: Database migration — project_sync_tokens

**Files:**
- Create: `supabase/migrations/20260822_project_sync_tokens.sql`

**Interfaces:**
- Produces: table `project_sync_tokens(project_id, token_hash, created_by, created_at, regenerated_at)`, RLS-enabled, admin-only.

- [ ] **Step 1: Write the migration file**

```sql
CREATE TABLE IF NOT EXISTS project_sync_tokens (
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

This cannot be automated (see Global Constraints). Tell the human operator:
"Open the Supabase SQL editor for project `izgrryarnsbkxmrffcio`
(https://supabase.com/dashboard/project/izgrryarnsbkxmrffcio/sql/new),
paste in the contents of `supabase/migrations/20260822_project_sync_tokens.sql`,
and run it. Let me know when it's done."

Wait for confirmation before continuing to Step 3.

- [ ] **Step 3: Verify the migration applied**

Ask the human operator to run this and paste the result:

```sql
SELECT count(*) FROM information_schema.tables WHERE table_name = 'project_sync_tokens';
```

Expected: `1`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260822_project_sync_tokens.sql
git commit -m "feat: add project_sync_tokens table"
```

---

### Task 2: API routes and client query wrappers

**Files:**
- Create: `src/app/api/projects/sync-token/route.ts`
- Create: `src/app/api/sync/update/route.ts`
- Modify: `src/lib/supabase/queries.ts`

**Interfaces:**
- Consumes: `createClient` (server) from `src/lib/supabase/server.ts`, `createAdminClient` from `src/lib/supabase/admin.ts` (both already exist from the prior plan).
- Produces: `GET/POST /api/projects/sync-token`, `POST /api/sync/update`, and client wrappers `getSyncTokenStatus(projectId: string)`, `generateSyncToken(projectId: string)` in `queries.ts` — used by Task 3.

- [ ] **Step 1: Create the admin-authenticated management route**

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

- [ ] **Step 2: Create the public sync endpoint**

Create `src/app/api/sync/update/route.ts`:

```ts
import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const VALID_UPDATE_TYPES = ["progress", "note", "blocker", "decision"] as const;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    token?: string; title?: string; details?: string; update_type?: string;
  } | null;

  const { token, title, details, update_type } = body ?? {};
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

  const { error } = await admin.from("project_updates").insert({
    project_id: tokenRow.project_id,
    title: title.trim(),
    details: details?.trim() || "",
    update_type: updateType,
    created_by: tokenRow.created_by,
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
Expected: no errors.

- [ ] **Step 5: Verify the public sync endpoint rejects an invalid token**

Run: `curl -s -X POST http://localhost:3000/api/sync/update -H "Content-Type: application/json" -d '{"token":"gdl_sync_bogus","title":"test"}'`
Expected: `{"error":"Invalid token"}` with a 401 status. Confirm the status with:
`curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/sync/update -H "Content-Type: application/json" -d '{"token":"gdl_sync_bogus","title":"test"}'`
Expected: `401`

- [ ] **Step 6: Verify the admin-management route rejects unauthenticated requests**

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/projects/sync-token?projectId=00000000-0000-0000-0000-000000000000`
Expected: `401`

- [ ] **Step 7: Commit**

```bash
git add src/app/api/projects/sync-token/route.ts src/app/api/sync/update/route.ts src/lib/supabase/queries.ts
git commit -m "feat: add sync token API routes and client wrappers"
```

---

### Task 3: Projects page — Live Sync UI section

**Files:**
- Modify: `src/app/dashboard/projects/page.tsx`

**Interfaces:**
- Consumes: `getSyncTokenStatus`, `generateSyncToken` from `src/lib/supabase/queries.ts` (Task 2).
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

Find the top-level constant:

```ts
const selectCls = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
```

Add immediately after it:

```ts

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

- [ ] **Step 4: Add state for the sync UI**

Find:

```ts
  const [addingCred, setAddingCred] = useState(false);
  const [credService, setCredService] = useState("");
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
```

Replace with:

```ts
  const [addingCred, setAddingCred] = useState(false);
  const [credService, setCredService] = useState("");
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [syncToken, setSyncToken] = useState<string | null>(null);
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
```

- [ ] **Step 5: Reset the shown token when switching projects**

Find:

```ts
  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId) ?? null, [projects, selectedProjectId]);
  const { data: projectCredentials = [] } = useQuery({
    queryKey: ["project_credentials", selectedProjectId],
    queryFn: () => getProjectCredentials(supabase, selectedProjectId!),
    enabled: Boolean(selectedProjectId),
  });
```

Replace with:

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
```

- [ ] **Step 6: Add the generate/regenerate mutation**

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
    mutationFn: () => generateSyncToken(selectedProject!.id),
    onSuccess: (data) => {
      setSyncToken(data.token);
      setRegenerateDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["sync-token-status", selectedProjectId] });
    },
  });
```

- [ ] **Step 7: Render the Live Sync section**

Find the end of the credentials section (immediately after the closing of the credentials list `<div>`, right before the due-date/task-stats row):

```tsx
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
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
```

Replace with (adds the new section between the credentials `</div>` and the due-date row's opening `<div>`):

```tsx
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
                </div>

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
                        onClick={() => generateSyncTokenMutation.mutate()}
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
                                onClick={() => generateSyncTokenMutation.mutate()}
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

- [ ] **Step 8: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Manual smoke test as admin**

With the dev server running and logged in as an admin: open a project, click "Set up live sync", confirm the snippet panel appears with a real token filled in and "Copy snippet" works (paste somewhere to confirm). Refresh the page — confirm it now shows "Live sync active" instead of the setup button. Click "Regenerate", confirm the dialog appears, confirm regenerating updates the "regenerated ... ago" text.

- [ ] **Step 10: Commit**

```bash
git add src/app/dashboard/projects/page.tsx
git commit -m "feat: add Live Sync section to project detail view"
```

---

### Task 4: End-to-end verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1–3.

- [ ] **Step 1: Generate a fresh token and confirm it's only shown once**

As admin, on a test project, click "Set up live sync" (or "Regenerate" if
one already exists from Task 3's smoke test — either way this produces a
new raw token). **Copy the raw token value now and keep it at hand** —
it is never persisted anywhere and will not be shown again; Steps 2-4
below need this exact value. Refresh the page. Expected: the raw token is
not shown again — only the "Live sync active" status line.

- [ ] **Step 2: Confirm the curl command from the snippet actually posts an update**

Copy the snippet's curl command (with the real token filled in), replace `<short title>` and `<1-3 sentences...>` with real text, and run it from a terminal:

```bash
curl -s -X POST http://localhost:3000/api/sync/update \
  -H "Content-Type: application/json" \
  -d '{"token":"<the real token>","title":"Live sync test","details":"Verifying the sync endpoint end to end.","update_type":"progress"}'
```

Expected: `{"success":true}`. Then reload that project's page in the Hub and confirm "Live sync test" now appears in its updates timeline.

- [ ] **Step 3: Confirm a bad token is rejected and inserts nothing**

```bash
curl -s -X POST http://localhost:3000/api/sync/update -H "Content-Type: application/json" -d '{"token":"gdl_sync_wrong","title":"Should not appear"}'
```

Expected: 401, and "Should not appear" never shows up in any project's timeline.

- [ ] **Step 4: Confirm regenerating invalidates the old token**

On the same test project, click "Regenerate" again — this invalidates
the token captured in Step 1. Copy this newest raw token value too. Then
re-run the Step 2 curl command using the Step 1 token value (now stale).
Expected: 401 (old token no longer works). Re-run the same command with
this newest token value instead — expected: `{"success":true}`.

- [ ] **Step 5: Confirm the Live Sync section is admin-only**

Log in as a non-admin employee (the `qa-test@example.com` account from the prior plan's Task 6 works if it still exists, or create a new one). Open the same project.
Expected: no "Live Sync" section appears at all.

- [ ] **Step 6: Final type-check**

Run: `npx tsc --noEmit`
Expected: clean, no errors anywhere in the project.
