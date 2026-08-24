-- Move from one shared token per project to one token per (project, employee)
-- pair, so each person working on a project can set up/regenerate their own
-- live sync without invalidating anyone else's.
DROP TABLE IF EXISTS project_sync_tokens;

CREATE TABLE project_sync_tokens (
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  employee_id    UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  regenerated_at TIMESTAMPTZ,
  PRIMARY KEY (project_id, employee_id)
);

ALTER TABLE project_sync_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "project_sync_tokens_admin_or_own" ON project_sync_tokens
  FOR ALL TO authenticated
  USING (
    employee_id = auth.uid()
    OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    employee_id = auth.uid()
    OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin')
  );
