"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { differenceInCalendarDays, format, parseISO, startOfDay } from "date-fns";
import { Check, Pencil, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createMilestone, deleteMilestone, updateMilestone } from "@/lib/supabase/queries";
import type { ProjectMilestone } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PanelHeader } from "@/components/hub-ui";
import { cn } from "@/lib/utils";
import { fieldCls, labelCls } from "./form-styles";
import type { Cockpit } from "./use-cockpit";

type MilestoneState = "done" | "late" | "current" | "upcoming";

export function milestoneStates(milestones: ProjectMilestone[], today: Date): Map<string, MilestoneState> {
  const out = new Map<string, MilestoneState>();
  let currentAssigned = false;
  for (const m of milestones) {
    if (m.completed_at) out.set(m.id, "done");
    else if (differenceInCalendarDays(parseISO(m.due_date), today) < 0) out.set(m.id, "late");
    else if (!currentAssigned) {
      out.set(m.id, "current");
      currentAssigned = true;
    } else out.set(m.id, "upcoming");
  }
  return out;
}

const rangeText = (m: ProjectMilestone) =>
  m.start_date ? `${format(parseISO(m.start_date), "d MMM")} - ${format(parseISO(m.due_date), "d MMM")}` : `by ${format(parseISO(m.due_date), "d MMM")}`;

export function MilestonesPanel({ cockpit }: { cockpit: Cockpit }) {
  const supabase = createClient();
  const { milestones, canEdit, invalidate } = cockpit;
  const [dialog, setDialog] = useState<{ milestone: ProjectMilestone | null } | null>(null);
  const today = startOfDay(new Date());
  const states = milestoneStates(milestones, today);

  const toggle = useMutation({
    mutationFn: (m: ProjectMilestone) =>
      updateMilestone(supabase, m.id, { completed_at: m.completed_at ? null : new Date().toISOString() }),
    onSuccess: () => invalidate(["milestones"]),
  });

  const stateText = (m: ProjectMilestone) => {
    const s = states.get(m.id);
    if (s === "done") return { text: "Done", cls: "text-ok" };
    if (s === "late") return { text: `${-differenceInCalendarDays(parseISO(m.due_date), today)} days late`, cls: "text-bad font-semibold" };
    if (s === "current") return { text: "In progress", cls: "text-info font-semibold" };
    return { text: "Upcoming", cls: "text-muted-foreground" };
  };

  return (
    <Card>
      <CardContent>
        <PanelHeader
          title="Milestones"
          aside={
            canEdit ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setDialog({ milestone: null })}>
                <Plus className="mr-1 h-3.5 w-3.5" />Add milestone
              </Button>
            ) : undefined
          }
        />
        {milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No milestones yet. Add the phases of this project (for example Design, Build, QA, Launch) and they appear on the Timeline too.
          </p>
        ) : (
          <ol className="relative flex gap-4 overflow-x-auto pb-1">
            {milestones.map((m, i) => {
              const s = states.get(m.id);
              const st = stateText(m);
              return (
                <li key={m.id} className="relative min-w-[150px] flex-1">
                  {i < milestones.length - 1 && <span className="absolute left-[26px] right-[-16px] top-[13px] h-0.5 bg-foreground/10" aria-hidden />}
                  <div className="relative flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!canEdit || toggle.isPending}
                      onClick={() => toggle.mutate(m)}
                      aria-label={m.completed_at ? `Mark ${m.title} not done` : `Mark ${m.title} done`}
                      aria-pressed={Boolean(m.completed_at)}
                      className={cn(
                        "relative z-10 flex size-[26px] items-center justify-center rounded-full border-2 transition-colors disabled:cursor-default",
                        s === "done" && "border-ok bg-ok text-background",
                        s === "late" && "border-bad bg-bad-soft text-bad",
                        s === "current" && "border-info bg-info-soft text-info",
                        s === "upcoming" && "border-foreground/25 bg-card text-muted-foreground",
                      )}
                    >
                      {s === "done" ? <Check className="h-3.5 w-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}
                    </button>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => setDialog({ milestone: m })}
                        aria-label={`Edit ${m.title}`}
                        className="rounded p-1 text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-[13.5px] font-semibold text-foreground">{m.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{rangeText(m)}</p>
                  <p className={cn("mt-0.5 text-xs", st.cls)}>{st.text}</p>
                </li>
              );
            })}
          </ol>
        )}
        <MilestoneDialog cockpit={cockpit} state={dialog} onClose={() => setDialog(null)} />
      </CardContent>
    </Card>
  );
}

function MilestoneDialog({ cockpit, state, onClose }: { cockpit: Cockpit; state: { milestone: ProjectMilestone | null } | null; onClose: () => void }) {
  return (
    <Dialog open={state !== null} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        {/* mounted only while open, so every open starts from fresh form state */}
        <MilestoneForm cockpit={cockpit} milestone={state?.milestone ?? null} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function MilestoneForm({ cockpit, milestone, onClose }: { cockpit: Cockpit; milestone: ProjectMilestone | null; onClose: () => void }) {
  const supabase = createClient();
  const { me, project, milestones, invalidate } = cockpit;

  const [title, setTitle] = useState(milestone?.title ?? "");
  const [start, setStart] = useState(milestone?.start_date ?? "");
  const [due, setDue] = useState(milestone?.due_date ?? project?.due_date ?? "");
  const [error, setError] = useState<string | null>(null);

  const finish = () => {
    invalidate(["milestones"]);
    onClose();
  };

  const save = useMutation({
    mutationFn: async () => {
      if (start && due && start > due) throw new Error("The start date is after the due date.");
      if (milestone) {
        await updateMilestone(supabase, milestone.id, { title: title.trim(), start_date: start || null, due_date: due });
      } else {
        await createMilestone(supabase, {
          project_id: project!.id,
          title: title.trim(),
          start_date: start || null,
          due_date: due,
          position: milestones.length,
          created_by: me!.id,
        });
      }
    },
    onSuccess: finish,
    onError: (e: Error) => setError(e.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteMilestone(supabase, milestone!.id),
    onSuccess: finish,
    onError: (e: Error) => setError(e.message),
  });

  return (
    <>
      <DialogHeader><DialogTitle>{milestone ? "Edit milestone" : "New milestone"}</DialogTitle></DialogHeader>
      <form
        onSubmit={e => { e.preventDefault(); if (title.trim() && due && me && project) save.mutate(); }}
        className="space-y-3"
      >
        <div>
          <label htmlFor="ms-title" className={labelCls}>Name</label>
          <Input id="ms-title" autoFocus value={title} onChange={e => setTitle(e.target.value)} placeholder="Design, Build, QA, Launch…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ms-start" className={labelCls}>Starts (optional)</label>
            <input id="ms-start" type="date" className={fieldCls} value={start} onChange={e => setStart(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ms-due" className={labelCls}>Due</label>
            <input id="ms-due" type="date" className={fieldCls} value={due} onChange={e => setDue(e.target.value)} required />
          </div>
        </div>
        {error && <p className="text-xs text-bad">{error}</p>}
        <div className="flex items-center justify-between pt-1">
          {milestone ? (
            <Button type="button" variant="ghost" className="text-muted-foreground" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Delete
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!title.trim() || !due || save.isPending}>{save.isPending ? "Saving…" : "Save"}</Button>
          </div>
        </div>
      </form>
    </>
  );
}
