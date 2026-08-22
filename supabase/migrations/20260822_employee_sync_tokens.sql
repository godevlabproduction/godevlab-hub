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
