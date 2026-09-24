"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict, parseISO } from "date-fns";
import { Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  createProject, getAllProjectTasks, getClients, getEmployeeTasks, getEmployees,
  getOpenBlockers, getProjectAssignments, getProjects,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { buildPortfolio, type PortfolioRow } from "@/lib/portfolio";
import { AvatarStack, HealthPill, KpiTile, ProgressBar, healthTone } from "@/components/hub-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fieldCls, labelCls } from "@/components/project/form-styles";
import { cn } from "@/lib/utils";

type Filter = "all" | "active" | "risk" | "backlog" | "completed";

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function dueLine(row: PortfolioRow) {
  const due = row.project.due_date;
  if (!due) return { date: "No due date", note: "", late: false };
  const date = format(parseISO(due), "d MMM yyyy");
  if (row.health.state === "done") return { date, note: "", late: false };
  const left = row.health.daysLeft ?? 0;
  if (left < 0) return { date, note: `${plural(-left, "day")} overdue`, late: true };
  if (left === 0) return { date, note: "due today", late: false };
  return { date, note: `in ${plural(left, "day")}`, late: false };
}

export default function ProjectsPage() {
  const supabase = createClient();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me } = useCurrentEmployee();

  const { data: projects = [], isLoading } = useQuery({ queryKey: ["projects"], queryFn: () => getProjects(supabase), refetchInterval: 30000 });
  const { data: tasks = [] } = useQuery({ queryKey: ["project-tasks"], queryFn: () => getAllProjectTasks(supabase) });
  const { data: employeeTasks = [] } = useQuery({ queryKey: ["employee-tasks"], queryFn: () => getEmployeeTasks(supabase) });
  const { data: assignments = [] } = useQuery({ queryKey: ["project-assignments"], queryFn: () => getProjectAssignments(supabase) });
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: () => getEmployees(supabase) });
  const { data: blockers = [] } = useQuery({ queryKey: ["open-blockers"], queryFn: () => getOpenBlockers(supabase) });
  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => getClients(supabase) });

  const [filter, setFilter] = useState<Filter>("active");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [clientId, setClientId] = useState("");
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { rows } = useMemo(
    () => buildPortfolio({ projects, tasks, employeeTasks, assignments, employees, blockers, now: new Date() }),
    [projects, tasks, employeeTasks, assignments, employees, blockers],
  );

  const counts: Record<Filter, number> = {
    all: rows.length,
    active: rows.filter(r => r.project.status === "active" || r.project.status === "review").length,
    risk: rows.filter(r => r.health.state === "risk" || r.health.state === "late").length,
    backlog: rows.filter(r => r.project.status === "backlog").length,
    completed: rows.filter(r => r.project.status === "completed").length,
  };

  const q = search.trim().toLowerCase();
  const visible = rows.filter(r => {
    const inFilter =
      filter === "all" ? true
      : filter === "active" ? r.project.status === "active" || r.project.status === "review"
      : filter === "risk" ? r.health.state === "risk" || r.health.state === "late"
      : r.project.status === filter;
    if (!inFilter) return false;
    if (!q) return true;
    return `${r.project.title} ${r.project.client?.name ?? r.project.client_name ?? ""}`.toLowerCase().includes(q);
  });

  const create = useMutation({
    mutationFn: async () => {
      const picked = clients.find(c => c.id === clientId);
      const base = slugify(title) || "project";
      for (let attempt = 0; attempt < 3; attempt++) {
        const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
        try {
          return await createProject(supabase, {
            slug,
            title: title.trim(),
            client_id: picked?.id ?? null,
            client_name: picked?.name,
            status: "active",
            priority: "medium",
            due_date: due || undefined,
            created_by: me!.id,
          });
        } catch (e) {
          if ((e as { code?: string }).code !== "23505") throw e;
        }
      }
      throw new Error("Couldn't create a unique link for this project. Try a different title.");
    },
    onSuccess: project => {
      queryClient.setQueryData<typeof projects>(["projects"], old => [project, ...(old ?? [])]);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDialogOpen(false);
      setTitle(""); setClientId(""); setDue("");
      router.push(`/dashboard/projects/${project.id}${me?.role === "admin" ? "#sync" : ""}`);
    },
    onError: (e: Error) => setError(e.message || "Couldn't create the project."),
  });

  const chips: { key: Filter; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "risk", label: "At risk" },
    { key: "backlog", label: "Backlog" },
    { key: "completed", label: "Completed" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every project with its health, progress, team and next deadline.</p>
        </div>
        <Button type="button" onClick={() => { setError(null); setDialogOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />New project
        </Button>
      </div>

      <section aria-label="Project totals" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Active" value={counts.active} sub={`${counts.all} total`} />
        <KpiTile label="At risk or late" value={counts.risk} valueClassName={counts.risk > 0 ? "text-warn" : undefined} sub={counts.risk > 0 ? "Worth a look" : "All on track"} />
        <KpiTile label="Backlog" value={counts.backlog} sub="Not started yet" />
        <KpiTile label="Completed" value={counts.completed} sub="Delivered" />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filter projects" className="flex flex-wrap gap-2">
          {chips.map(c => (
            <button
              key={c.key}
              type="button"
              aria-pressed={filter === c.key}
              onClick={() => setFilter(c.key)}
              className={cn(
                "flex h-8 items-center gap-2 rounded-full border px-3.5 font-mono text-xs font-medium transition-colors",
                filter === c.key ? "border-foreground bg-foreground text-background" : "border-foreground/15 text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              {c.label}
              <span className={cn("text-[11px]", filter === c.key ? "opacity-70" : "text-muted-foreground")}>{counts[c.key]}</span>
            </button>
          ))}
        </div>
        <label className="relative block w-full max-w-xs">
          <span className="sr-only">Search projects</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects or clients" className="h-9 rounded-full pl-9" />
        </label>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading projects…</p>}
      {!isLoading && visible.length === 0 && (
        <p className="glass-panel glass-panel--tile p-6 text-sm text-muted-foreground">
          {rows.length === 0 ? "No projects yet. Create the first one." : "No projects match this view."}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map(r => {
          const d = dueLine(r);
          return (
            <Link
              key={r.project.id}
              href={`/dashboard/projects/${r.project.id}`}
              className="glass-panel glass-panel--tile group flex flex-col gap-4 p-5 outline-none transition-shadow hover:ring-1 hover:ring-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-semibold text-foreground group-hover:text-primary">{r.project.title}</h2>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {r.project.client?.name ?? r.project.client_name ?? "Internal"} · <span className="capitalize">{r.project.priority}</span> priority
                  </p>
                </div>
                <HealthPill state={r.health.state} label={r.health.label} title={r.health.reasons.join(" · ")} />
              </div>

              <div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="font-mono text-[13px] font-semibold text-foreground">{Math.round(r.health.progress * 100)}%</span>
                  <span className="text-xs text-muted-foreground">{r.health.done}/{r.health.total} tasks</span>
                </div>
                <ProgressBar value={r.health.progress} tone={healthTone(r.health.state)} />
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-border pt-3.5">
                <AvatarStack people={r.team} />
                <div className="text-right">
                  <p className="text-[12.5px] font-semibold text-foreground">{d.date}</p>
                  {d.note && <p className={cn("text-xs", d.late ? "font-semibold text-bad" : "text-muted-foreground")}>{d.note}</p>}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className={cn("size-1.5 rounded-full", r.project.last_synced_at ? (r.stale ? "bg-warn" : "bg-ok") : "bg-muted-foreground")} aria-hidden />
                  {r.project.last_synced_at ? `Synced ${formatDistanceToNowStrict(parseISO(r.project.last_synced_at), { addSuffix: true })}` : "Never synced"}
                </span>
                {r.health.openBlockers > 0 && <span className="font-semibold text-warn">{plural(r.health.openBlockers, "blocker")}</span>}
              </div>
            </Link>
          );
        })}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New project</DialogTitle></DialogHeader>
          <form onSubmit={e => { e.preventDefault(); if (title.trim() && me) create.mutate(); }} className="space-y-3">
            <div>
              <label htmlFor="np-title" className={labelCls}>Title</label>
              <Input id="np-title" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Wedding Photo Upload" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="np-client" className={labelCls}>Client</label>
                <select id="np-client" className={fieldCls} value={clientId} onChange={e => setClientId(e.target.value)}>
                  <option value="">No client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="np-due" className={labelCls}>Due date</label>
                <input id="np-due" type="date" className={fieldCls} value={due} onChange={e => setDue(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Everything else (description, team, milestones, links) is added on the project page.</p>
            {error && <p className="text-xs text-bad">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!title.trim() || !me || create.isPending}>{create.isPending ? "Creating…" : "Create project"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
