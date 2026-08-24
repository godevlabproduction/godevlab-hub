ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_commit_sha TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_commit_message TEXT;
