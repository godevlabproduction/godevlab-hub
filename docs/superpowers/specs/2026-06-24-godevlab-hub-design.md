# GoDevLab Hub — Design Spec

**Date:** 2026-06-24  
**Status:** Approved

---

## Overview

A standalone internal agency dashboard for GoDevLab — fully private, two-person team. Tracks all client projects, tasks, activity logs, and notes. Claude automatically maintains a `report/report.json` in each project repo during work sessions; a sync script pulls those reports into the hub before each push.

---

## Architecture

```
Desktop/
├── GoDevLab/                    ← this repo (the hub)
│   ├── data/projects/           ← synced report JSONs (git-tracked)
│   │   └── svadba.json
│   ├── projects.config.json     ← registry of project local paths
│   ├── scripts/sync.ts          ← copies report.json from each project into data/projects/
│   └── src/app/...              ← Next.js hub UI
│
├── svadba/                      ← client project repo
│   └── report/
│       └── report.json          ← Claude writes/updates this each session
│
└── future-project/
    └── report/
        └── report.json
```

**Session flow:**
1. Claude works on a project → updates `report/report.json` in that project repo
2. Developer pushes the project repo
3. Developer opens the hub session → Claude runs `scripts/sync.ts` → copies all report JSONs into `data/projects/`
4. Developer pushes hub repo → Vercel auto-deploys → dashboard is live

**Deployment:** Vercel (auto-deploy on push to main)

---

## Hub UI

Modeled on the existing gogevgelija dashboard GoDevLab section — same stack, same component patterns, same interaction model.

**Stack:** Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, @tanstack/react-query, Supabase

**Pages:**
```
/login              ← Supabase email/password auth (2 users)
/dashboard          ← Overview: stat cards, recent activity, upcoming deadlines, workflow snapshot
/projects           ← Project list sidebar + selected project detail (tasks + activity log)
/notes              ← Global and per-project notes
```

**Reference implementation:** `/Users/filipmicevski/Desktop/work/gogevgelija/dashboard/src/app/dashboard/godevlab/`  
Copy the UI structure and component patterns from this directory. Do not copy the employee/RLS logic directly — adapt it for the hub schema below.

---

## Supabase Schema

New Supabase project dedicated to the hub (not shared with any client project).

```sql
-- Team members (mirrors Supabase auth.users)
CREATE TABLE employees (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Client projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,               -- used for URL routing + sync key
  title TEXT NOT NULL,
  client_name TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog', 'active', 'review', 'completed')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high')),
  due_date DATE,
  repo_path TEXT,                          -- local path e.g. /Users/filipmicevski/Desktop/svadba
  repo_url TEXT,                           -- GitHub URL
  deployed_url TEXT,
  stack TEXT[] DEFAULT '{}',              -- tech stack tags
  last_synced_at TIMESTAMPTZ,             -- updated by sync script
  created_by UUID NOT NULL REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Project work items
CREATE TABLE project_tasks (
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

-- Activity log entries per project
CREATE TABLE project_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  details TEXT NOT NULL,
  update_type TEXT NOT NULL DEFAULT 'progress'
    CHECK (update_type IN ('progress', 'note', 'blocker', 'decision')),
  created_by UUID NOT NULL REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notes (global or per-project)
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,  -- null = global note
  created_by UUID NOT NULL REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**RLS:** All tables enable RLS. Authenticated users can read all rows. Insert/update/delete require `auth.uid() = created_by` or `role = 'admin'` (checked via employees table).

**Auth:** Supabase email/password. First user registered manually gets `role = admin`. Second user gets `role = member`. No public signup — invite only (disable in Supabase dashboard).

---

## Report JSON Format

Each client project repo contains `report/report.json`. Claude maintains this file during every work session.

```json
{
  "project": "svadba",
  "client": "Client Name",
  "status": "in_progress",
  "stack": ["Next.js", "Supabase", "TypeScript", "AWS S3"],
  "repo_url": "https://github.com/godevlabproduction/wedding-photo-upload",
  "deployed_url": "",
  "phases": [
    {
      "name": "Authentication & Admin",
      "status": "completed",
      "completed_at": "2026-06-10"
    },
    {
      "name": "Photo Upload Flow",
      "status": "in_progress",
      "completed_at": null
    }
  ],
  "last_session": {
    "date": "2026-06-24",
    "summary": "Implemented S3 presigned URL upload with progress tracking"
  },
  "sessions_count": 7
}
```

The sync script reads this file and writes it to `data/projects/[slug].json` in the hub, then updates `last_synced_at` in Supabase.

---

## Sync Script

**`projects.config.json`** at hub root:
```json
[
  { "slug": "svadba", "path": "/Users/filipmicevski/Desktop/svadba" },
  { "slug": "future-project", "path": "/Users/filipmicevski/Desktop/future-project" }
]
```

**`scripts/sync.ts`:**
- Reads `projects.config.json`
- For each project: reads `{path}/report/report.json`, copies to `data/projects/{slug}.json`
- Updates `last_synced_at` in Supabase for that project slug
- Logs which projects were synced and which were missing a report file

Adding a new project: add one line to `projects.config.json`.

---

## Claude Automation

**In each client project repo — `.claude/CLAUDE.md`:**
```
# GoDevLab Project

This is a GoDevLab client project. Maintain report/report.json every session.

- Session start: read report/report.json to load context (phases, last session, stack)
- During work: update phase statuses as features complete
- Session end: update last_session.date and last_session.summary, increment sessions_count, write file
```

**In the hub repo — `.claude/CLAUDE.md`:**
```
# GoDevLab Hub

At the start of every session, run:
  npx ts-node scripts/sync.ts

This pulls the latest report.json from all registered project directories into data/projects/.
```

---

## Build Sequence

1. Scaffold `GoDevLab/` as a new Next.js + Tailwind + shadcn/ui project
2. Set up Supabase project, run schema migrations
3. Build auth (login page, middleware, Supabase SSR)
4. Build employees setup (first-run registration)
5. Build `/dashboard` overview page (port from gogevgelija reference)
6. Build `/projects` page (port from gogevgelija reference, adapted schema)
7. Build `/notes` page
8. Write `scripts/sync.ts` and `projects.config.json`
9. Add `.claude/CLAUDE.md` to hub and to `svadba/` (first project)
10. Set up Vercel deployment
11. Seed svadba as first project in Supabase
