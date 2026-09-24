"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict, isToday, isYesterday, parseISO } from "date-fns";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createProjectUpdate, deleteProjectUpdate, resolveBlocker } from "@/lib/supabase/queries";
import type { UpdateType } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PanelHeader, TypeChip, type ChipType } from "@/components/hub-ui";
import { cn } from "@/lib/utils";
import { fieldCls, labelCls } from "./form-styles";
import type { Cockpit } from "./use-cockpit";

type Filter = "all" | "progress" | "blocker" | "decision" | "note" | "done";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "progress", label: "Progress" },
  { key: "blocker", label: "Blockers" },
  { key: "decision", label: "Decisions" },
  { key: "note", label: "Notes" },
  { key: "done", label: "Completed" },
];

interface Item {
  id: string;
  kind: Filter;
  title: string;
  details: string | null;
  who: string;
  at: string;
  updateId?: string;
  createdBy?: string;
  resolved?: boolean;
}

const dayLabel = (iso: string) => {
  const d = parseISO(iso);
  return isToday(d) ? "Today" : isYesterday(d) ? "Yesterday" : format(d, "EEE, d MMM");
};

export function ActivityTab({ cockpit }: { cockpit: Cockpit }) {
  const supabase = createClient();
  const { project, me, updates, tasks, employees, isAdmin, canEdit, invalidate } = cockpit;
  const [filter, setFilter] = useState<Filter>("all");
  const [type, setType] = useState<UpdateType>("progress");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState<string | null>(null);

  const nameOf = useMemo(() => new Map(employees.map(e => [e.id, e.full_name])), [employees]);

  const items = useMemo<Item[]>(() => {
    const fromUpdates: Item[] = updates.map(u => ({
      id: `u-${u.id}`,
      kind: u.update_type,
      title: u.title,
      details: u.details && u.details !== u.title ? u.details : null,
      who: u.employee?.full_name ?? "Someone",
      at: u.created_at,
      updateId: u.id,
      createdBy: u.created_by,
      resolved: Boolean(u.resolved_at),
    }));
    const fromTasks: Item[] = tasks
      .filter(t => t.status === "done")
      .map(t => ({
        id: `t-${t.id}`,
        kind: "done" as Filter,
        title: t.title,
        details: null,
        who: t.assignee?.full_name ?? (t.assigned_to ? nameOf.get(t.assigned_to) : undefined) ?? t.employee?.full_name ?? "Someone",
        at: t.completed_at ?? t.updated_at,
      }));
    return [...fromUpdates, ...fromTasks].sort((a, b) => parseISO(b.at).getTime() - parseISO(a.at).getTime());
  }, [updates, tasks, nameOf]);

  const visible = items.filter(i => filter === "all" || i.kind === filter);
  const count = (f: Filter) => (f === "all" ? items.length : items.filter(i => i.kind === f).length);

  const add = useMutation({
    mutationFn: () =>
      createProjectUpdate(supabase, {
        project_id: project!.id,
        title: (title.trim() || details.trim()).slice(0, 80),
        details: details.trim() || title.trim(),
        update_type: type,
        created_by: me!.id,
      }),
    onSuccess: () => {
      setTitle("");
      setDetails("");
      setError(null);
      invalidate(["project-updates", project!.id], ["recent-updates"], ["open-blockers"]);
    },
    onError: () => setError("Couldn't post that update."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteProjectUpdate(supabase, id),
    onSuccess: () => invalidate(["project-updates", project!.id], ["recent-updates"], ["open-blockers"]),
  });

  const resolve = useMutation({
    mutationFn: (id: string) => resolveBlocker(supabase, id, me!.id),
    onSuccess: () => invalidate(["project-updates", project!.id], ["open-blockers"], ["notifications-unread"]),
    onError: () => setError("Couldn't resolve that blocker."),
  });

  return (
    <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="h-fit">
        <CardContent>
          <PanelHeader title="Post an update" />
          <form
            onSubmit={e => { e.preventDefault(); if ((title.trim() || details.trim()) && me && project) add.mutate(); }}
            className="space-y-3"
          >
            <div>
              <label htmlFor="upd-type" className={labelCls}>Type</label>
              <select id="upd-type" className={fieldCls} value={type} onChange={e => setType(e.target.value as UpdateType)}>
                <option value="progress">Progress</option>
                <option value="blocker">Blocker</option>
                <option value="decision">Decision</option>
                <option value="note">Note</option>
              </select>
            </div>
            <div>
              <label htmlFor="upd-title" className={labelCls}>Headline</label>
              <Input id="upd-title" value={title} onChange={e => setTitle(e.target.value)} placeholder="One line summary" />
            </div>
            <div>
              <label htmlFor="upd-details" className={labelCls}>Details (optional)</label>
              <Textarea id="upd-details" rows={4} value={details} onChange={e => setDetails(e.target.value)} placeholder="What changed, what's blocked, what was decided…" />
            </div>
            {type === "blocker" && (
              <p className="text-xs text-muted-foreground">Blockers notify the team and show up in the Command Center until someone resolves them.</p>
            )}
            {error && <p className="text-xs text-bad">{error}</p>}
            <Button type="submit" className="w-full" disabled={!(title.trim() || details.trim()) || add.isPending}>
              {add.isPending ? "Posting…" : "Post update"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <PanelHeader title="Activity" aside={`${items.length} entries`} />
          <div role="group" aria-label="Filter activity" className="mb-4 flex flex-wrap gap-2">
            {FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-full border px-3.5 font-mono text-xs font-medium transition-colors",
                  filter === f.key ? "border-foreground bg-foreground text-background" : "border-foreground/15 text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                {f.label}
                <span className={cn("text-[11px]", filter === f.key ? "opacity-70" : "text-muted-foreground")}>{count(f.key)}</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing here yet.</p>
          ) : (
            <ul>
              {visible.map((i, idx) => {
                const day = dayLabel(i.at);
                const showDay = idx === 0 || dayLabel(visible[idx - 1].at) !== day;
                const mayDelete = i.updateId && (isAdmin || i.createdBy === me?.id);
                return (
                  <li key={i.id}>
                    {showDay && <p className="mb-1 mt-4 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground first:mt-0">{day}</p>}
                    <div className="flex items-start gap-3 border-t border-border py-3">
                      <div className="pt-0.5"><TypeChip type={i.kind as ChipType} /></div>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-[13.5px] font-medium leading-snug text-foreground", i.resolved && "text-muted-foreground line-through")}>{i.title}</p>
                        {i.details && <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{i.details}</p>}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {i.who} · {formatDistanceToNowStrict(parseISO(i.at), { addSuffix: true })}
                          {i.resolved ? " · resolved" : ""}
                        </p>
                        {i.kind === "blocker" && !i.resolved && canEdit && i.updateId && (
                          <Button type="button" variant="outline" size="sm" className="mt-2" disabled={resolve.isPending} onClick={() => resolve.mutate(i.updateId!)}>
                            Mark resolved
                          </Button>
                        )}
                      </div>
                      {mayDelete && (
                        <button
                          type="button"
                          aria-label="Delete this update"
                          onClick={() => remove.mutate(i.updateId!)}
                          className="rounded p-1 text-muted-foreground hover:text-bad"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
