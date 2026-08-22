-- Assign employees to projects (drives credential visibility below).
CREATE TABLE IF NOT EXISTS project_assignments (
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, employee_id)
);

ALTER TABLE project_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_assignments_select" ON project_assignments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "project_assignments_write" ON project_assignments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));

-- Project credentials, split out of projects.credentials so RLS can
-- restrict them independently of the rest of the project row.
CREATE TABLE IF NOT EXISTS project_credentials (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service    TEXT NOT NULL,
  username   TEXT NOT NULL,
  password   TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_credentials_select" ON project_credentials
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM project_assignments
      WHERE project_id = project_credentials.project_id AND employee_id = auth.uid()
    )
  );

CREATE POLICY "project_credentials_write" ON project_credentials
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));

-- Migrate any existing credentials off the old JSONB column.
INSERT INTO project_credentials (project_id, service, username, password, created_by, created_at)
SELECT p.id, c->>'service', c->>'username', c->>'password', p.created_by, p.created_at
FROM projects p, jsonb_array_elements(p.credentials) AS c
WHERE p.credentials IS NOT NULL AND jsonb_array_length(p.credentials) > 0;

ALTER TABLE projects DROP COLUMN IF EXISTS credentials;
