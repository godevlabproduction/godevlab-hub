-- Employee tasks (assigned, optionally linked to a project)
CREATE TABLE IF NOT EXISTS employee_tasks (
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

-- Personal tasks (private to creator, no admin override)
CREATE TABLE IF NOT EXISTS personal_tasks (
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

-- updated_at triggers
CREATE TRIGGER trg_employee_tasks_updated_at
  BEFORE UPDATE ON employee_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_personal_tasks_updated_at
  BEFORE UPDATE ON personal_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: employee_tasks
ALTER TABLE employee_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employee_tasks_select" ON employee_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "employee_tasks_insert" ON employee_tasks FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "employee_tasks_update" ON employee_tasks FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "employee_tasks_delete" ON employee_tasks FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));

-- RLS: personal_tasks (creator-only, no admin exception)
ALTER TABLE personal_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "personal_tasks_all" ON personal_tasks FOR ALL TO authenticated
  USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
