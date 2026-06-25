# GoDevLab Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone internal agency dashboard for GoDevLab — project tracking, tasks, activity logs, notes, and Claude-automated report syncing — deployed on Vercel.

**Architecture:** Next.js App Router app with Supabase (auth + database). Each client project repo has a `report/report.json` that Claude maintains; a `scripts/sync.ts` copies those JSONs into the hub's `data/projects/` folder before each push. UI is modeled directly on the existing gogevgelija dashboard GoDevLab section (`Desktop/work/gogevgelija/dashboard/src/app/dashboard/godevlab/`).

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS, shadcn/ui, @tanstack/react-query, Supabase (auth + postgres), date-fns, lucide-react, ts-node

## Global Constraints

- Working directory: `/Users/filipmicevski/Desktop/GoDevLab/`
- Reference UI (copy patterns, not code verbatim): `/Users/filipmicevski/Desktop/work/gogevgelija/dashboard/src/app/dashboard/godevlab/`
- No git commands — developer handles all version control
- brand color: use `#2563eb` (blue-600) as brand-700 equivalent — configure in tailwind
- All Supabase calls use SSR pattern: `@supabase/ssr` with server + client helpers
- No public signup — Supabase dashboard: disable "Allow new users to sign up" after seeding users
- App lives at `/dashboard` after login; `/` redirects to `/dashboard`

---

## File Map

```
GoDevLab/
├── projects.config.json               # project slug → local path registry
├── data/projects/                     # synced report JSONs (git-tracked)
│   └── svadba.json
├── scripts/
│   └── sync.ts                        # pulls report.json from each project into data/projects/
├── supabase/
│   └── schema.sql                     # full DB schema + RLS
├── src/
│   ├── middleware.ts                  # Supabase session refresh + auth guard
│   ├── app/
│   │   ├── layout.tsx                 # root layout (fonts, globals)
│   │   ├── page.tsx                   # redirects to /dashboard
│   │   ├── login/
│   │   │   └── page.tsx              # email/password login form
│   │   └── dashboard/
│   │       ├── layout.tsx            # sidebar + content shell
│   │       ├── page.tsx              # overview (stat cards, activity, deadlines)
│   │       ├── projects/
│   │       │   └── page.tsx          # project list + selected project detail
│   │       └── notes/
│   │           └── page.tsx          # global + per-project notes
│   ├── components/
│   │   ├── sidebar.tsx               # nav sidebar with sign-out
│   │   ├── stat-card.tsx             # reusable stat card
│   │   └── ui/                       # shadcn components (button, card, badge, dialog, input, textarea, separator, tabs, tooltip, dropdown-menu, avatar)
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts             # browser Supabase client
│   │   │   ├── server.ts             # server Supabase client
│   │   │   └── queries.ts            # all DB query functions
│   │   └── utils.ts                  # cn() helper
│   ├── hooks/
│   │   └── use-employee.ts           # useCurrentEmployee hook
│   └── types/
│       └── index.ts                  # all shared TypeScript types
```

---

## Task 1: Scaffold Next.js project + install dependencies

**Files:**
- Create: entire project scaffold via `create-next-app`
- Modify: `tailwind.config.ts` — add brand color
- Modify: `src/app/globals.css` — base styles

- [ ] **Step 1: Scaffold project**

```bash
cd /Users/filipmicevski/Desktop
npx create-next-app@latest GoDevLab --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
cd GoDevLab
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr @tanstack/react-query date-fns lucide-react class-variance-authority clsx tailwind-merge
npm install --save-dev ts-node @types/node
```

- [ ] **Step 3: Install shadcn/ui**

```bash
npx shadcn@latest init
```

When prompted: style = Default, base color = Slate, CSS variables = yes.

- [ ] **Step 4: Add shadcn components**

```bash
npx shadcn@latest add button card badge dialog input textarea separator tabs tooltip dropdown-menu avatar
```

- [ ] **Step 5: Configure brand color in `tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          300: "#93c5fd",
          700: "#2563eb",
          800: "#1d4ed8",
        },
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 6: Set up `.env.local`**

Create `/Users/filipmicevski/Desktop/GoDevLab/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

(Fill in after creating Supabase project in Task 2.)

- [ ] **Step 7: Verify scaffold runs**

```bash
npm run dev
```

Expected: Next.js default page loads at http://localhost:3000

---

## Task 2: Supabase project + schema

**Files:**
- Create: `supabase/schema.sql`

- [ ] **Step 1: Create Supabase project**

Go to https://supabase.com → New project → name: `godevlab-hub`. Copy the project URL and anon key into `.env.local`.

- [ ] **Step 2: Write `supabase/schema.sql`**

```sql
-- Employees (mirrors auth.users)
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  client_name TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog', 'active', 'review', 'completed')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),
  due_date DATE,
  repo_path TEXT,
  repo_url TEXT,
  deployed_url TEXT,
  stack TEXT[] DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tasks
CREATE TABLE IF NOT EXISTS project_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'in_progress', 'done')),
  due_date DATE,
  created_by UUID NOT NULL REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Activity log
CREATE TABLE IF NOT EXISTS project_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  update_type TEXT NOT NULL DEFAULT 'progress'
    CHECK (update_type IN ('progress', 'note', 'blocker', 'decision')),
  created_by UUID NOT NULL REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notes (project_id null = global note)
CREATE TABLE IF NOT EXISTS notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON project_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- Employees: visible to authenticated; only self can insert
CREATE POLICY "employees_select" ON employees FOR SELECT TO authenticated USING (true);
CREATE POLICY "employees_insert" ON employees FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "employees_update" ON employees FOR UPDATE TO authenticated
  USING (id = auth.uid() OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));

-- Projects
CREATE POLICY "projects_select" ON projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "projects_insert" ON projects FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "projects_update" ON projects FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "projects_delete" ON projects FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));

-- Tasks
CREATE POLICY "tasks_select" ON project_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "tasks_insert" ON project_tasks FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "tasks_update" ON project_tasks FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "tasks_delete" ON project_tasks FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));

-- Updates
CREATE POLICY "updates_select" ON project_updates FOR SELECT TO authenticated USING (true);
CREATE POLICY "updates_insert" ON project_updates FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "updates_delete" ON project_updates FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));

-- Notes
CREATE POLICY "notes_select" ON notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "notes_insert" ON notes FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "notes_delete" ON notes FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));
```

- [ ] **Step 3: Run schema in Supabase**

Go to Supabase dashboard → SQL Editor → paste `supabase/schema.sql` → Run.

Expected: all tables created with no errors.

---

## Task 3: Supabase helpers + types

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/utils.ts`
- Create: `src/types/index.ts`

- [ ] **Step 1: Create `src/lib/supabase/client.ts`**

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 2: Create `src/lib/supabase/server.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    }
  );
}
```

- [ ] **Step 3: Create `src/lib/utils.ts`**

```ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Create `src/types/index.ts`**

```ts
export type EmployeeRole = "admin" | "member";
export type ProjectStatus = "backlog" | "active" | "review" | "completed";
export type ProjectPriority = "low" | "medium" | "high";
export type TaskStatus = "todo" | "in_progress" | "done";
export type UpdateType = "progress" | "note" | "blocker" | "decision";

export interface Employee {
  id: string;
  full_name: string;
  email: string;
  role: EmployeeRole;
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
  last_synced_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  employee?: Employee;
}

export interface ProjectTask {
  id: string;
  project_id: string;
  title: string;
  details: string | null;
  status: TaskStatus;
  due_date: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  employee?: Employee;
}

export interface ProjectUpdate {
  id: string;
  project_id: string;
  title: string;
  details: string;
  update_type: UpdateType;
  created_by: string;
  created_at: string;
  employee?: Employee;
}

export interface Note {
  id: string;
  title: string;
  description: string;
  project_id: string | null;
  created_by: string;
  created_at: string;
  employee?: Employee;
}

export interface ReportJson {
  project: string;
  client: string;
  status: string;
  stack: string[];
  repo_url: string;
  deployed_url: string;
  phases: Array<{
    name: string;
    status: "completed" | "in_progress" | "pending";
    completed_at: string | null;
  }>;
  last_session: {
    date: string;
    summary: string;
  };
  sessions_count: number;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

## Task 4: Supabase queries

**Files:**
- Create: `src/lib/supabase/queries.ts`

- [ ] **Step 1: Create `src/lib/supabase/queries.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Employee, Project, ProjectTask, ProjectUpdate, Note,
  ProjectStatus, ProjectPriority, TaskStatus, UpdateType,
} from "@/types";

export async function getCurrentEmployee(supabase: SupabaseClient): Promise<Employee | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("employees").select("*").eq("id", user.id).single();
  return data;
}

export async function getProjects(supabase: SupabaseClient): Promise<Project[]> {
  const { data } = await supabase
    .from("projects")
    .select("*, employee:employees(id, full_name, email, role, created_at)")
    .order("updated_at", { ascending: false });
  return data ?? [];
}

export async function createProject(
  supabase: SupabaseClient,
  input: {
    slug: string; title: string; client_name?: string; description?: string;
    status: ProjectStatus; priority: ProjectPriority; due_date?: string;
    repo_path?: string; repo_url?: string; deployed_url?: string; stack?: string[];
    created_by: string;
  }
): Promise<Project> {
  const { data, error } = await supabase.from("projects").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateProject(
  supabase: SupabaseClient,
  projectId: string,
  input: Partial<Pick<Project, "status" | "priority" | "due_date" | "title" | "client_name" | "description" | "repo_url" | "deployed_url" | "stack" | "last_synced_at">>
): Promise<void> {
  const { error } = await supabase.from("projects").update(input).eq("id", projectId);
  if (error) throw error;
}

export async function getAllProjectTasks(supabase: SupabaseClient): Promise<ProjectTask[]> {
  const { data } = await supabase
    .from("project_tasks")
    .select("*, employee:employees(id, full_name, email, role, created_at)")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function createProjectTask(
  supabase: SupabaseClient,
  input: { project_id: string; title: string; details?: string; due_date?: string; created_by: string }
): Promise<ProjectTask> {
  const { data, error } = await supabase.from("project_tasks").insert({ ...input, status: "todo" }).select().single();
  if (error) throw error;
  return data;
}

export async function updateProjectTask(
  supabase: SupabaseClient,
  taskId: string,
  input: { status: TaskStatus }
): Promise<void> {
  const { error } = await supabase.from("project_tasks").update(input).eq("id", taskId);
  if (error) throw error;
}

export async function deleteProjectTask(supabase: SupabaseClient, taskId: string): Promise<void> {
  const { error } = await supabase.from("project_tasks").delete().eq("id", taskId);
  if (error) throw error;
}

export async function getProjectUpdates(supabase: SupabaseClient, projectId: string): Promise<ProjectUpdate[]> {
  const { data } = await supabase
    .from("project_updates")
    .select("*, employee:employees(id, full_name, email, role, created_at)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function getRecentUpdates(supabase: SupabaseClient, limit = 5): Promise<ProjectUpdate[]> {
  const { data } = await supabase
    .from("project_updates")
    .select("*, employee:employees(id, full_name, email, role, created_at)")
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function createProjectUpdate(
  supabase: SupabaseClient,
  input: { project_id: string; title: string; details: string; update_type: UpdateType; created_by: string }
): Promise<ProjectUpdate> {
  const { data, error } = await supabase.from("project_updates").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function deleteProjectUpdate(supabase: SupabaseClient, updateId: string): Promise<void> {
  const { error } = await supabase.from("project_updates").delete().eq("id", updateId);
  if (error) throw error;
}

export async function getNotes(supabase: SupabaseClient): Promise<Note[]> {
  const { data } = await supabase
    .from("notes")
    .select("*, employee:employees(id, full_name, email, role, created_at)")
    .order("created_at", { ascending: false });
  return data ?? [];
}

export async function createNote(
  supabase: SupabaseClient,
  input: { title: string; description: string; project_id?: string; created_by: string }
): Promise<Note> {
  const { data, error } = await supabase.from("notes").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function deleteNote(supabase: SupabaseClient, noteId: string): Promise<void> {
  const { error } = await supabase.from("notes").delete().eq("id", noteId);
  if (error) throw error;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

---

## Task 5: Auth — middleware + login page

**Files:**
- Create: `src/middleware.ts`
- Create: `src/app/login/page.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Create `src/middleware.ts`**

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;

  if (!user && pathname.startsWith("/dashboard")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 2: Create `src/app/page.tsx`**

```ts
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
```

- [ ] **Step 3: Create `src/app/login/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-6 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-gray-900">GoDevLab</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your workspace</p>
        </div>
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Email</label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Password</label>
            <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button type="submit" className="w-full bg-brand-700 hover:bg-brand-800" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verify auth works end-to-end**

```bash
npm run dev
```

Open http://localhost:3000 → should redirect to /login. Sign in with a test Supabase user (create one manually in Supabase Auth dashboard for now). Should redirect to /dashboard after login.

---

## Task 6: `use-employee` hook + providers + dashboard shell

**Files:**
- Create: `src/hooks/use-employee.ts`
- Create: `src/components/providers.tsx`
- Create: `src/app/dashboard/layout.tsx`
- Create: `src/components/sidebar.tsx`
- Create: `src/components/stat-card.tsx`

- [ ] **Step 1: Create `src/hooks/use-employee.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getCurrentEmployee } from "@/lib/supabase/queries";

export function useCurrentEmployee() {
  const supabase = createClient();
  return useQuery({
    queryKey: ["current-employee"],
    queryFn: () => getCurrentEmployee(supabase),
  });
}
```

- [ ] **Step 2: Create `src/components/providers.tsx`**

```tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
```

- [ ] **Step 3: Modify `src/app/layout.tsx` to wrap with Providers**

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "GoDevLab Hub",
  description: "Internal agency dashboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Create `src/components/stat-card.tsx`**

```tsx
import { type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: number | string;
  subtitle: string;
  icon: LucideIcon;
  iconColor?: string;
}

export function StatCard({ title, value, subtitle, icon: Icon, iconColor }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <Icon className={cn("h-5 w-5 text-muted-foreground", iconColor)} />
        </div>
        <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Create `src/components/sidebar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, FolderKanban, StickyNote, Users, LogOut, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Employee } from "@/types";

const navSections = [
  {
    title: "Operations",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/dashboard/employees", label: "Employees", icon: Users },
    ],
  },
  {
    title: "Project Tracking",
    items: [
      { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
      { href: "/dashboard/notes", label: "Notes", icon: StickyNote },
    ],
  },
];

interface SidebarProps {
  employee: Employee | null;
}

export function Sidebar({ employee }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <aside className="w-64 border-r bg-white flex flex-col h-screen sticky top-0">
      <div className="p-4">
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">GoDevLab</p>
            <p className="text-xs text-muted-foreground">Agency Hub</p>
          </div>
        </div>
      </div>
      <Separator />
      <nav className="flex-1 p-3">
        <div className="space-y-5">
          {navSections.map((section) => (
            <div key={section.title} className="space-y-1.5">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {section.title}
              </p>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                      isActive(item.href)
                        ? "bg-brand-50 text-brand-700"
                        : "text-gray-600 hover:bg-gray-100"
                    )}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <Separator />
      <div className="p-3 space-y-2">
        {employee && (
          <div className="px-3 py-2">
            <p className="text-sm font-medium truncate">{employee.full_name}</p>
            <p className="text-xs text-muted-foreground capitalize">{employee.role}</p>
          </div>
        )}
        <Button variant="ghost" className="w-full justify-start text-gray-600" onClick={handleLogout}>
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 6: Create `src/app/dashboard/layout.tsx`**

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentEmployee } from "@/lib/supabase/queries";
import { Sidebar } from "@/components/sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const employee = await getCurrentEmployee(supabase);

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar employee={employee} />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 7: Verify layout renders**

```bash
npm run dev
```

Log in → should see the sidebar with GoDevLab branding + nav links. Main area is empty (no page yet).

---

## Task 7: Dashboard overview page

**Files:**
- Create: `src/app/dashboard/page.tsx`

- [ ] **Step 1: Create `src/app/dashboard/page.tsx`**

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { addDays, format, formatDistanceToNow, isAfter } from "date-fns";
import { CheckSquare, Clock, FolderKanban, Lightbulb } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getProjects, getAllProjectTasks, getRecentUpdates, getNotes } from "@/lib/supabase/queries";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function DashboardPage() {
  const supabase = createClient();

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(supabase),
    refetchInterval: 30000,
  });

  const { data: tasks = [] } = useQuery({
    queryKey: ["project-tasks"],
    queryFn: () => getAllProjectTasks(supabase),
  });

  const { data: recentUpdates = [] } = useQuery({
    queryKey: ["recent-updates"],
    queryFn: () => getRecentUpdates(supabase, 5),
  });

  const { data: notes = [] } = useQuery({
    queryKey: ["notes"],
    queryFn: () => getNotes(supabase),
  });

  const activeProjects = projects.filter(p => p.status !== "completed");
  const openTasks = tasks.filter(t => t.status !== "done");
  const completedTasks = tasks.filter(t => t.status === "done");
  const taskCompletionRate = tasks.length === 0 ? 0 : Math.round((completedTasks.length / tasks.length) * 100);

  const upcomingDeadlines = projects
    .filter(p =>
      p.due_date &&
      p.status !== "completed" &&
      isAfter(addDays(new Date(p.due_date), 1), new Date())
    )
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Team pulse, active work, and the latest project progress from GoDevLab.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard/projects">
            <FolderKanban className="mr-2 h-4 w-4" />
            Open Projects
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Active Projects" value={activeProjects.length} subtitle={`${projects.length} total`} icon={FolderKanban} iconColor="text-sky-600" />
        <StatCard title="Open Tasks" value={openTasks.length} subtitle={`${taskCompletionRate}% completion rate`} icon={CheckSquare} iconColor="text-emerald-600" />
        <StatCard title="Completed Tasks" value={completedTasks.length} subtitle={`across all projects`} icon={Clock} iconColor="text-brand-700" />
        <StatCard title="Notes" value={notes.length} subtitle="global and per-project" icon={Lightbulb} iconColor="text-amber-600" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Project Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {recentUpdates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No project updates yet.</p>
            ) : (
              <div className="space-y-4">
                {recentUpdates.map(update => (
                  <div key={update.id} className="flex items-start justify-between gap-4 border-b pb-4 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{update.title}</p>
                      <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{update.details}</p>
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-medium text-brand-700">{update.employee?.full_name ?? "Unknown"}</span>
                        <span className="capitalize">{update.update_type}</span>
                      </div>
                    </div>
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(update.created_at), { addSuffix: true })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Upcoming Deadlines</CardTitle></CardHeader>
            <CardContent>
              {upcomingDeadlines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No due dates scheduled.</p>
              ) : (
                <div className="space-y-3">
                  {upcomingDeadlines.map(project => (
                    <div key={project.id} className="rounded-lg border border-gray-200 px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{project.title}</p>
                      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                        <span className="capitalize">{project.status}</span>
                        <span>{project.due_date ? format(new Date(project.due_date), "MMM d, yyyy") : ""}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Workflow Snapshot</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Tasks completed</span>
                  <span className="font-medium text-gray-900">{completedTasks.length}/{tasks.length}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100">
                  <div className="h-2 rounded-full bg-brand-700 transition-all" style={{ width: `${taskCompletionRate}%` }} />
                </div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-4">
                <p className="text-sm text-muted-foreground">
                  {activeProjects.length === 0
                    ? "Add a project to start tracking work."
                    : `${activeProjects.length} active project${activeProjects.length > 1 ? "s" : ""} moving, ${openTasks.length} open tasks in progress.`}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify page renders with live data**

```bash
npm run dev
```

Open http://localhost:3000/dashboard — stat cards should show zeros (no data yet). Layout intact.

---

## Task 8: Projects page

**Files:**
- Create: `src/app/dashboard/projects/page.tsx`

- [ ] **Step 1: Create `src/app/dashboard/projects/page.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { CalendarDays, CheckSquare2, FolderKanban, ListTodo, PlusCircle, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getProjects, getAllProjectTasks, getProjectUpdates,
  createProject, updateProject, createProjectTask, updateProjectTask,
  deleteProjectTask, createProjectUpdate, deleteProjectUpdate,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import type { ProjectStatus, ProjectPriority, TaskStatus, UpdateType } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const selectCls = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const statusStyles: Record<ProjectStatus, string> = {
  backlog: "border-gray-200 bg-gray-100 text-gray-700",
  active: "border-sky-200 bg-sky-100 text-sky-700",
  review: "border-amber-200 bg-amber-100 text-amber-700",
  completed: "border-emerald-200 bg-emerald-100 text-emerald-700",
};
const taskStyles: Record<TaskStatus, string> = {
  todo: "border-gray-200 bg-gray-100 text-gray-700",
  in_progress: "border-blue-200 bg-blue-100 text-blue-700",
  done: "border-emerald-200 bg-emerald-100 text-emerald-700",
};
const updateStyles: Record<UpdateType, string> = {
  progress: "border-sky-200 bg-sky-100 text-sky-700",
  note: "border-gray-200 bg-gray-100 text-gray-700",
  blocker: "border-red-200 bg-red-100 text-red-700",
  decision: "border-violet-200 bg-violet-100 text-violet-700",
};

export default function ProjectsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: employee } = useCurrentEmployee();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);

  const [projectTitle, setProjectTitle] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [projectClientName, setProjectClientName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>("active");
  const [projectPriority, setProjectPriority] = useState<ProjectPriority>("medium");
  const [projectDueDate, setProjectDueDate] = useState("");
  const [projectRepoPath, setProjectRepoPath] = useState("");
  const [projectRepoUrl, setProjectRepoUrl] = useState("");
  const [projectStack, setProjectStack] = useState("");

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDetails, setTaskDetails] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");

  const [updateTitle, setUpdateTitle] = useState("");
  const [updateDetails, setUpdateDetails] = useState("");
  const [updateType, setUpdateType] = useState<UpdateType>("progress");

  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => getProjects(supabase) });
  const { data: allTasks = [] } = useQuery({ queryKey: ["project-tasks"], queryFn: () => getAllProjectTasks(supabase) });
  const { data: projectUpdates = [] } = useQuery({
    queryKey: ["project-updates", selectedProjectId],
    queryFn: () => getProjectUpdates(supabase, selectedProjectId!),
    enabled: Boolean(selectedProjectId),
  });

  useEffect(() => {
    if (projects.length === 0) { setSelectedProjectId(null); return; }
    if (!selectedProjectId || !projects.some(p => p.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId) ?? null, [projects, selectedProjectId]);
  const selectedTasks = useMemo(() => allTasks.filter(t => t.project_id === selectedProjectId), [allTasks, selectedProjectId]);
  const taskStats = useMemo(() => {
    const done = selectedTasks.filter(t => t.status === "done").length;
    const inProgress = selectedTasks.filter(t => t.status === "in_progress").length;
    const total = selectedTasks.length;
    return { total, done, inProgress, todo: total - done - inProgress, completion: total === 0 ? 0 : Math.round((done / total) * 100) };
  }, [selectedTasks]);

  const createProjectMutation = useMutation({
    mutationFn: () => createProject(supabase, {
      slug: projectSlug || projectTitle.toLowerCase().replace(/\s+/g, "-"),
      title: projectTitle,
      client_name: projectClientName || undefined,
      description: projectDescription || undefined,
      status: projectStatus,
      priority: projectPriority,
      due_date: projectDueDate || undefined,
      repo_path: projectRepoPath || undefined,
      repo_url: projectRepoUrl || undefined,
      stack: projectStack ? projectStack.split(",").map(s => s.trim()).filter(Boolean) : [],
      created_by: employee!.id,
    }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSelectedProjectId(project.id);
      setProjectTitle(""); setProjectSlug(""); setProjectClientName(""); setProjectDescription("");
      setProjectStatus("active"); setProjectPriority("medium"); setProjectDueDate("");
      setProjectRepoPath(""); setProjectRepoUrl(""); setProjectStack("");
      setProjectDialogOpen(false);
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateProject>[2] & { projectId: string }) => {
      const { projectId, ...rest } = input;
      return updateProject(supabase, projectId, rest);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  const createTaskMutation = useMutation({
    mutationFn: () => createProjectTask(supabase, { project_id: selectedProjectId!, title: taskTitle, details: taskDetails || undefined, due_date: taskDueDate || undefined, created_by: employee!.id }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["project-tasks"] }); setTaskTitle(""); setTaskDetails(""); setTaskDueDate(""); },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) => updateProjectTask(supabase, taskId, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-tasks"] }),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => deleteProjectTask(supabase, taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-tasks"] }),
  });

  const createUpdateMutation = useMutation({
    mutationFn: () => createProjectUpdate(supabase, { project_id: selectedProjectId!, title: updateTitle, details: updateDetails, update_type: updateType, created_by: employee!.id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-updates", selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ["recent-updates"] });
      setUpdateTitle(""); setUpdateDetails(""); setUpdateType("progress");
    },
  });

  const deleteUpdateMutation = useMutation({
    mutationFn: (updateId: string) => deleteProjectUpdate(supabase, updateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-updates", selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ["recent-updates"] });
    },
  });

  const canCreate = Boolean(projectTitle.trim() && employee);
  const canCreateTask = Boolean(selectedProjectId && taskTitle.trim() && employee);
  const canCreateUpdate = Boolean(selectedProjectId && updateTitle.trim() && updateDetails.trim() && employee);
  const canManage = (createdBy: string) => employee?.role === "admin" || createdBy === employee?.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create projects, break them into tasks, and log progress.</p>
        </div>
        <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-brand-700 hover:bg-brand-800"><PlusCircle className="mr-2 h-4 w-4" />New Project</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Project</DialogTitle></DialogHeader>
            <form onSubmit={e => { e.preventDefault(); if (canCreate) createProjectMutation.mutate(); }} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Title</label>
                  <Input value={projectTitle} onChange={e => setProjectTitle(e.target.value)} placeholder="Wedding Photo Upload" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Slug</label>
                  <Input value={projectSlug} onChange={e => setProjectSlug(e.target.value)} placeholder="auto-generated" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Client name</label>
                <Input value={projectClientName} onChange={e => setProjectClientName(e.target.value)} placeholder="Client" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Description</label>
                <Textarea value={projectDescription} onChange={e => setProjectDescription(e.target.value)} rows={3} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Status</label>
                  <select value={projectStatus} onChange={e => setProjectStatus(e.target.value as ProjectStatus)} className={selectCls}>
                    {(["backlog","active","review","completed"] as ProjectStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Priority</label>
                  <select value={projectPriority} onChange={e => setProjectPriority(e.target.value as ProjectPriority)} className={selectCls}>
                    {(["low","medium","high"] as ProjectPriority[]).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Due date</label>
                <Input type="date" value={projectDueDate} onChange={e => setProjectDueDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Local repo path</label>
                <Input value={projectRepoPath} onChange={e => setProjectRepoPath(e.target.value)} placeholder="/Users/filipmicevski/Desktop/svadba" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">GitHub URL</label>
                <Input value={projectRepoUrl} onChange={e => setProjectRepoUrl(e.target.value)} placeholder="https://github.com/..." />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Stack (comma separated)</label>
                <Input value={projectStack} onChange={e => setProjectStack(e.target.value)} placeholder="Next.js, Supabase, TypeScript" />
              </div>
              <Button type="submit" className="w-full bg-brand-700 hover:bg-brand-800" disabled={!canCreate || createProjectMutation.isPending}>
                {createProjectMutation.isPending ? "Creating..." : "Create Project"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Project List</CardTitle>
            <CardDescription>Select a project to review its tasks and activity.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {projects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-muted-foreground">No projects yet.</div>
            ) : projects.map(project => {
              const pTasks = allTasks.filter(t => t.project_id === project.id);
              const pDone = pTasks.filter(t => t.status === "done").length;
              const isActive = selectedProjectId === project.id;
              return (
                <button key={project.id} type="button" onClick={() => setSelectedProjectId(project.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition-colors ${isActive ? "border-brand-300 bg-brand-50" : "border-gray-200 bg-white hover:border-gray-300"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{project.title}</p>
                      {project.client_name && <p className="mt-0.5 text-xs text-muted-foreground">{project.client_name}</p>}
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-1">{project.description || "No description."}</p>
                    </div>
                    <Badge variant="outline" className={statusStyles[project.status]}>{project.status}</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="capitalize">{project.priority} priority</span>
                    <span>{pDone}/{pTasks.length} done</span>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {selectedProject ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <FolderKanban className="h-4 w-4 text-brand-700" />
                      <CardTitle>{selectedProject.title}</CardTitle>
                    </div>
                    {selectedProject.client_name && <p className="mt-1 text-sm text-muted-foreground">{selectedProject.client_name}</p>}
                    <CardDescription className="mt-1">{selectedProject.description || "No description."}</CardDescription>
                    {selectedProject.stack.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {selectedProject.stack.map(s => <Badge key={s} variant="outline" className="border-gray-200 bg-gray-50 text-xs text-gray-600">{s}</Badge>)}
                      </div>
                    )}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[{ label: "Tasks", value: taskStats.total }, { label: "In Progress", value: taskStats.inProgress }, { label: "Done", value: taskStats.done }].map(s => (
                      <div key={s.label} className="rounded-xl border border-gray-200 px-4 py-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{s.label}</p>
                        <p className="mt-2 text-xl font-semibold text-gray-900">{s.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Status</label>
                    <select value={selectedProject.status} onChange={e => updateProjectMutation.mutate({ projectId: selectedProject.id, status: e.target.value as ProjectStatus })} className={selectCls}>
                      {(["backlog","active","review","completed"] as ProjectStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Priority</label>
                    <select value={selectedProject.priority} onChange={e => updateProjectMutation.mutate({ projectId: selectedProject.id, priority: e.target.value as ProjectPriority })} className={selectCls}>
                      {(["low","medium","high"] as ProjectPriority[]).map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Due date</label>
                    <Input type="date" value={selectedProject.due_date ?? ""} onChange={e => updateProjectMutation.mutate({ projectId: selectedProject.id, due_date: e.target.value || null })} />
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Completion</span>
                    <span className="font-medium text-gray-900">{taskStats.completion}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100">
                    <div className="h-2 rounded-full bg-brand-700" style={{ width: `${taskStats.completion}%` }} />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                  <div className="inline-flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-brand-700" />
                    {selectedProject.due_date ? `Due ${format(new Date(selectedProject.due_date), "MMM d, yyyy")}` : "No due date"}
                  </div>
                  <div className="inline-flex items-center gap-2">
                    <CheckSquare2 className="h-4 w-4 text-brand-700" />
                    Created by {selectedProject.employee?.full_name ?? "Unknown"}
                  </div>
                  {selectedProject.last_synced_at && (
                    <span className="text-xs">Last synced {formatDistanceToNow(new Date(selectedProject.last_synced_at), { addSuffix: true })}</span>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 2xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2"><ListTodo className="h-4 w-4 text-brand-700" /><CardTitle className="text-base">Work Items</CardTitle></div>
                  <CardDescription>Break the project down into concrete tasks.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form onSubmit={e => { e.preventDefault(); if (canCreateTask) createTaskMutation.mutate(); }} className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <Input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="New task title" />
                    <Textarea value={taskDetails} onChange={e => setTaskDetails(e.target.value)} placeholder="Add context or acceptance criteria." rows={3} />
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Input type="date" value={taskDueDate} onChange={e => setTaskDueDate(e.target.value)} />
                      <Button type="submit" className="bg-brand-700 hover:bg-brand-800" disabled={!canCreateTask || createTaskMutation.isPending}>
                        <PlusCircle className="mr-2 h-4 w-4" />Add Task
                      </Button>
                    </div>
                  </form>
                  {selectedTasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tasks yet.</p>
                  ) : selectedTasks.map(task => (
                    <div key={task.id} className="rounded-2xl border border-gray-200 p-4">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-gray-900">{task.title}</p>
                            <Badge variant="outline" className={taskStyles[task.status]}>{task.status.replace("_", " ")}</Badge>
                          </div>
                          {task.details && <p className="mt-2 text-sm text-muted-foreground">{task.details}</p>}
                          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span>{task.employee?.full_name ?? "Unknown"}</span>
                            {task.due_date && <span>Due {format(new Date(task.due_date), "MMM d, yyyy")}</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-start gap-2">
                          <select value={task.status} onChange={e => updateTaskMutation.mutate({ taskId: task.id, status: e.target.value as TaskStatus })} className={selectCls} disabled={!canManage(task.created_by)}>
                            {(["todo","in_progress","done"] as TaskStatus[]).map(s => <option key={s} value={s}>{s.replace("_"," ")}</option>)}
                          </select>
                          {canManage(task.created_by) && (
                            <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-red-600" onClick={() => deleteTaskMutation.mutate(task.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Activity Log</CardTitle>
                  <CardDescription>Record progress updates, blockers, and decisions.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form onSubmit={e => { e.preventDefault(); if (canCreateUpdate) createUpdateMutation.mutate(); }} className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <Input value={updateTitle} onChange={e => setUpdateTitle(e.target.value)} placeholder="Update title" />
                    <select value={updateType} onChange={e => setUpdateType(e.target.value as UpdateType)} className={selectCls}>
                      {(["progress","note","blocker","decision"] as UpdateType[]).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <Textarea value={updateDetails} onChange={e => setUpdateDetails(e.target.value)} placeholder="Describe what happened or what changed." rows={4} />
                    <Button type="submit" className="bg-brand-700 hover:bg-brand-800" disabled={!canCreateUpdate || createUpdateMutation.isPending}>
                      <PlusCircle className="mr-2 h-4 w-4" />Add Update
                    </Button>
                  </form>
                  {projectUpdates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No updates logged yet.</p>
                  ) : projectUpdates.map(update => (
                    <div key={update.id} className="rounded-2xl border border-gray-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-gray-900">{update.title}</p>
                            <Badge variant="outline" className={updateStyles[update.update_type]}>{update.update_type}</Badge>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{update.details}</p>
                          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span className="font-medium text-brand-700">{update.employee?.full_name ?? "Unknown"}</span>
                            <span>{formatDistanceToNow(new Date(update.created_at), { addSuffix: true })}</span>
                          </div>
                        </div>
                        {canManage(update.created_by) && (
                          <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-red-600" onClick={() => deleteUpdateMutation.mutate(update.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <Card><CardContent className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">Select a project to start tracking work.</CardContent></Card>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify projects page works**

```bash
npm run dev
```

Open /dashboard/projects. Create a test project — it should appear in the list. Select it, add a task and an activity log update. Verify all CRUD works.

---

## Task 9: Notes page

**Files:**
- Create: `src/app/dashboard/notes/page.tsx`

- [ ] **Step 1: Create `src/app/dashboard/notes/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { PlusCircle, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getNotes, createNote, deleteNote, getProjects } from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function NotesPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: employee } = useCurrentEmployee();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");

  const { data: notes = [] } = useQuery({ queryKey: ["notes"], queryFn: () => getNotes(supabase) });
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => getProjects(supabase) });

  const createMutation = useMutation({
    mutationFn: () => createNote(supabase, {
      title, description, project_id: projectId || undefined, created_by: employee!.id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      setTitle(""); setDescription(""); setProjectId("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => deleteNote(supabase, noteId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes"] }),
  });

  const canCreate = Boolean(title.trim() && description.trim() && employee);
  const canManage = (createdBy: string) => employee?.role === "admin" || createdBy === employee?.id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Notes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Global notes and per-project references.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader><CardTitle className="text-base">Add Note</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={e => { e.preventDefault(); if (canCreate) createMutation.mutate(); }} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Title</label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Note title" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Content</label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Write your note..." rows={5} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Project (optional)</label>
                <select
                  value={projectId}
                  onChange={e => setProjectId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">Global note</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
              <Button type="submit" className="w-full bg-brand-700 hover:bg-brand-800" disabled={!canCreate || createMutation.isPending}>
                <PlusCircle className="mr-2 h-4 w-4" />
                {createMutation.isPending ? "Adding..." : "Add Note"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {notes.length === 0 ? (
            <Card><CardContent className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">No notes yet.</CardContent></Card>
          ) : notes.map(note => (
            <Card key={note.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">{note.title}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{note.description}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-medium text-brand-700">{note.employee?.full_name ?? "Unknown"}</span>
                      <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
                      {note.project_id && <span className="capitalize">{projects.find(p => p.id === note.project_id)?.title ?? "project"}</span>}
                    </div>
                  </div>
                  {canManage(note.created_by) && (
                    <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-red-600" onClick={() => deleteMutation.mutate(note.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify notes page works**

```bash
npm run dev
```

Open /dashboard/notes. Add a global note and one linked to a project. Both should appear in the list.

---

## Task 10: Sync script + projects config

**Files:**
- Create: `projects.config.json`
- Create: `scripts/sync.ts`
- Create: `data/projects/.gitkeep`

- [ ] **Step 1: Create `projects.config.json`**

```json
[
  {
    "slug": "svadba",
    "path": "/Users/filipmicevski/Desktop/svadba"
  }
]
```

- [ ] **Step 2: Create `data/projects/.gitkeep`**

Create an empty file at `data/projects/.gitkeep` so the folder is tracked by git.

- [ ] **Step 3: Create `scripts/sync.ts`**

```ts
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const CONFIG_PATH = path.resolve(__dirname, "../projects.config.json");
const DATA_DIR = path.resolve(__dirname, "../data/projects");

interface ProjectConfig {
  slug: string;
  path: string;
}

async function sync() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const configs: ProjectConfig[] = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  for (const config of configs) {
    const reportPath = path.join(config.path, "report", "report.json");

    if (!fs.existsSync(reportPath)) {
      console.log(`[skip] ${config.slug} — no report.json found at ${reportPath}`);
      continue;
    }

    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    const destPath = path.join(DATA_DIR, `${config.slug}.json`);
    fs.writeFileSync(destPath, JSON.stringify(report, null, 2));

    await supabase
      .from("projects")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("slug", config.slug);

    console.log(`[synced] ${config.slug}`);
  }

  console.log("Sync complete.");
}

sync().catch(console.error);
```

- [ ] **Step 4: Add ts-node config to `package.json`**

Add to `package.json` scripts:

```json
"sync": "ts-node --project tsconfig.json scripts/sync.ts"
```

- [ ] **Step 5: Test sync script**

First create a test report in the svadba project:

```bash
mkdir -p /Users/filipmicevski/Desktop/svadba/report
```

Create `/Users/filipmicevski/Desktop/svadba/report/report.json`:

```json
{
  "project": "svadba",
  "client": "Wedding Client",
  "status": "in_progress",
  "stack": ["Next.js", "Supabase", "TypeScript", "AWS S3"],
  "repo_url": "https://github.com/godevlabproduction/wedding-photo-upload",
  "deployed_url": "",
  "phases": [
    { "name": "Auth & Admin", "status": "completed", "completed_at": "2026-06-10" },
    { "name": "Photo Upload", "status": "in_progress", "completed_at": null }
  ],
  "last_session": {
    "date": "2026-06-24",
    "summary": "Initial project setup and Supabase schema"
  },
  "sessions_count": 1
}
```

Then run:

```bash
npm run sync
```

Expected output:
```
[synced] svadba
Sync complete.
```

Verify `data/projects/svadba.json` was created.

---

## Task 11: CLAUDE.md automation files

**Files:**
- Create: `.claude/CLAUDE.md` (hub)
- Create: `/Users/filipmicevski/Desktop/svadba/report/report.json` (already created in Task 10)
- Create: `/Users/filipmicevski/Desktop/svadba/.claude/CLAUDE.md`

- [ ] **Step 1: Create hub `.claude/CLAUDE.md`**

Create `/Users/filipmicevski/Desktop/GoDevLab/.claude/CLAUDE.md`:

```markdown
# GoDevLab Hub

This is the GoDevLab agency hub. At the start of every session, run the sync script to pull the latest report.json from all registered project directories:

```bash
npm run sync
```

This updates `data/projects/` with the latest state from each project repo and refreshes `last_synced_at` in Supabase.

To add a new project to the sync, add an entry to `projects.config.json`:
```json
{ "slug": "project-slug", "path": "/Users/filipmicevski/Desktop/project-folder" }
```
```

- [ ] **Step 2: Create svadba project `.claude/CLAUDE.md`**

Create `/Users/filipmicevski/Desktop/svadba/.claude/CLAUDE.md`:

```markdown
# GoDevLab Project: Svadba

This is a GoDevLab client project. Maintain `report/report.json` throughout every session.

## Session start
- Read `report/report.json` to load context: phases, last session summary, stack, sessions_count

## During work
- Update `phases[].status` to `completed` as features finish, set `completed_at` to today's date
- Keep `phases[].status` values to: `completed`, `in_progress`, or `pending`

## Session end
- Update `last_session.date` to today's date (YYYY-MM-DD)
- Update `last_session.summary` with a 1-2 sentence summary of what was done this session
- Increment `sessions_count` by 1
- Write the file

## Report location
`/Users/filipmicevski/Desktop/svadba/report/report.json`
```

- [ ] **Step 3: Verify CLAUDE.md is picked up**

Open a new Claude Code session inside `/Users/filipmicevski/Desktop/svadba/`. Claude should reference the report context at session start.

---

## Task 12: Seed svadba project in Supabase + Vercel deploy

**Files:**
- No new files — manual steps

- [ ] **Step 1: Create your user account**

Go to Supabase dashboard → Authentication → Users → "Invite user" for your email. Sign in via the hub login page. After signing in, insert your employee record in Supabase SQL Editor:

```sql
INSERT INTO employees (id, full_name, email, role)
VALUES (auth.uid(), 'Filip Micevski', 'your@email.com', 'admin');
```

Replace `auth.uid()` with your actual UUID from Authentication → Users.

- [ ] **Step 2: Invite second team member**

Supabase → Authentication → "Invite user" with their email. Once they sign in, insert their employee row:

```sql
INSERT INTO employees (id, full_name, email, role)
VALUES ('<their-uuid>', 'Team Member Name', 'their@email.com', 'member');
```

- [ ] **Step 3: Disable public signup**

Supabase → Authentication → Providers → Email → toggle off "Allow new users to sign up".

- [ ] **Step 4: Seed svadba project via hub UI**

Go to /dashboard/projects → New Project. Fill in:
- Title: `Svadba — Wedding Photo Upload`
- Slug: `svadba`
- Client name: `Wedding Client`
- Status: `active`
- Priority: `high`
- Local repo path: `/Users/filipmicevski/Desktop/svadba`
- GitHub URL: `https://github.com/godevlabproduction/wedding-photo-upload`
- Stack: `Next.js, Supabase, TypeScript, AWS S3`

- [ ] **Step 5: Run sync to verify last_synced_at updates**

```bash
npm run sync
```

Check the project card on /dashboard/projects — "Last synced X ago" should appear.

- [ ] **Step 6: Deploy to Vercel**

```bash
npm run build
```

Expected: build succeeds with no errors.

Then: go to vercel.com → New Project → import the GoDevLab GitHub repo (push the repo first). Add environment variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Deploy. Visit the Vercel URL — login should work with your Supabase credentials.
