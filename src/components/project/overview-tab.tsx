"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { differenceInCalendarDays, formatDistanceToNowStrict, parseISO, startOfDay, subDays } from "date-fns";
import { ExternalLink, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { assignEmployeeToProject, resolveBlocker, unassignEmployeeFromProject } from "@/lib/supabase/queries";
import { formatHours } from "@/lib/planning";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, KpiTile, PanelHeader, TypeChip, type ChipType } from "@/components/hub-ui";
import { cn } from "@/lib/utils";
import { BurndownChart } from "./burndown-chart";
import { fieldCls } from "./form-styles";
import { MilestonesPanel } from "./milestones";
import type { Cockpit } from "./use-cockpit";

const ago = (iso: string) => formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function OverviewTab({ cockpit, goTo }: { cockpit: Cockpit; goTo: (tab: string) => void }) {
  const { project, health, burndown, tasks, blockers, updates, canEdit } = cockpit;
  if (!project || !health) return null;

  const weekAgo = subDays(new Date(), 7).getTime();
  const recent = updates.filter(u => parseISO(u.created_at).getTime() >= weekAgo).slice(0, 6);
  const doneThisWeek = tasks.filter(t => t.status === "done" && parseISO(t.completed_at ?? t.updated_at).getTime() >= weekAgo).length;
  const progressPct = Math.round(health.progress * 100);
  const today = startOfDay(new Date());
  const startDate = parseISO(project.start_date ?? project.created_at);
  const totalDays = project.due_date ? Math.max(1, differenceInCalendarDays(parseISO(project.due_date), startOfDay(startDate))) : null;
  const dayNumber = Math.max(0, differenceInCalendarDays(today, startOfDay(startDate)));
  const oldestBlocker = blockers.length > 0 ? blockers[blockers.length - 1] : null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-5">
        <section aria-label="Project numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiTile label="Progress" value={`${progressPct}%`} sub={`${health.done} of ${health.total} tasks done`} />
          <KpiTile
            label="Time used"
            value={health.timeUsed !== null ? `${Math.round(health.timeUsed * 100)}%` : "-"}
            sub={totalDays ? `Day ${Math.min(dayNumber, totalDays)} of ${totalDays}` : "No due date set"}
          />
          <KpiTile
            label="Open blockers"
            value={blockers.length}
            valueClassName={blockers.length > 0 ? "text-warn" : undefined}
            sub={oldestBlocker ? `Oldest ${ago(oldestBlocker.created_at).replace(" ago", "")}` : "Nothing is blocked"}
          />
          <KpiTile
            label="Pace needed"
            value={burndown && burndown.neededPerDay !== null ? `${burndown.neededPerDay.toFixed(1)}/day` : "-"}
            sub={burndown ? `Now ${burndown.currentPerDay.toFixed(1)}/day` : "Needs a due date and tasks"}
          />
        </section>

        <Card>
          <CardContent>
            <PanelHeader title="Progress vs plan" aside="remaining tasks" />
            {burndown ? (
              <BurndownChart data={burndown} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Set a due date and add tasks to see how the project is tracking against its plan.
              </p>
            )}
          </CardContent>
        </Card>

        <MilestonesPanel cockpit={cockpit} />

        <Card>
          <CardContent>
            <PanelHeader
              title="What changed this week"
              aside={<button type="button" onClick={() => goTo("activity")} className="text-foreground underline-offset-4 hover:underline">All activity</button>}
            />
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No updates in the last 7 days.</p>
            ) : (
              <ul>
                {recent.map(u => (
                  <li key={u.id} className="flex items-start gap-3 border-t border-border py-3 first:border-t-0 first:pt-0">
                    <TypeChip type={u.update_type as ChipType} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] leading-snug text-foreground">{u.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{u.employee?.full_name ?? "Someone"} · {ago(u.created_at)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
              {plural(doneThisWeek, "task")} completed in the last 7 days.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="min-w-0 space-y-5">
        <BlockersPanel cockpit={cockpit} />
        <TeamPanel cockpit={cockpit} />
        <LinksPanel cockpit={cockpit} onManage={() => goTo("docs")} canManage={canEdit} />
      </div>
    </div>
  );
}

function BlockersPanel({ cockpit }: { cockpit: Cockpit }) {
  const supabase = createClient();
  const { me, blockers, health, canEdit, invalidate } = cockpit;
  const [error, setError] = useState<string | null>(null);

  const resolve = useMutation({
    mutationFn: (id: string) => resolveBlocker(supabase, id, me!.id),
    onSuccess: () => {
      setError(null);
      invalidate(["open-blockers"], ["notifications-unread"]);
    },
    onError: () => setError("Couldn't resolve it. You need to be on this project."),
  });

  return (
    <Card>
      <CardContent>
        <PanelHeader title="Blockers & risks" aside={plural(blockers.length, "open blocker")} />
        {error && <p className="mb-2 text-xs text-bad">{error}</p>}
        {health && health.reasons.length > 0 && health.state !== "none" && (
          <div className="mb-3 rounded-2xl border border-border bg-foreground/[0.04] p-3.5">
            <p className="text-[13px] font-semibold text-foreground">Why this is {health.label.toLowerCase()}</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
              {health.reasons.map(r => <li key={r}>{r}</li>)}
            </ul>
          </div>
        )}
        {blockers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open blockers.</p>
        ) : (
          <div className="space-y-2.5">
            {blockers.map(b => (
              <div key={b.id} className="rounded-2xl border border-border bg-foreground/[0.04] p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <TypeChip type="blocker" />
                  <span className="text-[11.5px] text-muted-foreground">{ago(b.created_at)}</span>
                </div>
                <p className="mt-2 text-[13.5px] font-semibold leading-snug text-foreground">{b.title}</p>
                {b.details && b.details !== b.title && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{b.details}</p>}
                <p className="mt-1 text-xs text-muted-foreground">Reported by {b.employee?.full_name ?? "someone"}</p>
                {canEdit && (
                  <Button type="button" variant="outline" size="sm" className="mt-2.5" disabled={resolve.isPending} onClick={() => resolve.mutate(b.id)}>
                    Mark resolved
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TeamPanel({ cockpit }: { cockpit: Cockpit }) {
  const supabase = createClient();
  const { project, team, tasks, timeEntries, employees, assignments, isAdmin, invalidate } = cockpit;
  const [adding, setAdding] = useState("");
  const [error, setError] = useState<string | null>(null);

  const assignedIds = new Set(assignments.map(a => a.employee_id));
  const candidates = employees.filter(e => !assignedIds.has(e.id));

  const hoursFor = (employeeId: string) =>
    timeEntries
      .filter(t => t.employee_id === employeeId)
      .reduce((n, t) => n + ((t.ended_at ? parseISO(t.ended_at) : new Date()).getTime() - parseISO(t.started_at).getTime()) / 3_600_000, 0);

  const add = useMutation({
    mutationFn: (employeeId: string) => assignEmployeeToProject(supabase, project!.id, employeeId),
    onSuccess: () => { setAdding(""); setError(null); invalidate(["project-assignments"], ["notifications-unread"]); },
    onError: () => setError("Couldn't add that person."),
  });
  const remove = useMutation({
    mutationFn: (employeeId: string) => unassignEmployeeFromProject(supabase, project!.id, employeeId),
    onSuccess: () => { setError(null); invalidate(["project-assignments"]); },
    onError: () => setError("Couldn't remove that person."),
  });

  return (
    <Card>
      <CardContent>
        <PanelHeader title="Team" aside={plural(team.length, "person")} />
        {team.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody is assigned yet.</p>
        ) : (
          <ul className="space-y-3">
            {team.map(m => {
              const open = tasks.filter(t => t.assigned_to === m.id && t.status !== "done").length;
              const logged = hoursFor(m.id);
              return (
                <li key={m.id} className="flex items-center gap-2.5">
                  <Avatar employee={m} size={30} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold text-foreground">{m.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {plural(open, "open task")}{logged > 0 ? ` · ${formatHours(logged)} logged` : ""}
                    </p>
                  </div>
                  {isAdmin && assignedIds.has(m.id) && (
                    <button
                      type="button"
                      aria-label={`Remove ${m.full_name} from this project`}
                      onClick={() => remove.mutate(m.id)}
                      className="rounded p-1 text-muted-foreground hover:text-bad"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {isAdmin && candidates.length > 0 && (
          <div className="mt-4 flex gap-2 border-t border-border pt-3">
            <label htmlFor="add-member" className="sr-only">Add a person to this project</label>
            <select id="add-member" className={cn(fieldCls, "flex-1")} value={adding} onChange={e => setAdding(e.target.value)}>
              <option value="">Add a person…</option>
              {candidates.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            <Button type="button" variant="outline" disabled={!adding || add.isPending} onClick={() => add.mutate(adding)}>Add</Button>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      </CardContent>
    </Card>
  );
}

function LinksPanel({ cockpit, onManage, canManage }: { cockpit: Cockpit; onManage: () => void; canManage: boolean }) {
  const { project } = cockpit;
  if (!project) return null;
  const items = [
    project.repo_url ? { label: "Repository", url: project.repo_url } : null,
    project.deployed_url ? { label: "Production", url: project.deployed_url } : null,
    ...(project.links ?? []).map(l => ({ label: l.label, url: l.url })),
  ].filter((i): i is { label: string; url: string } => Boolean(i));

  return (
    <Card>
      <CardContent>
        <PanelHeader
          title="Links"
          aside={canManage ? <button type="button" onClick={onManage} className="text-foreground underline-offset-4 hover:underline">Manage</button> : undefined}
        />
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No links yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map(i => (
              <li key={`${i.label}-${i.url}`}>
                <a
                  href={i.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-[13px] text-foreground hover:bg-foreground/5"
                >
                  <span className="truncate font-medium">{i.label}</span>
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
