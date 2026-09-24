"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict, parseISO, subDays } from "date-fns";
import { FolderKanban } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getProjects, getAllProjectTasks, getRecentUpdates, getEmployeeTasks,
  getProjectAssignments, getEmployees, getOpenBlockers, resolveBlocker,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { buildPortfolio, type AttentionItem, type PortfolioRow } from "@/lib/portfolio";
import { formatHours } from "@/lib/planning";
import { useNow } from "@/components/timer-widget";
import {
  Avatar, AvatarStack, HealthPill, KpiTile, PanelHeader, ProgressBar, TypeChip, healthTone, type ChipType,
} from "@/components/hub-ui";
import { Card, CardContent } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Filter = "active" | "mine" | "risk" | "completed";

const COLS =
  "grid grid-cols-[minmax(0,2.3fr)_minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.3fr)_minmax(0,0.6fr)] items-center gap-x-4";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ago = (iso: string) => formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });

function dueInfo(row: PortfolioRow) {
  const due = row.project.due_date;
  if (!due) return { date: "—", note: "No due date", late: false };
  const date = format(parseISO(due), "d MMM");
  if (row.health.state === "done") return { date, note: "Completed", late: false };
  const left = row.health.daysLeft ?? 0;
  if (left < 0) return { date, note: `${plural(-left, "day")} overdue`, late: true };
  if (left === 0) return { date, note: "Due today", late: false };
  return { date, note: `in ${plural(left, "day")}`, late: false };
}

function syncInfo(row: PortfolioRow) {
  const at = row.project.last_synced_at;
  if (!at) return { text: "Never", dot: "bg-muted-foreground" };
  const fresh = Date.now() - parseISO(at).getTime() < 2 * 24 * 3600 * 1000;
  return { text: ago(at), dot: fresh ? "bg-ok" : row.stale ? "bg-warn" : "bg-muted-foreground" };
}

export default function CommandCenterPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: me } = useCurrentEmployee();
  // null on the server and during hydration, so the date text cannot mismatch across time zones
  const now = useNow(60_000);
  const [filter, setFilter] = useState<Filter>("active");
  const [resolveError, setResolveError] = useState<string | null>(null);

  const { data: projects = [], isLoading } = useQuery({ queryKey: ["projects"], queryFn: () => getProjects(supabase), refetchInterval: 30000 });
  const { data: tasks = [] } = useQuery({ queryKey: ["project-tasks"], queryFn: () => getAllProjectTasks(supabase), refetchInterval: 30000 });
  const { data: employeeTasks = [] } = useQuery({ queryKey: ["employee-tasks"], queryFn: () => getEmployeeTasks(supabase) });
  const { data: assignments = [] } = useQuery({ queryKey: ["project-assignments"], queryFn: () => getProjectAssignments(supabase) });
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: () => getEmployees(supabase) });
  const { data: blockers = [] } = useQuery({ queryKey: ["open-blockers"], queryFn: () => getOpenBlockers(supabase), refetchInterval: 30000 });
  const { data: recentUpdates = [] } = useQuery({ queryKey: ["recent-updates", 12], queryFn: () => getRecentUpdates(supabase, 12), refetchInterval: 30000 });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolveBlocker(supabase, id, me!.id),
    onSuccess: () => {
      setResolveError(null);
      queryClient.invalidateQueries({ queryKey: ["open-blockers"] });
    },
    onError: (e: Error) => setResolveError(e.message || "Couldn't resolve that blocker. Try again."),
  });

  const portfolio = useMemo(
    () => buildPortfolio({ projects, tasks, employeeTasks, assignments, employees, blockers, now: new Date() }),
    [projects, tasks, employeeTasks, assignments, employees, blockers],
  );
  const { rows, attention, workload, kpis } = portfolio;

  // Mirrors the "updates_update" policy: the reporter, an admin, someone on the
  // project, or its creator may resolve a blocker.
  const canResolve = (a: AttentionItem) =>
    Boolean(
      me &&
        (me.role === "admin" ||
          a.createdBy === me.id ||
          assignments.some(x => x.project_id === a.projectId && x.employee_id === me.id) ||
          projects.some(p => p.id === a.projectId && p.created_by === me.id)),
    );

  const involvesMe = (r: PortfolioRow) =>
    Boolean(me && (r.project.created_by === me.id || r.team.some(m => m.id === me.id)));

  const counts = {
    active: rows.filter(r => r.health.state !== "done").length,
    mine: rows.filter(r => r.health.state !== "done" && involvesMe(r)).length,
    risk: rows.filter(r => r.health.state === "risk" || r.health.state === "late").length,
    completed: rows.filter(r => r.health.state === "done").length,
  };

  const visible = rows.filter(r => {
    if (filter === "active") return r.health.state !== "done";
    if (filter === "mine") return r.health.state !== "done" && involvesMe(r);
    if (filter === "risk") return r.health.state === "risk" || r.health.state === "late";
    return r.health.state === "done";
  });

  const feed = useMemo(() => {
    const weekAgo = subDays(new Date(), 7).getTime();
    const projectTitle = new Map(projects.map(p => [p.id, p.title]));
    const fromUpdates = recentUpdates.map(u => ({
      id: `u-${u.id}`,
      type: u.update_type as ChipType,
      title: u.title,
      who: u.employee?.full_name ?? "Someone",
      project: u.project?.title ?? "",
      at: u.created_at,
    }));
    const fromTasks = tasks
      .filter(t => t.status === "done" && parseISO(t.completed_at ?? t.updated_at).getTime() >= weekAgo)
      .map(t => ({
        id: `t-${t.id}`,
        type: "done" as ChipType,
        title: t.title,
        who: t.assignee?.full_name ?? t.employee?.full_name ?? "Someone",
        project: projectTitle.get(t.project_id) ?? "",
        at: t.completed_at ?? t.updated_at,
      }));
    return [...fromUpdates, ...fromTasks]
      .sort((a, b) => parseISO(b.at).getTime() - parseISO(a.at).getTime())
      .slice(0, 8);
  }, [recentUpdates, tasks, projects]);

  const maxOpen = Math.max(1, ...workload.map(w => w.openTasks));
  const hasEstimates = workload.some(w => w.openHours > 0);
  const delta = kpis.doneThisWeek - kpis.doneLastWeek;
  const totalHealth = kpis.health.ok + kpis.health.risk + kpis.health.late + kpis.health.none;

  const chips: { key: Filter; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "mine", label: "Mine" },
    { key: "risk", label: "At risk" },
    { key: "completed", label: "Completed" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Command Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {now ? `${format(now, "EEEE, d MMM yyyy")} · ` : ""}{plural(kpis.active, "active project")}
          </p>
        </div>
        <Link href="/dashboard/projects" className={buttonVariants({ variant: "outline" })}>
          <FolderKanban className="mr-2 h-4 w-4" />
          Open Projects
        </Link>
      </div>

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiTile label="Active projects" value={kpis.active} sub={`${kpis.total} total · ${kpis.backlog} in backlog`} />
        <KpiTile label="Portfolio health" sub={
          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{kpis.health.ok} on track</span><span>{kpis.health.risk} at risk</span>
            <span>{kpis.health.late} late</span><span>{kpis.health.none} no plan</span>
          </span>
        }>
          <div
            className="mt-2 flex h-2 gap-0.5"
            role="img"
            aria-label={`${kpis.health.ok} on track, ${kpis.health.risk} at risk, ${kpis.health.late} late, ${kpis.health.none} with no plan`}
          >
            {totalHealth === 0 ? (
              <div className="flex-1 rounded-full bg-foreground/10" />
            ) : (
              <>
                {kpis.health.ok > 0 && <div className="rounded-full bg-ok" style={{ flexGrow: kpis.health.ok }} />}
                {kpis.health.risk > 0 && <div className="rounded-full bg-warn" style={{ flexGrow: kpis.health.risk }} />}
                {kpis.health.late > 0 && <div className="rounded-full bg-bad" style={{ flexGrow: kpis.health.late }} />}
                {kpis.health.none > 0 && <div className="rounded-full bg-muted-foreground/60" style={{ flexGrow: kpis.health.none }} />}
              </>
            )}
          </div>
        </KpiTile>
        <KpiTile
          label="Open blockers"
          value={kpis.openBlockers}
          valueClassName={kpis.openBlockers > 0 ? "text-warn" : undefined}
          sub={kpis.blockerProjects.length > 0 ? kpis.blockerProjects.slice(0, 2).join(" · ") : "Nothing is blocked"}
        />
        <KpiTile
          label="Done last 7 days"
          value={kpis.doneThisWeek}
          sub={
            delta === 0
              ? "Same as the 7 days before"
              : <><span className={cn("font-semibold", delta > 0 ? "text-ok" : "text-warn")}>{delta > 0 ? "▲" : "▼"} {Math.abs(delta)}</span> {delta > 0 ? "more" : "fewer"} than the 7 days before</>
          }
        />
        <KpiTile
          label="Overdue tasks"
          value={kpis.overdueTasks}
          valueClassName={kpis.overdueTasks > 0 ? "text-bad" : undefined}
          sub={kpis.overdueTasks > 0 ? `across ${plural(kpis.overdueProjects, "project")}` : "Everything is on schedule"}
        />
      </section>

      <Card>
        <CardContent>
          <PanelHeader
            title="Portfolio"
            aside={`${visible.length} of ${rows.length} projects`}
          />
          <div role="group" aria-label="Filter projects" className="mb-4 flex flex-wrap gap-2">
            {chips.map(c => (
              <button
                key={c.key}
                type="button"
                aria-pressed={filter === c.key}
                onClick={() => setFilter(c.key)}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-full border px-3.5 font-mono text-xs font-medium transition-colors",
                  filter === c.key
                    ? "border-foreground bg-foreground text-background"
                    : "border-foreground/15 text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                {c.label}
                <span className={cn("text-[11px]", filter === c.key ? "opacity-70" : "text-muted-foreground")}>{counts[c.key]}</span>
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className={cn(COLS, "px-1 pb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground")}>
                <span>Project</span><span>Health</span><span>Progress</span><span>Status</span>
                <span>Team</span><span>Due</span><span>Last sync</span><span>Blockers</span>
              </div>

              {isLoading && <p className="border-t border-border px-1 py-6 text-sm text-muted-foreground">Loading projects…</p>}
              {!isLoading && visible.length === 0 && (
                <p className="border-t border-border px-1 py-6 text-sm text-muted-foreground">
                  {rows.length === 0 ? "No projects yet - create the first one in Projects." : "No projects match this filter."}
                </p>
              )}

              {visible.map(r => {
                const due = dueInfo(r);
                const sync = syncInfo(r);
                return (
                  <div key={r.project.id} className={cn(COLS, "border-t border-border px-1 py-3.5")}>
                    <div className="min-w-0">
                      <Link
                        href={`/dashboard/projects/${r.project.id}`}
                        className="block truncate text-sm font-semibold text-foreground hover:text-primary"
                      >
                        {r.project.title}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {r.project.client_name ?? "Internal"} · <span className="capitalize">{r.project.priority}</span> priority
                      </p>
                    </div>
                    <div><HealthPill state={r.health.state} label={r.health.label} title={r.health.reasons.join(" · ")} /></div>
                    <div>
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <span className="font-mono text-[13px] font-semibold text-foreground">{Math.round(r.health.progress * 100)}%</span>
                        <span className="text-[11.5px] text-muted-foreground">{r.health.done}/{r.health.total} tasks</span>
                      </div>
                      <ProgressBar value={r.health.progress} tone={healthTone(r.health.state)} />
                    </div>
                    <div className="text-[13px] capitalize text-muted-foreground">{r.project.status}</div>
                    <div><AvatarStack people={r.team} /></div>
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">{due.date}</p>
                      <p className={cn("mt-0.5 text-xs", due.late ? "font-semibold text-bad" : "text-muted-foreground")}>{due.note}</p>
                    </div>
                    <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                      <span className={cn("size-1.5 shrink-0 rounded-full", sync.dot)} aria-hidden />
                      <span className="truncate">{sync.text}{r.stale ? " · stale" : ""}</span>
                    </div>
                    <div className={cn("font-mono text-[13px] font-bold", r.health.openBlockers > 0 ? "text-warn" : "text-muted-foreground")}>
                      {r.health.openBlockers > 0 ? r.health.openBlockers : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card>
          <CardContent>
            <PanelHeader title="Needs attention" aside={plural(attention.length, "item")} />
            {resolveError && <p className="mb-3 text-xs text-bad">{resolveError}</p>}
            {attention.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing needs attention right now.</p>
            ) : (
              <div className="space-y-2.5">
                {attention.slice(0, 6).map((a: AttentionItem) => (
                  <div key={a.id} className="rounded-2xl border border-border bg-foreground/[0.04] p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <TypeChip type={a.kind} />
                      {a.at && <span className="text-[11.5px] text-muted-foreground">{ago(a.at)}</span>}
                    </div>
                    <p className="mt-2 text-[13.5px] font-semibold leading-snug text-foreground">{a.title}</p>
                    <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{a.projectTitle} · {a.detail}</p>
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {a.kind === "blocker" && a.blockerId && canResolve(a) && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!me || resolveMutation.isPending}
                          onClick={() => resolveMutation.mutate(a.blockerId!)}
                        >
                          Mark resolved
                        </Button>
                      )}
                      <Link
                        href={`/dashboard/projects/${a.projectId}`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        Open project
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <PanelHeader title="Team workload" aside={hasEstimates ? "this week vs capacity" : "open tasks"} />
            {workload.length === 0 ? (
              <p className="text-sm text-muted-foreground">No team members yet.</p>
            ) : (
              <div className="space-y-4">
                {workload.map(w => {
                  const load = w.capacity > 0 ? w.weekHours / w.capacity : w.weekHours > 0 ? Infinity : 0;
                  const state = w.overdue > 0
                    ? { text: `${w.overdue} overdue`, cls: "font-semibold text-bad", tone: "bad" as const }
                    : hasEstimates && load > 1
                      ? { text: `Over by ${formatHours(w.weekHours - w.capacity)}`, cls: "font-semibold text-bad", tone: "bad" as const }
                      : hasEstimates && load >= 0.85
                        ? { text: "Near limit", cls: "font-semibold text-warn", tone: "warn" as const }
                        : { text: w.openTasks === 0 ? "Free" : hasEstimates ? "Balanced" : "On schedule", cls: "text-muted-foreground", tone: "info" as const };
                  return (
                    <div key={w.employee.id}>
                      <div className="flex items-center gap-2.5">
                        <Avatar employee={w.employee} size={32} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-semibold text-foreground">{w.employee.full_name}</p>
                          <p className="text-[11.5px] text-muted-foreground">{plural(w.openTasks, "open task")} · {plural(w.projects, "project")}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-[13px] font-bold text-foreground">
                            {hasEstimates ? `${formatHours(w.weekHours)} / ${w.capacity} h` : w.openTasks}
                          </p>
                          <p className={cn("text-[11.5px]", state.cls)}>{state.text}</p>
                        </div>
                      </div>
                      <ProgressBar
                        value={hasEstimates ? Math.min(1, load) : w.openTasks / maxOpen}
                        tone={state.tone}
                        className="mt-2.5 h-2"
                      />
                    </div>
                  );
                })}
              </div>
            )}
            <p className="mt-5 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
              {hasEstimates
                ? "Hours are task estimates due in the next 7 days plus anything overdue. Tasks without an estimate are not counted."
                : "Add estimates to tasks to see hours against each person's weekly capacity."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <PanelHeader
              title="Live activity"
              aside={<span className="flex items-center gap-1.5 text-ok"><span className="size-1.5 rounded-full bg-ok" />Live sync</span>}
            />
            {feed.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <div>
                {feed.map(item => (
                  <div key={item.id} className="border-t border-border py-3 first:border-t-0 first:pt-0">
                    <div className="flex items-center gap-2">
                      <TypeChip type={item.type} />
                      <span className="text-[11.5px] text-muted-foreground">{ago(item.at)}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[13px] leading-snug text-foreground">{item.title}</p>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                      {item.who}{item.project ? ` · ${item.project}` : ""}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
