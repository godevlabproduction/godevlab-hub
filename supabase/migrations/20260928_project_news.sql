-- "What's new" tracking: per (employee, project, section) last-viewed
-- timestamps, plus a view computing the latest activity timestamp per
-- project/section, so the UI can show a badge on the sidebar's Projects
-- item, on a project card, and on the specific cockpit tab that changed.

-- Indexes the per-section activity subqueries below need.
CREATE INDEX IF NOT EXISTS project_tasks_project_updated ON project_tasks (project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS project_updates_project_created ON project_updates (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notes_project_created ON notes (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_credentials_project_created ON project_credentials (project_id, created_at DESC);

CREATE OR REPLACE VIEW project_activity
WITH (security_invoker = true) AS
SELECT
  p.id AS project_id,
  (SELECT max(t.updated_at) FROM project_tasks t WHERE t.project_id = p.id) AS board_at,
  (SELECT max(greatest(m.created_at, coalesce(m.completed_at, m.created_at)))
     FROM project_milestones m WHERE m.project_id = p.id) AS timeline_at,
  (SELECT max(greatest(u.created_at, coalesce(u.resolved_at, u.created_at)))
     FROM project_updates u WHERE u.project_id = p.id) AS activity_at,
  (SELECT max(n.created_at) FROM notes n WHERE n.project_id = p.id) AS docs_at,
  (SELECT max(c.created_at) FROM project_credentials c WHERE c.project_id = p.id) AS access_at,
  p.last_synced_at AS sync_at
FROM projects p;

-- security_invoker means this view is exactly as safe as the tables it reads:
-- project_credentials is admin/assigned-only, so access_at only surfaces to
-- people who could already see that project's credentials.
GRANT SELECT ON project_activity TO authenticated;

CREATE TABLE IF NOT EXISTS project_views (
  employee_id    UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  section        TEXT NOT NULL CHECK (section IN ('board', 'timeline', 'activity', 'docs', 'access', 'sync')),
  last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (employee_id, project_id, section)
);

ALTER TABLE project_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "project_views_own" ON project_views;
CREATE POLICY "project_views_own" ON project_views FOR ALL TO authenticated
  USING (employee_id = (SELECT auth.uid()))
  WITH CHECK (employee_id = (SELECT auth.uid()));
