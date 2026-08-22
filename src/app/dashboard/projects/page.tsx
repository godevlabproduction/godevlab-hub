"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { CalendarDays, CheckSquare2, Copy, ExternalLink, Eye, EyeOff, FolderKanban, KeyRound, Link2, ListTodo, PlusCircle, Radio, RefreshCw, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getProjects, getAllProjectTasks, getProjectUpdates,
  createProject, updateProject, createProjectTask, updateProjectTask,
  deleteProjectTask, createProjectUpdate, deleteProjectUpdate,
  getProjectCredentials, createProjectCredential, deleteProjectCredential,
  getSyncTokenStatus, generateSyncToken,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import type { ProjectStatus, ProjectPriority, ProjectLink, TaskStatus } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const selectCls = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

function buildSyncSnippet(projectTitle: string, token: string): string {
  return `## GoDevLab Hub — live sync

This project (\`${projectTitle}\`) is registered with GoDevLab Hub. After finishing each meaningful task, milestone, bug fix, or decision, post a progress update:

\`\`\`bash
curl -s -X POST http://localhost:3000/api/sync/update \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${token}","employee_email":"<your email>","title":"<short title>","details":"<1-3 sentences on what changed>","update_type":"progress"}'
\`\`\`

\`employee_email\` is optional but recommended when more than one person works on this project — it attributes the update to you specifically (unverified — just fill in your own GoDevLab Hub email). Omit it and updates are attributed to whoever set up this project's sync.

Use \`update_type\`: \`"progress"\` (default), \`"blocker"\`, \`"decision"\`, or \`"note"\`.

This requires the GoDevLab Hub dev server (\`npm run dev\`) running on this laptop to receive updates.`;
}

const statusStyles: Record<ProjectStatus, string> = {
  backlog: "border-gray-200 bg-gray-100 text-gray-700",
  active: "border-sky-200 bg-sky-100 text-sky-700",
  review: "border-amber-200 bg-amber-100 text-amber-700",
  completed: "border-emerald-200 bg-emerald-100 text-emerald-700",
};
const taskStyles: Record<TaskStatus, string> = {
  todo: "border-gray-200 bg-gray-100 text-gray-700",
  in_progress: "border-blue-200 bg-blue-100 text-blue-700",
  done: "border-emerald-200 bg-emerald-100 text-emerald-700",
};

export default function ProjectsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: employee } = useCurrentEmployee();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);

  const [projectTitle, setProjectTitle] = useState("");
  const [projectSlug, setProjectSlug] = useState("");
  const [projectClientName, setProjectClientName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>("active");
  const [projectPriority, setProjectPriority] = useState<ProjectPriority>("medium");
  const [projectDueDate, setProjectDueDate] = useState("");
  const [projectRepoPath, setProjectRepoPath] = useState("");
  const [projectRepoUrl, setProjectRepoUrl] = useState("");
  const [projectStack, setProjectStack] = useState("");

  const [taskTitle, setTaskTitle] = useState("");
  const [taskDetails, setTaskDetails] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");

  const [addingLink, setAddingLink] = useState(false);
  const [linkLabel, setLinkLabel] = useState("");
  const [linkUrl, setLinkUrl] = useState("");

  const [addingCred, setAddingCred] = useState(false);
  const [credService, setCredService] = useState("");
  const [credUsername, setCredUsername] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [syncToken, setSyncToken] = useState<string | null>(null);
  const [regenerateDialogOpen, setRegenerateDialogOpen] = useState(false);
  const [syncGenerateError, setSyncGenerateError] = useState<string | null>(null);
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopiedIndex(key);
    setTimeout(() => setCopiedIndex(null), 1500);
  }

  const [noteText, setNoteText] = useState("");

  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => getProjects(supabase) });
  const { data: allTasks = [] } = useQuery({ queryKey: ["project-tasks"], queryFn: () => getAllProjectTasks(supabase) });
  const { data: projectUpdates = [] } = useQuery({
    queryKey: ["project-updates", selectedProjectId],
    queryFn: () => getProjectUpdates(supabase, selectedProjectId!),
    enabled: Boolean(selectedProjectId),
  });

  useEffect(() => {
    if (projects.length === 0) { setSelectedProjectId(null); return; }
    if (!selectedProjectId || !projects.some(p => p.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId) ?? null, [projects, selectedProjectId]);
  const { data: projectCredentials = [] } = useQuery({
    queryKey: ["project_credentials", selectedProjectId],
    queryFn: () => getProjectCredentials(supabase, selectedProjectId!),
    enabled: Boolean(selectedProjectId),
  });
  const { data: syncStatus } = useQuery({
    queryKey: ["sync-token-status", selectedProjectId],
    queryFn: () => getSyncTokenStatus(selectedProjectId!),
    enabled: Boolean(selectedProjectId),
  });
  useEffect(() => {
    setSyncToken(null);
    setSyncGenerateError(null);
  }, [selectedProjectId]);
  const selectedTasks = useMemo(() => allTasks.filter(t => t.project_id === selectedProjectId), [allTasks, selectedProjectId]);
  const taskStats = useMemo(() => {
    const done = selectedTasks.filter(t => t.status === "done").length;
    const inProgress = selectedTasks.filter(t => t.status === "in_progress").length;
    const total = selectedTasks.length;
    const isCompleted = selectedProject?.status === "completed";
    return { total, done, inProgress, todo: total - done - inProgress, completion: isCompleted ? 100 : (total === 0 ? 0 : Math.round((done / total) * 100)) };
  }, [selectedTasks, selectedProject?.status]);

  const createProjectMutation = useMutation({
    mutationFn: () => createProject(supabase, {
      slug: projectSlug || projectTitle.toLowerCase().replace(/\s+/g, "-"),
      title: projectTitle,
      client_name: projectClientName || undefined,
      description: projectDescription || undefined,
      status: projectStatus,
      priority: projectPriority,
      due_date: projectDueDate || undefined,
      repo_path: projectRepoPath || undefined,
      repo_url: projectRepoUrl || undefined,
      stack: projectStack ? projectStack.split(",").map(s => s.trim()).filter(Boolean) : [],
      created_by: employee!.id,
    }),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setSelectedProjectId(project.id);
      setProjectTitle(""); setProjectSlug(""); setProjectClientName(""); setProjectDescription("");
      setProjectStatus("active"); setProjectPriority("medium"); setProjectDueDate("");
      setProjectRepoPath(""); setProjectRepoUrl(""); setProjectStack("");
      setProjectDialogOpen(false);
      generateSyncTokenMutation.mutate(project.id);
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: (input: Parameters<typeof updateProject>[2] & { projectId: string }) => {
      const { projectId, ...rest } = input;
      return updateProject(supabase, projectId, rest);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });

  const createCredentialMutation = useMutation({
    mutationFn: (input: { service: string; username: string; password: string }) =>
      createProjectCredential(supabase, { project_id: selectedProject!.id, created_by: employee!.id, ...input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project_credentials", selectedProjectId] }),
  });
  const deleteCredentialMutation = useMutation({
    mutationFn: (credentialId: string) => deleteProjectCredential(supabase, credentialId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project_credentials", selectedProjectId] }),
  });
  const generateSyncTokenMutation = useMutation({
    mutationFn: (projectId?: string) => generateSyncToken(projectId ?? selectedProject!.id),
    onSuccess: (data) => {
      setSyncToken(data.token);
      setRegenerateDialogOpen(false);
      setSyncGenerateError(null);
      queryClient.invalidateQueries({ queryKey: ["sync-token-status", data.projectId] });
    },
    onError: (err: Error) => setSyncGenerateError(err.message),
  });

  const createTaskMutation = useMutation({
    mutationFn: () => createProjectTask(supabase, { project_id: selectedProjectId!, title: taskTitle, details: taskDetails || undefined, due_date: taskDueDate || undefined, created_by: employee!.id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["project-tasks"] });
      if (selectedProject) {
        const updates: Parameters<typeof updateProject>[2] = {};
        if (selectedProject.status === "completed" || selectedProject.status === "backlog") {
          updates.status = "active";
        }
        const allDates = [...selectedTasks.map(t => t.due_date), taskDueDate || null].filter(Boolean) as string[];
        if (allDates.length > 0) {
          updates.due_date = allDates.sort().at(-1)!;
        }
        if (Object.keys(updates).length > 0) {
          await updateProject(supabase, selectedProject.id, updates);
          queryClient.invalidateQueries({ queryKey: ["projects"] });
        }
      }
      setTaskTitle(""); setTaskDetails(""); setTaskDueDate("");
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) => updateProjectTask(supabase, taskId, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-tasks"] }),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => deleteProjectTask(supabase, taskId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-tasks"] }),
  });

  const createUpdateMutation = useMutation({
    mutationFn: () => createProjectUpdate(supabase, {
      project_id: selectedProjectId!,
      title: noteText.slice(0, 80),
      details: noteText,
      update_type: "note",
      created_by: employee!.id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-updates", selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ["recent-updates"] });
      setNoteText("");
    },
  });

  const deleteUpdateMutation = useMutation({
    mutationFn: (updateId: string) => deleteProjectUpdate(supabase, updateId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-updates", selectedProjectId] });
      queryClient.invalidateQueries({ queryKey: ["recent-updates"] });
    },
  });

  const canCreate = Boolean(projectTitle.trim() && employee);
  const canCreateTask = Boolean(selectedProjectId && taskTitle.trim() && employee);
  const canManage = (createdBy: string) => employee?.role === "admin" || createdBy === employee?.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create projects, break them into tasks, and log progress.</p>
        </div>
        <Dialog open={projectDialogOpen} onOpenChange={(open) => setProjectDialogOpen(open)}>
          <DialogTrigger className={cn(buttonVariants(), "bg-brand-700 hover:bg-brand-800")}>
            <PlusCircle className="mr-2 h-4 w-4" />New Project
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create Project</DialogTitle></DialogHeader>
            <form onSubmit={e => { e.preventDefault(); if (canCreate) createProjectMutation.mutate(); }} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Title</label>
                  <Input value={projectTitle} onChange={e => setProjectTitle(e.target.value)} placeholder="Wedding Photo Upload" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Slug</label>
                  <Input value={projectSlug} onChange={e => setProjectSlug(e.target.value)} placeholder="auto-generated" />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Client name</label>
                <Input value={projectClientName} onChange={e => setProjectClientName(e.target.value)} placeholder="Client" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Description</label>
                <Textarea value={projectDescription} onChange={e => setProjectDescription(e.target.value)} rows={3} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Status</label>
                  <select value={projectStatus} onChange={e => setProjectStatus(e.target.value as ProjectStatus)} className={selectCls}>
                    {(["backlog","active","review","completed"] as ProjectStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Priority</label>
                  <select value={projectPriority} onChange={e => setProjectPriority(e.target.value as ProjectPriority)} className={selectCls}>
                    {(["low","medium","high"] as ProjectPriority[]).map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Due date</label>
                <Input type="date" value={projectDueDate} onChange={e => setProjectDueDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Local repo path</label>
                <Input value={projectRepoPath} onChange={e => setProjectRepoPath(e.target.value)} placeholder="/Users/filipmicevski/Desktop/svadba" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">GitHub URL</label>
                <Input value={projectRepoUrl} onChange={e => setProjectRepoUrl(e.target.value)} placeholder="https://github.com/..." />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Stack (comma separated)</label>
                <Input value={projectStack} onChange={e => setProjectStack(e.target.value)} placeholder="Next.js, Supabase, TypeScript" />
              </div>
              <Button type="submit" className="w-full bg-brand-700 hover:bg-brand-800" disabled={!canCreate || createProjectMutation.isPending}>
                {createProjectMutation.isPending ? "Creating..." : "Create Project"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Project List</CardTitle>
            <CardDescription>Select a project to review its tasks and activity.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {projects.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-center text-sm text-muted-foreground">No projects yet.</div>
            ) : projects.map(project => {
              const pTasks = allTasks.filter(t => t.project_id === project.id);
              const pDone = pTasks.filter(t => t.status === "done").length;
              const isActive = selectedProjectId === project.id;
              return (
                <button key={project.id} type="button" onClick={() => setSelectedProjectId(project.id)}
                  className={`w-full rounded-2xl border p-4 text-left transition-colors ${isActive ? "border-brand-300 bg-brand-50" : "border-gray-200 bg-white hover:border-gray-300"}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{project.title}</p>
                      {project.client_name && <p className="mt-0.5 text-xs text-muted-foreground">{project.client_name}</p>}
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-1">{project.description || "No description."}</p>
                    </div>
                    <Badge variant="outline" className={statusStyles[project.status]}>{project.status}</Badge>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span className="capitalize">{project.priority} priority</span>
                    <span>{pDone}/{pTasks.length} done</span>
                  </div>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {selectedProject ? (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <FolderKanban className="h-4 w-4 text-brand-700" />
                      <CardTitle>{selectedProject.title}</CardTitle>
                    </div>
                    {selectedProject.client_name && <p className="mt-1 text-sm text-muted-foreground">{selectedProject.client_name}</p>}
                    <CardDescription className="mt-1">{selectedProject.description || "No description."}</CardDescription>
                    {selectedProject.stack.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {selectedProject.stack.map(s => <Badge key={s} variant="outline" className="border-gray-200 bg-gray-50 text-xs text-gray-600">{s}</Badge>)}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3">
                    {[{ label: "Tasks", value: taskStats.total }, { label: "Active", value: taskStats.inProgress }, { label: "Done", value: taskStats.done }].map(s => (
                      <div key={s.label} className="rounded-xl border border-gray-200 px-4 py-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground whitespace-nowrap">{s.label}</p>
                        <p className="mt-2 text-xl font-semibold text-gray-900">{s.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium">Status</label>
                    <select value={selectedProject.status} onChange={e => updateProjectMutation.mutate({ projectId: selectedProject.id, status: e.target.value as ProjectStatus })} className={selectCls}>
                      {(["backlog","active","review","completed"] as ProjectStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-muted-foreground" style={selectedProject.status === "completed" ? { opacity: 0.5 } : {}}>Priority</label>
                    <select disabled={selectedProject.status === "completed"} value={selectedProject.priority} onChange={e => updateProjectMutation.mutate({ projectId: selectedProject.id, priority: e.target.value as ProjectPriority })} className={selectCls + (selectedProject.status === "completed" ? " opacity-50 cursor-not-allowed" : "")}>
                      {(["low","medium","high"] as ProjectPriority[]).map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-muted-foreground" style={selectedProject.status === "completed" ? { opacity: 0.5 } : {}}>Due date</label>
                    <Input disabled={selectedProject.status === "completed"} type="date" value={selectedProject.due_date ?? ""} onChange={e => updateProjectMutation.mutate({ projectId: selectedProject.id, due_date: e.target.value || null })} className={selectedProject.status === "completed" ? "opacity-50 cursor-not-allowed" : ""} />
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Completion</span>
                    <span className="font-medium text-gray-900">{taskStats.completion}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100">
                    <div className="h-2 rounded-full bg-brand-700" style={{ width: `${taskStats.completion}%` }} />
                  </div>
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                      <Link2 className="h-4 w-4 text-brand-700" />
                      Links
                    </div>
                    {!addingLink && (
                      <button type="button" onClick={() => setAddingLink(true)} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 font-medium">
                        <PlusCircle className="h-3.5 w-3.5" /> Add link
                      </button>
                    )}
                  </div>
                  {addingLink && (
                    <form onSubmit={e => {
                      e.preventDefault();
                      if (!linkLabel.trim() || !linkUrl.trim()) return;
                      const updated: ProjectLink[] = [...(selectedProject.links ?? []), { label: linkLabel.trim(), url: linkUrl.trim() }];
                      updateProjectMutation.mutate({ projectId: selectedProject.id, links: updated });
                      setLinkLabel(""); setLinkUrl(""); setAddingLink(false);
                    }} className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <Input autoFocus value={linkLabel} onChange={e => setLinkLabel(e.target.value)} placeholder="Label (e.g. Vercel)" className="h-8 w-32 text-sm" />
                      <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://..." className="h-8 flex-1 min-w-[180px] text-sm" />
                      <Button type="submit" size="sm" disabled={!linkLabel.trim() || !linkUrl.trim()}>Save</Button>
                      <button type="button" onClick={() => { setAddingLink(false); setLinkLabel(""); setLinkUrl(""); }} className="text-muted-foreground hover:text-gray-700"><X className="h-4 w-4" /></button>
                    </form>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {(selectedProject.links ?? []).length === 0 && !addingLink && (
                      <span className="text-xs text-muted-foreground">No links yet.</span>
                    )}
                    {(selectedProject.links ?? []).map((link, i) => (
                      <div key={i} className="group flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-brand-300 hover:bg-brand-50 transition-colors">
                        <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 font-medium">
                          <ExternalLink className="h-3.5 w-3.5 text-brand-700" />
                          {link.label}
                        </a>
                        <button type="button" onClick={() => {
                          const updated = (selectedProject.links ?? []).filter((_, idx) => idx !== i);
                          updateProjectMutation.mutate({ projectId: selectedProject.id, links: updated });
                        }} className="ml-1 hidden group-hover:block text-muted-foreground hover:text-red-500">
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                      <KeyRound className="h-4 w-4 text-brand-700" />
                      Logins & Passwords
                    </div>
                    {!addingCred && (
                      <button type="button" onClick={() => setAddingCred(true)} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:text-brand-800 font-medium">
                        <PlusCircle className="h-3.5 w-3.5" /> Add login
                      </button>
                    )}
                  </div>
                  {addingCred && (
                    <form onSubmit={e => {
                      e.preventDefault();
                      if (!credService.trim() || !credUsername.trim() || !credPassword.trim()) return;
                      createCredentialMutation.mutate({ service: credService.trim(), username: credUsername.trim(), password: credPassword.trim() });
                      setCredService(""); setCredUsername(""); setCredPassword(""); setAddingCred(false);
                    }} className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <Input autoFocus value={credService} onChange={e => setCredService(e.target.value)} placeholder="Service (e.g. Supabase)" className="h-8 w-32 text-sm" />
                      <Input value={credUsername} onChange={e => setCredUsername(e.target.value)} placeholder="Username / Email" className="h-8 flex-1 min-w-[160px] text-sm" />
                      <Input value={credPassword} onChange={e => setCredPassword(e.target.value)} placeholder="Password" type="password" className="h-8 flex-1 min-w-[160px] text-sm" />
                      <Button type="submit" size="sm" disabled={!credService.trim() || !credUsername.trim() || !credPassword.trim()}>Save</Button>
                      <button type="button" onClick={() => { setAddingCred(false); setCredService(""); setCredUsername(""); setCredPassword(""); }} className="text-muted-foreground hover:text-gray-700"><X className="h-4 w-4" /></button>
                    </form>
                  )}
                  {projectCredentials.length === 0 && !addingCred && (
                    <p className="text-xs text-muted-foreground">No logins saved yet.</p>
                  )}
                  <div className="space-y-2">
                    {projectCredentials.map(cred => (
                      <div key={cred.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm">
                        <span className="w-28 shrink-0 font-medium text-gray-900 truncate">{cred.service}</span>
                        <div className="flex flex-1 items-center gap-1.5 min-w-[140px]">
                          <span className="truncate text-muted-foreground">{cred.username}</span>
                          <button type="button" onClick={() => copyToClipboard(cred.username, `u${cred.id}`)} className="shrink-0 text-muted-foreground hover:text-brand-700">
                            {copiedIndex === `u${cred.id}` ? <span className="text-xs text-green-600">Copied</span> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        <div className="flex flex-1 items-center gap-1.5 min-w-[140px]">
                          <span className="truncate font-mono text-muted-foreground">{visiblePasswords[cred.id] ? cred.password : "••••••••"}</span>
                          <button type="button" onClick={() => setVisiblePasswords(v => ({ ...v, [cred.id]: !v[cred.id] }))} className="shrink-0 text-muted-foreground hover:text-gray-700">
                            {visiblePasswords[cred.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                          <button type="button" onClick={() => copyToClipboard(cred.password, `p${cred.id}`)} className="shrink-0 text-muted-foreground hover:text-brand-700">
                            {copiedIndex === `p${cred.id}` ? <span className="text-xs text-green-600">Copied</span> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        <button type="button" onClick={() => deleteCredentialMutation.mutate(cred.id)} className="shrink-0 text-muted-foreground hover:text-red-500">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                      <Radio className="h-4 w-4 text-brand-700" />
                      Live Sync
                    </div>
                  </div>
                  {!syncStatus?.exists && !syncToken && (
                    <Button
                      type="button"
                      size="sm"
                      className="bg-brand-700 hover:bg-brand-800"
                      onClick={() => generateSyncTokenMutation.mutate(undefined)}
                      disabled={generateSyncTokenMutation.isPending}
                    >
                      {generateSyncTokenMutation.isPending ? "Setting up..." : "Set up live sync"}
                    </Button>
                  )}
                  {syncGenerateError && <p className="mt-2 text-xs text-red-600">{syncGenerateError}</p>}
                  {syncToken && (
                    <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                      <p className="text-xs text-muted-foreground">
                        Paste this into the project&apos;s CLAUDE.md. This token is shown only once — copy it now.
                      </p>
                      <Textarea readOnly rows={8} value={buildSyncSnippet(selectedProject.title, syncToken)} className="font-mono text-xs" />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => copyToClipboard(buildSyncSnippet(selectedProject.title, syncToken), "sync-snippet")}
                      >
                        {copiedIndex === "sync-snippet" ? <span className="text-xs text-green-600">Copied</span> : <><Copy className="mr-1.5 h-3.5 w-3.5" />Copy snippet</>}
                      </Button>
                    </div>
                  )}
                  {syncStatus?.exists && !syncToken && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm">
                      <span className="text-xs text-muted-foreground">
                        Live sync active — {syncStatus.regeneratedAt
                          ? `regenerated ${formatDistanceToNow(new Date(syncStatus.regeneratedAt), { addSuffix: true })}`
                          : `set up ${formatDistanceToNow(new Date(syncStatus.createdAt!), { addSuffix: true })}`}
                      </span>
                      <Dialog open={regenerateDialogOpen} onOpenChange={setRegenerateDialogOpen}>
                        <DialogTrigger className={cn(buttonVariants(), "h-8 px-3 text-xs bg-white border border-gray-200 text-gray-700 hover:bg-gray-50")}>
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5 inline" />Regenerate
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader><DialogTitle>Regenerate sync token?</DialogTitle></DialogHeader>
                          <p className="text-sm text-muted-foreground">
                            The current token will stop working immediately. Any project still using it will get rejected (401) until you update it with the new one.
                          </p>
                          <div className="flex justify-end gap-2">
                            <Button type="button" variant="ghost" onClick={() => setRegenerateDialogOpen(false)}>Cancel</Button>
                            <Button
                              type="button"
                              className="bg-red-600 hover:bg-red-700"
                              onClick={() => generateSyncTokenMutation.mutate(undefined)}
                              disabled={generateSyncTokenMutation.isPending}
                            >
                              {generateSyncTokenMutation.isPending ? "Regenerating..." : "Regenerate anyway"}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                  <div className="inline-flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-brand-700" />
                    {selectedProject.due_date ? `Due ${format(new Date(selectedProject.due_date), "MMM d, yyyy")}` : "No due date"}
                  </div>
                  <div className="inline-flex items-center gap-2">
                    <CheckSquare2 className="h-4 w-4 text-brand-700" />
                    Created by {selectedProject.employee?.full_name ?? "Unknown"}
                  </div>
                  {selectedProject.last_synced_at && (
                    <span className="text-xs">Last synced {formatDistanceToNow(new Date(selectedProject.last_synced_at), { addSuffix: true })}</span>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-6 2xl:grid-cols-2">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2"><ListTodo className="h-4 w-4 text-brand-700" /><CardTitle className="text-base">Work Items</CardTitle></div>
                  <CardDescription>Break the project down into concrete tasks.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form onSubmit={e => { e.preventDefault(); if (canCreateTask) createTaskMutation.mutate(); }} className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <Input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="New task title" />
                    <Textarea value={taskDetails} onChange={e => setTaskDetails(e.target.value)} placeholder="Add context or acceptance criteria." rows={3} />
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Input type="date" value={taskDueDate} onChange={e => setTaskDueDate(e.target.value)} />
                      <Button type="submit" className="bg-brand-700 hover:bg-brand-800" disabled={!canCreateTask || createTaskMutation.isPending}>
                        <PlusCircle className="mr-2 h-4 w-4" />Add Task
                      </Button>
                    </div>
                  </form>
                  {selectedTasks.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No tasks yet.</p>
                  ) : selectedTasks.map(task => (
                    <div key={task.id} className="rounded-2xl border border-gray-200 p-4">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-gray-900">{task.title}</p>
                            <Badge variant="outline" className={taskStyles[task.status]}>{task.status.replace("_", " ")}</Badge>
                          </div>
                          {task.details && <p className="mt-2 text-sm text-muted-foreground">{task.details}</p>}
                          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span>{task.employee?.full_name ?? "Unknown"}</span>
                            {task.due_date && <span>Due {format(new Date(task.due_date), "MMM d, yyyy")}</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-start gap-2">
                          <select value={task.status} onChange={e => updateTaskMutation.mutate({ taskId: task.id, status: e.target.value as TaskStatus })} className="flex h-10 w-32 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" disabled={!canManage(task.created_by)}>
                            {(["todo","in_progress","done"] as TaskStatus[]).map(s => <option key={s} value={s}>{s.replace("_"," ")}</option>)}
                          </select>
                          {canManage(task.created_by) && (
                            <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-red-600" onClick={() => deleteTaskMutation.mutate(task.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2"><CheckSquare2 className="h-4 w-4 text-brand-700" /><CardTitle className="text-base">Notes</CardTitle></div>
                  <CardDescription>Team notes and observations for this project.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <form onSubmit={e => { e.preventDefault(); if (noteText.trim()) createUpdateMutation.mutate(); }} className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                    <Textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Write a note..." rows={4} />
                    <Button type="submit" className="bg-brand-700 hover:bg-brand-800" disabled={!noteText.trim() || createUpdateMutation.isPending}>
                      <PlusCircle className="mr-2 h-4 w-4" />Add Note
                    </Button>
                  </form>
                  {projectUpdates.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No notes yet.</p>
                  ) : projectUpdates.map(update => (
                    <div key={update.id} className="rounded-2xl border border-gray-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="text-xs font-semibold text-brand-700">{update.employee?.full_name ?? "Unknown"}</span>
                            <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(update.created_at), { addSuffix: true })}</span>
                          </div>
                          <p className="whitespace-pre-wrap text-sm text-gray-700">{update.details}</p>
                        </div>
                        {canManage(update.created_by) && (
                          <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-red-600 shrink-0" onClick={() => deleteUpdateMutation.mutate(update.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <Card><CardContent className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">Select a project to start tracking work.</CardContent></Card>
        )}
      </div>
    </div>
  );
}
