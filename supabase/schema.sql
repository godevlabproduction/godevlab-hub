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
