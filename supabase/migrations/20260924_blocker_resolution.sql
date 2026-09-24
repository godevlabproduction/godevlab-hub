-- Lets a blocker be marked resolved, so the Command Center can show only the
-- blockers that are still open. project_updates had no UPDATE policy before.
ALTER TABLE project_updates
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES employees(id);

DROP POLICY IF EXISTS "updates_update" ON project_updates;
CREATE POLICY "updates_update" ON project_updates FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = project_updates.project_id AND pa.employee_id = auth.uid()
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = project_updates.project_id AND pa.employee_id = auth.uid()
    )
  );
