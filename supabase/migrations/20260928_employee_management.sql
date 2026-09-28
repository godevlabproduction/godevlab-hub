-- Lets admins deactivate a member (blocks login, keeps all their history
-- intact) as the safe default next to a real delete, which Postgres will
-- refuse for anyone who has ever created a project/task/update/etc. (those
-- foreign keys have no ON DELETE clause, i.e. RESTRICT).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
