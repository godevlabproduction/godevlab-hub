// The CLAUDE.md block a person pastes into a project so their Claude Code
// session reports progress, tasks and commits back to the Hub.
export function buildSyncSnippet(projectTitle: string, token: string, baseUrl: string): string {
  return `## GoDevLab Hub — live sync

This project (\`${projectTitle}\`) is registered with GoDevLab Hub. This token is yours alone — every update it posts is automatically attributed to you, so there's no field to fill in for who's working. After finishing each meaningful task, milestone, bug fix, or decision, post a progress update:

\`\`\`bash
curl -s -X POST ${baseUrl}/api/sync/update \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${token}","title":"<short title>","details":"<1-3 sentences on what changed>","update_type":"progress"}'
\`\`\`

Use \`update_type\`: \`"progress"\` (default), \`"blocker"\`, \`"decision"\`, or \`"note"\`.

You can also keep the project's own info current as you learn more:

Set/replace the project description:
\`\`\`bash
curl -s -X POST ${baseUrl}/api/sync/project \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${token}","description":"<what this project is>"}'
\`\`\`

Report the current commit (run this after each commit you make in this project, so the Hub shows which commit is live):
\`\`\`bash
curl -s -X POST ${baseUrl}/api/sync/project \\
  -H "Content-Type: application/json" \\
  -d "{\\"token\\":\\"${token}\\",\\"commit_sha\\":\\"$(git rev-parse HEAD)\\",\\"commit_message\\":\\"$(git log -1 --format=%s)\\"}"
\`\`\`

Add a task (the response includes \`task_id\` — hold onto it to update the task's status later). The task is assigned to you, and \`estimate_hours\` (optional, e.g. 1.5) feeds the team's capacity planning:
\`\`\`bash
curl -s -X POST ${baseUrl}/api/sync/task \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${token}","title":"<task title>","details":"<optional details>","due_date":"<optional YYYY-MM-DD>","estimate_hours":1.5}'
\`\`\`

Update a task's status (\`status\` is one of \`todo\`, \`in_progress\`, \`review\`, \`done\`):
\`\`\`bash
curl -s -X POST ${baseUrl}/api/sync/task/status \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${token}","task_id":"<task_id from above>","status":"done"}'
\`\`\`

Lost track of a task's id? List every task on this project (id, title, status):
\`\`\`bash
curl -s "${baseUrl}/api/sync/tasks?token=${token}"
\`\`\`

Delete a task you created (e.g. a throwaway/test one):
\`\`\`bash
curl -s -X POST ${baseUrl}/api/sync/task/delete \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${token}","task_id":"<task_id>"}'
\`\`\`

For a note (visible in this project's own Notes section, not the global Notes page), use the progress-update endpoint above with \`"update_type":"note"\`.

Task timing matters. When you're handed a batch of work items — a checklist, an audit's findings, a multi-item list — create a \`/api/sync/task\` entry for every item before writing any code for it. Mark each one done via \`/api/sync/task/status\` right when it's actually verified working, not saved up for a batch update at the end. A single one-off request doesn't need this ceremony; a list does.`;
}
