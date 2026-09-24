"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays, format, formatDistanceToNowStrict, parseISO, startOfDay } from "date-fns";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { deleteProject, getSyncTokenStatus, updateProject } from "@/lib/supabase/queries";
import type { ProjectPriority, ProjectStatus } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AvatarStack, HealthPill } from "@/components/hub-ui";
import { cn } from "@/lib/utils";
import { fieldCls, labelCls } from "./form-styles";
import { TaskDialog } from "./task-dialog";
import type { Cockpit } from "./use-cockpit";

export const COCKPIT_TABS = [
  { key: "overview", label: "Overview" },
  { key: "board", label: "Board" },
  { key: "timeline", label: "Timeline" },
  { key: "activity", label: "Activity" },
  { key: "docs", label: "Docs & links" },
  { key: "access", label: "Access" },
  { key: "sync", label: "Sync" },
] as const;

const chipCls = "inline-flex h-7 items-center gap-1.5 rounded-full border border-foreground/15 px-3 text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground";

const STATUS_STYLE: Record<ProjectStatus, string> = {
  backlog: "bg-foreground/10 text-muted-foreground",
  active: "bg-info-soft text-info",
  review: "bg-violet-soft text-violet",
  completed: "bg-ok-soft text-ok",
};

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <div className="mt-1 flex items-center gap-2 text-[13.5px] font-semibold text-foreground">{children}</div>
    </div>
  );
}

export function CockpitHeader({ cockpit, tab, onTab }: { cockpit: Cockpit; tab: string; onTab: (tab: string) => void }) {
  const { project, health, team, tasks, canEdit, canDelete, isAdmin, isAssigned } = cockpit;
  const [taskOpen, setTaskOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const canSync = isAdmin || isAssigned;
  const { data: sync } = useQuery({
    queryKey: ["sync-token-status", project?.id],
    queryFn: () => getSyncTokenStatus(project!.id),
    enabled: Boolean(project) && canSync,
  });

  if (!project || !health) return null;

  const today = startOfDay(new Date());
  const due = project.due_date ? parseISO(project.due_date) : null;
  const left = due ? differenceInCalendarDays(due, today) : null;
  const dueNote = left === null ? "No due date" : left < 0 ? `${-left} days overdue` : left === 0 ? "due today" : `in ${left} days`;
  const extraLinks = (project.links ?? []).slice(0, 3);

  return (
    <section aria-label="Project header" className="glass-panel px-6 pt-5">
      <nav aria-label="Breadcrumb" className="text-[12.5px] text-muted-foreground">
        <Link href="/dashboard/projects" className="hover:text-foreground">Projects</Link>
        <span className="px-2">/</span>
        <span className="text-foreground/80">{project.title}</span>
      </nav>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="font-heading text-[28px] font-bold leading-tight tracking-tight text-foreground">{project.title}</h1>
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold capitalize", STATUS_STYLE[project.status])}>{project.status}</span>
          <HealthPill state={health.state} label={health.label} title={health.reasons.join(" · ")} />
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <>
              <Button type="button" variant="outline" onClick={() => setEditOpen(true)}><Pencil className="mr-2 h-3.5 w-3.5" />Edit</Button>
              <Button type="button" onClick={() => setTaskOpen(true)}><Plus className="mr-2 h-3.5 w-3.5" />Add task</Button>
            </>
          )}
          {canDelete && (
            <Button type="button" variant="ghost" size="icon" aria-label="Delete project" className="text-muted-foreground hover:text-bad" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {project.description && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{project.description}</p>}

      <div className="mt-5 flex flex-wrap gap-x-9 gap-y-3">
        <Meta label="Client">{project.client?.name ?? project.client_name ?? "Internal"}</Meta>
        <Meta label="Team"><AvatarStack people={team} size={28} max={5} /></Meta>
        <Meta label="Due">
          {due ? format(due, "d MMM yyyy") : "-"}
          <span className={cn("text-xs font-normal", left !== null && left < 0 ? "font-semibold text-bad" : "text-muted-foreground")}>{dueNote}</span>
        </Meta>
        <Meta label="Priority"><span className="capitalize">{project.priority}</span></Meta>
        <Meta label="Started">{format(parseISO(project.start_date ?? project.created_at), "d MMM yyyy")}</Meta>
        {project.stack.length > 0 && (
          <Meta label="Stack">
            <span className="flex flex-wrap gap-1.5">
              {project.stack.map(s => <span key={s} className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11.5px] font-medium text-muted-foreground">{s}</span>)}
            </span>
          </Meta>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {project.repo_url && <a href={project.repo_url} target="_blank" rel="noopener noreferrer" className={chipCls}>Repository<ExternalLink className="h-3 w-3" aria-hidden /></a>}
        {project.deployed_url && <a href={project.deployed_url} target="_blank" rel="noopener noreferrer" className={chipCls}>Production<ExternalLink className="h-3 w-3" aria-hidden /></a>}
        {extraLinks.map((l, i) => <a key={`${l.url}-${i}`} href={l.url} target="_blank" rel="noopener noreferrer" className={chipCls}>{l.label}<ExternalLink className="h-3 w-3" aria-hidden /></a>)}
        <button
          type="button"
          onClick={() => onTab("sync")}
          className={cn(chipCls, "ml-auto", sync?.exists && "border-ok/40 bg-ok-soft text-ok hover:bg-ok-soft hover:text-ok")}
        >
          <span className={cn("size-1.5 rounded-full", sync?.exists ? "bg-ok" : "bg-muted-foreground")} aria-hidden />
          {sync?.exists ? "Live sync connected" : canSync ? "Set up live sync" : "Live sync"}
          {project.last_synced_at && <span className="opacity-70">· {formatDistanceToNowStrict(parseISO(project.last_synced_at), { addSuffix: true })}</span>}
        </button>
      </div>

      <div role="tablist" aria-label="Project sections" className="mt-4 flex gap-1 overflow-x-auto border-t border-border">
        {COCKPIT_TABS.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls={`panel-${t.key}`}
            onClick={() => onTab(t.key)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 font-mono text-[12.5px] font-medium transition-colors",
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.key === "board" && <span className="rounded-full bg-foreground/10 px-1.5 py-px text-[10.5px] text-muted-foreground">{tasks.length}</span>}
          </button>
        ))}
      </div>

      <TaskDialog cockpit={cockpit} open={taskOpen} onOpenChange={setTaskOpen} task={null} />
      <EditDialog cockpit={cockpit} open={editOpen} onOpenChange={setEditOpen} />
      <DeleteDialog cockpit={cockpit} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </section>
  );
}

function EditDialog({ cockpit, open, onOpenChange }: { cockpit: Cockpit; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        {/* mounted only while open, so every open starts from the project's current values */}
        <EditForm cockpit={cockpit} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ cockpit, onOpenChange }: { cockpit: Cockpit; onOpenChange: (o: boolean) => void }) {
  const supabase = createClient();
  const { project, clients, invalidate } = cockpit;
  const [title, setTitle] = useState(project?.title ?? "");
  const [clientId, setClientId] = useState(project?.client_id ?? "");
  const [clientText, setClientText] = useState(project?.client_id ? "" : (project?.client_name ?? ""));
  const [description, setDescription] = useState(project?.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "active");
  const [priority, setPriority] = useState<ProjectPriority>(project?.priority ?? "medium");
  const [start, setStart] = useState(project?.start_date ?? project?.created_at.slice(0, 10) ?? "");
  const [due, setDue] = useState(project?.due_date ?? "");
  const [repo, setRepo] = useState(project?.repo_url ?? "");
  const [deployed, setDeployed] = useState(project?.deployed_url ?? "");
  const [stack, setStack] = useState(project?.stack.join(", ") ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      if (start && due && start > due) throw new Error("The start date is after the due date.");
      const picked = clients.find(c => c.id === clientId);
      await updateProject(supabase, project!.id, {
        title: title.trim(),
        client_id: picked?.id ?? null,
        client_name: picked?.name ?? (clientText.trim() || null),
        description: description.trim() || null,
        status,
        priority,
        start_date: start || null,
        due_date: due || null,
        repo_url: repo.trim() || null,
        deployed_url: deployed.trim() || null,
        stack: stack.split(",").map(s => s.trim()).filter(Boolean),
      });
    },
    onSuccess: () => { invalidate(["projects"]); onOpenChange(false); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <>
        <DialogHeader><DialogTitle>Edit project</DialogTitle></DialogHeader>
        <form onSubmit={e => { e.preventDefault(); if (title.trim()) save.mutate(); }} className="space-y-3">
          <div>
            <label htmlFor="p-title" className={labelCls}>Title</label>
            <Input id="p-title" value={title} onChange={e => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="p-client" className={labelCls}>Client</label>
              <select id="p-client" className={fieldCls} value={clientId} onChange={e => setClientId(e.target.value)}>
                <option value="">No client</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="p-client-text" className={labelCls}>Or a free-text name</label>
              <Input id="p-client-text" value={clientText} disabled={Boolean(clientId)} onChange={e => setClientText(e.target.value)} placeholder="Internal, a prospect…" />
            </div>
            <div>
              <label htmlFor="p-status" className={labelCls}>Status</label>
              <select id="p-status" className={fieldCls} value={status} onChange={e => setStatus(e.target.value as ProjectStatus)}>
                {(["backlog", "active", "review", "completed"] as ProjectStatus[]).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="p-priority" className={labelCls}>Priority</label>
              <select id="p-priority" className={fieldCls} value={priority} onChange={e => setPriority(e.target.value as ProjectPriority)}>
                {(["low", "medium", "high"] as ProjectPriority[]).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="p-start" className={labelCls}>Start date</label>
              <input id="p-start" type="date" className={fieldCls} value={start} onChange={e => setStart(e.target.value)} />
            </div>
            <div>
              <label htmlFor="p-due" className={labelCls}>Due date</label>
              <input id="p-due" type="date" className={fieldCls} value={due} onChange={e => setDue(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="p-desc" className={labelCls}>Description</label>
            <Textarea id="p-desc" rows={3} value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="p-repo" className={labelCls}>Repository URL</label>
              <Input id="p-repo" value={repo} onChange={e => setRepo(e.target.value)} placeholder="https://github.com/…" />
            </div>
            <div>
              <label htmlFor="p-deployed" className={labelCls}>Production URL</label>
              <Input id="p-deployed" value={deployed} onChange={e => setDeployed(e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <div>
            <label htmlFor="p-stack" className={labelCls}>Stack (comma separated)</label>
            <Input id="p-stack" value={stack} onChange={e => setStack(e.target.value)} placeholder="Next.js, Supabase, Tailwind" />
          </div>
          {error && <p className="text-xs text-bad">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!title.trim() || save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</Button>
          </div>
        </form>
    </>
  );
}

function DeleteDialog({ cockpit, open, onOpenChange }: { cockpit: Cockpit; open: boolean; onOpenChange: (o: boolean) => void }) {
  const supabase = createClient();
  const router = useRouter();
  const { project, invalidate } = cockpit;
  const remove = useMutation({
    mutationFn: () => deleteProject(supabase, project!.id),
    onSuccess: () => {
      invalidate(["projects"], ["project-tasks"], ["open-blockers"]);
      router.push("/dashboard/projects");
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Delete project?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          This permanently deletes &quot;{project?.title}&quot; and everything attached to it: tasks, updates, milestones, logged time, credentials, links and sync tokens. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? "Deleting…" : "Delete permanently"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
