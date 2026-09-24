-- =====================================================================
-- Agency platform: task planning (assignee, estimate, review column,
-- completion time), milestones, time tracking, notifications, clients
-- and per-person weekly capacity. Run once in the Supabase SQL editor.
-- =====================================================================

-- ---------- projects: real start date -------------------------------
ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date DATE;
UPDATE projects SET start_date = created_at::date WHERE start_date IS NULL;
ALTER TABLE projects ALTER COLUMN start_date SET DEFAULT CURRENT_DATE;

-- ---------- clients -------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL UNIQUE,
  contact_name  TEXT,
  contact_email TEXT,
  website       TEXT,
  notes         TEXT,
  created_by    UUID REFERENCES employees(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clients_select" ON clients;
CREATE POLICY "clients_select" ON clients FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "clients_write" ON clients;
CREATE POLICY "clients_write" ON clients FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));

ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

INSERT INTO clients (name)
SELECT DISTINCT trim(client_name) FROM projects
WHERE client_name IS NOT NULL AND trim(client_name) <> ''
ON CONFLICT (name) DO NOTHING;

UPDATE projects p SET client_id = c.id
FROM clients c
WHERE p.client_id IS NULL AND p.client_name IS NOT NULL
  AND lower(trim(p.client_name)) = lower(c.name);

-- ---------- employees: weekly capacity ------------------------------
ALTER TABLE employees ADD COLUMN IF NOT EXISTS weekly_capacity_hours NUMERIC(4,1) NOT NULL DEFAULT 40;

-- ---------- project tasks: assignee, estimate, review, completed_at -
-- The updated_at trigger is paused so the backfill below does not make every
-- old task look "recently touched".
ALTER TABLE project_tasks DISABLE TRIGGER trg_tasks_updated_at;

ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS estimate_hours NUMERIC(5,1);
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

UPDATE project_tasks SET completed_at = updated_at WHERE status = 'done' AND completed_at IS NULL;
UPDATE project_tasks SET assigned_to = created_by WHERE assigned_to IS NULL;

ALTER TABLE project_tasks ENABLE TRIGGER trg_tasks_updated_at;

DO $$
DECLARE c TEXT;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.project_tasks'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.project_tasks DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE project_tasks
  ADD CONSTRAINT project_tasks_status_check CHECK (status IN ('todo', 'in_progress', 'review', 'done'));

CREATE OR REPLACE FUNCTION set_task_completed_at() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'done' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'done' THEN
      NEW.completed_at := now();
    END IF;
  ELSE
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tasks_completed_at ON project_tasks;
CREATE TRIGGER trg_tasks_completed_at
  BEFORE INSERT OR UPDATE ON project_tasks
  FOR EACH ROW EXECUTE FUNCTION set_task_completed_at();

-- Assignees (and anyone assigned to the project) can move a task, not just
-- its creator.
DROP POLICY IF EXISTS "tasks_update" ON project_tasks;
CREATE POLICY "tasks_update" ON project_tasks FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR assigned_to = auth.uid()
    OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = project_tasks.project_id AND pa.employee_id = auth.uid()
    )
  );

-- ---------- employee tasks: estimate + assignee can update ----------
ALTER TABLE employee_tasks ADD COLUMN IF NOT EXISTS estimate_hours NUMERIC(5,1);

DROP POLICY IF EXISTS "employee_tasks_update" ON employee_tasks;
CREATE POLICY "employee_tasks_update" ON employee_tasks FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR assigned_to = auth.uid()
    OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin')
  );

-- ---------- milestones ----------------------------------------------
CREATE TABLE IF NOT EXISTS project_milestones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  start_date   DATE,
  due_date     DATE NOT NULL,
  completed_at TIMESTAMPTZ,
  position     INTEGER NOT NULL DEFAULT 0,
  created_by   UUID NOT NULL REFERENCES employees(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE project_milestones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "milestones_select" ON project_milestones;
CREATE POLICY "milestones_select" ON project_milestones FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "milestones_write" ON project_milestones;
CREATE POLICY "milestones_write" ON project_milestones FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = project_milestones.project_id AND pa.employee_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_milestones.project_id AND p.created_by = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = project_milestones.project_id AND pa.employee_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_milestones.project_id AND p.created_by = auth.uid())
  );

-- ---------- time tracking -------------------------------------------
CREATE TABLE IF NOT EXISTS time_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id  UUID REFERENCES projects(id) ON DELETE CASCADE,
  task_id     UUID REFERENCES project_tasks(id) ON DELETE SET NULL,
  note        TEXT,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS time_entries_employee_started ON time_entries (employee_id, started_at DESC);
CREATE INDEX IF NOT EXISTS time_entries_project ON time_entries (project_id);
-- one running timer per person
CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_running ON time_entries (employee_id) WHERE ended_at IS NULL;

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "time_entries_select" ON time_entries;
CREATE POLICY "time_entries_select" ON time_entries FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "time_entries_write" ON time_entries;
CREATE POLICY "time_entries_write" ON time_entries FOR ALL TO authenticated
  USING (employee_id = auth.uid() OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (employee_id = auth.uid() OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin'));

-- ---------- notifications -------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('task_assigned', 'blocker', 'project_assigned', 'blocker_resolved')),
  title        TEXT NOT NULL,
  body         TEXT,
  project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,
  task_id      UUID,
  actor_id     UUID REFERENCES employees(id) ON DELETE SET NULL,
  read_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_recipient ON notifications (recipient_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_select" ON notifications;
CREATE POLICY "notifications_select" ON notifications FOR SELECT TO authenticated USING (recipient_id = auth.uid());
DROP POLICY IF EXISTS "notifications_update" ON notifications;
CREATE POLICY "notifications_update" ON notifications FOR UPDATE TO authenticated
  USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());
DROP POLICY IF EXISTS "notifications_delete" ON notifications;
CREATE POLICY "notifications_delete" ON notifications FOR DELETE TO authenticated USING (recipient_id = auth.uid());
-- no INSERT policy on purpose: only the SECURITY DEFINER triggers below write here.

CREATE OR REPLACE FUNCTION notify_task_assignment() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL
     AND NEW.assigned_to IS DISTINCT FROM NEW.created_by
     AND NEW.assigned_to IS DISTINCT FROM auth.uid()
     AND (TG_OP = 'INSERT' OR OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) THEN
    INSERT INTO notifications (recipient_id, type, title, body, project_id, task_id, actor_id)
    VALUES (
      NEW.assigned_to, 'task_assigned', 'Assigned to you: ' || NEW.title,
      (SELECT title FROM projects WHERE id = NEW.project_id),
      NEW.project_id, NEW.id, auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_task_assignment ON project_tasks;
CREATE TRIGGER trg_notify_task_assignment
  AFTER INSERT OR UPDATE OF assigned_to ON project_tasks
  FOR EACH ROW EXECUTE FUNCTION notify_task_assignment();

CREATE OR REPLACE FUNCTION notify_blocker() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.update_type = 'blocker' THEN
    INSERT INTO notifications (recipient_id, type, title, body, project_id, actor_id)
    SELECT r.id, 'blocker', 'Blocker: ' || NEW.title,
           (SELECT title FROM projects WHERE id = NEW.project_id),
           NEW.project_id, NEW.created_by
    FROM (
      SELECT id FROM employees WHERE role = 'admin'
      UNION
      SELECT employee_id FROM project_assignments WHERE project_id = NEW.project_id
    ) AS r(id)
    WHERE r.id IS DISTINCT FROM NEW.created_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_blocker ON project_updates;
CREATE TRIGGER trg_notify_blocker
  AFTER INSERT ON project_updates
  FOR EACH ROW EXECUTE FUNCTION notify_blocker();

CREATE OR REPLACE FUNCTION notify_blocker_resolved() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.update_type = 'blocker'
     AND OLD.resolved_at IS NULL AND NEW.resolved_at IS NOT NULL
     AND NEW.created_by IS DISTINCT FROM NEW.resolved_by THEN
    INSERT INTO notifications (recipient_id, type, title, body, project_id, actor_id)
    VALUES (
      NEW.created_by, 'blocker_resolved', 'Blocker resolved: ' || NEW.title,
      (SELECT title FROM projects WHERE id = NEW.project_id),
      NEW.project_id, NEW.resolved_by
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_blocker_resolved ON project_updates;
CREATE TRIGGER trg_notify_blocker_resolved
  AFTER UPDATE OF resolved_at ON project_updates
  FOR EACH ROW EXECUTE FUNCTION notify_blocker_resolved();

CREATE OR REPLACE FUNCTION notify_project_assignment() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.employee_id IS DISTINCT FROM auth.uid() THEN
    INSERT INTO notifications (recipient_id, type, title, body, project_id, actor_id)
    VALUES (
      NEW.employee_id, 'project_assigned',
      'You were added to ' || (SELECT title FROM projects WHERE id = NEW.project_id),
      NULL, NEW.project_id, auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_project_assignment ON project_assignments;
CREATE TRIGGER trg_notify_project_assignment
  AFTER INSERT ON project_assignments
  FOR EACH ROW EXECUTE FUNCTION notify_project_assignment();

-- ---------- blockers: the project's creator can resolve them too ----------
DROP POLICY IF EXISTS "updates_update" ON project_updates;
CREATE POLICY "updates_update" ON project_updates FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = project_updates.project_id AND pa.employee_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_updates.project_id AND p.created_by = auth.uid())
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin')
    OR EXISTS (
      SELECT 1 FROM project_assignments pa
      WHERE pa.project_id = project_updates.project_id AND pa.employee_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM projects p WHERE p.id = project_updates.project_id AND p.created_by = auth.uid())
  );

-- ---------- employees: only admins may change role or weekly capacity ------
-- "employees_update" lets anyone edit their own row; without this a member could
-- promote themselves to admin. Server-side calls (service role) have no auth.uid()
-- and are not affected.
CREATE OR REPLACE FUNCTION guard_employee_privileged_columns() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.weekly_capacity_hours IS DISTINCT FROM OLD.weekly_capacity_hours)
     AND auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM employees WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Only admins can change an employee''s role or weekly capacity';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_employee_columns ON employees;
CREATE TRIGGER trg_guard_employee_columns
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION guard_employee_privileged_columns();
