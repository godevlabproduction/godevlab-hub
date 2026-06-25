# GoDevLab Hub

This is the GoDevLab agency hub. At the start of every session, run the sync script to pull the latest report.json from all registered project directories:

```bash
npm run sync
```

This updates `data/projects/` with the latest state from each project repo and refreshes `last_synced_at` in Supabase.

To add a new project to the sync, add an entry to `projects.config.json`:
```json
{ "slug": "project-slug", "path": "/Users/filipmicevski/Desktop/project-folder" }
```
