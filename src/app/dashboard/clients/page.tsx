"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Building2, ChevronDown, ChevronRight, ExternalLink, Mail, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getClients, createClientRow, updateClientRow, deleteClientRow, getProjects, getAllProjectTasks,
  getEmployeeTasks, getProjectAssignments, getEmployees, getOpenBlockers,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { buildPortfolio, type PortfolioRow } from "@/lib/portfolio";
import { AvatarStack, HealthPill, KpiTile, PanelHeader, ProgressBar, healthTone } from "@/components/hub-ui";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { Client } from "@/types";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function errMsg(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message || fallback;
  }
  return fallback;
}

// Only ever produce http(s) links, whatever was typed into the website field.
function websiteHref(raw: string): string {
  const w = raw.trim();
  return /^https?:\/\//i.test(w) ? w : `https://${w.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")}`;
}
const websiteLabel = (raw: string) => raw.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");

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

interface ClientGroup {
  client: Client;
  active: PortfolioRow[];
  completed: PortfolioRow[];
  ok: number;
  risk: number;
  late: number;
  blockers: number;
  next: PortfolioRow | null;
  atRisk: boolean;
}

function buildGroups(clients: Client[], rows: PortfolioRow[]): ClientGroup[] {
  const byClient = new Map<string, PortfolioRow[]>();
  for (const r of rows) {
    if (!r.project.client_id) continue;
    const list = byClient.get(r.project.client_id) ?? [];
    list.push(r);
    byClient.set(r.project.client_id, list);
  }
  return clients.map(client => {
    const mine = byClient.get(client.id) ?? [];
    const active = mine.filter(r => r.health.state !== "done");
    const count = (s: string) => active.filter(r => r.health.state === s).length;
    const next = active
      .filter(r => r.project.due_date)
      .sort((a, b) => (a.project.due_date as string).localeCompare(b.project.due_date as string))[0] ?? null;
    const risk = count("risk");
    const late = count("late");
    return {
      client, active, completed: mine.filter(r => r.health.state === "done"),
      ok: count("ok"), risk, late,
      blockers: active.reduce((n, r) => n + r.health.openBlockers, 0),
      next, atRisk: risk + late > 0,
    };
  });
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">{label}</label>
      {children}
    </div>
  );
}

function ClientForm({ client, meId, onDone }: { client: Client | null; meId: string | undefined; onDone: () => void }) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState(client?.name ?? "");
  const [contactName, setContactName] = useState(client?.contact_name ?? "");
  const [contactEmail, setContactEmail] = useState(client?.contact_email ?? "");
  const [website, setWebsite] = useState(client?.website ?? "");
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
        website: website.trim() || null,
        notes: notes.trim() || null,
      };
      if (client) await updateClientRow(supabase, client.id, payload);
      else await createClientRow(supabase, { ...payload, created_by: meId as string });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onDone();
    },
    onError: e => setError(errMsg(e, "Couldn't save the client.")),
  });

  const canSave = name.trim().length > 0 && (Boolean(client) || Boolean(meId));

  return (
    <form
      onSubmit={e => { e.preventDefault(); if (canSave && !save.isPending) { setError(null); save.mutate(); } }}
      className="space-y-3.5"
    >
      <Field id="client-name" label="Name *">
        <Input id="client-name" autoFocus required value={name} onChange={e => setName(e.target.value)} placeholder="Acme Studio" />
      </Field>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field id="client-contact-name" label="Contact name">
          <Input id="client-contact-name" value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Jane Doe" />
        </Field>
        <Field id="client-contact-email" label="Contact email">
          <Input id="client-contact-email" type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="jane@acme.com" />
        </Field>
      </div>
      <Field id="client-website" label="Website">
        <Input id="client-website" value={website} onChange={e => setWebsite(e.target.value)} placeholder="acme.com" />
      </Field>
      <Field id="client-notes" label="Notes">
        <Textarea id="client-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Billing details, preferences, anything worth remembering" />
      </Field>
      {error && <p className="text-xs text-bad">{error}</p>}
      <Button type="submit" className="w-full" disabled={!canSave || save.isPending}>
        {save.isPending ? "Saving..." : client ? "Save changes" : "Create client"}
      </Button>
    </form>
  );
}

function DeleteClientDialog({ client, projectCount, open, onOpenChange }: {
  client: Client | null; projectCount: number; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => deleteClientRow(supabase, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setError(null);
      onOpenChange(false);
    },
    onError: e => setError(errMsg(e, "Couldn't delete the client.")),
  });

  const setOpen = (o: boolean) => { setError(null); onOpenChange(o); };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete client?</DialogTitle>
          <DialogDescription>
            This deletes &quot;{client?.name}&quot;. Its {plural(projectCount, "project")} will not be deleted - they become
            unassigned and show up under &quot;No client&quot; until you link them again. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-xs text-bad">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="button" variant="destructive" disabled={!client || remove.isPending} onClick={() => client && remove.mutate(client.id)}>
            {remove.isPending ? "Deleting..." : "Delete client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectLine({ row }: { row: PortfolioRow }) {
  const { project, health, team } = row;
  const due = dueInfo(row);
  return (
    <div className="border-t border-border py-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/dashboard/projects/${project.id}`} className="min-w-0 truncate text-sm font-semibold text-foreground hover:text-primary">
          {project.title}
        </Link>
        <HealthPill state={health.state} label={health.label} title={health.reasons.join(" · ")} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[140px] flex-1">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="font-mono text-[13px] font-semibold text-foreground">{Math.round(health.progress * 100)}%</span>
            <span className="text-[11.5px] text-muted-foreground">{health.done}/{health.total} tasks</span>
          </div>
          <ProgressBar value={health.progress} tone={healthTone(health.state)} />
        </div>
        <div className="min-w-[84px]">
          <p className="text-[13px] font-semibold text-foreground">{due.date}</p>
          <p className={cn("text-xs", due.late ? "font-semibold text-bad" : "text-muted-foreground")}>{due.note}</p>
        </div>
        <AvatarStack people={team} size={24} />
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-[13px]">{children}</div>
    </div>
  );
}

function ClientCard({ group, isAdmin, onEdit, onDelete }: {
  group: ClientGroup; isAdmin: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const { client, active, completed, next } = group;
  const nextDue = next ? dueInfo(next) : null;
  const pills = [
    { state: "ok", n: group.ok, label: "on track" },
    { state: "risk", n: group.risk, label: "at risk" },
    { state: "late", n: group.late, label: "late" },
  ] as const;

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-heading text-lg font-bold tracking-tight text-foreground">{client.name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {client.contact_name && <span>{client.contact_name}</span>}
              {client.contact_email && (
                <a href={`mailto:${client.contact_email}`} className="inline-flex items-center gap-1 hover:text-primary">
                  <Mail className="size-3" aria-hidden />{client.contact_email}
                </a>
              )}
              {client.website && (
                <a href={websiteHref(client.website)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-primary">
                  <ExternalLink className="size-3" aria-hidden />{websiteLabel(client.website)}
                </a>
              )}
              {!client.contact_name && !client.contact_email && !client.website && <span>No contact details</span>}
            </div>
          </div>
          {isAdmin && (
            <div className="flex shrink-0 gap-1">
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${client.name}`} title="Edit client" onClick={onEdit}>
                <Pencil />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Delete ${client.name}`} title="Delete client" className="hover:text-bad" onClick={onDelete}>
                <Trash2 />
              </Button>
            </div>
          )}
        </div>

        {client.notes && <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{client.notes}</p>}

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl border border-border bg-foreground/[0.04] px-3.5 py-3">
          <div className="flex flex-wrap gap-1.5" aria-label="Project health">
            {pills.map(p => (
              <span key={p.state} className={cn(p.n === 0 && "opacity-40")}>
                <HealthPill state={p.state} label={`${p.n} ${p.label}`} />
              </span>
            ))}
          </div>
          <Stat label="Blockers">
            <span className={cn("font-mono font-bold", group.blockers > 0 ? "text-warn" : "text-muted-foreground")}>
              {group.blockers > 0 ? group.blockers : "—"}
            </span>
          </Stat>
          <Stat label="Next due">
            {next && nextDue ? (
              <span className="font-semibold text-foreground">
                {nextDue.date}{" "}
                <span className={cn("text-xs font-normal", nextDue.late ? "font-semibold text-bad" : "text-muted-foreground")}>{nextDue.note}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Stat>
        </div>

        <div>
          {active.length === 0 && completed.length === 0 && (
            <p className="text-sm text-muted-foreground">No projects yet - pick this client on a project&apos;s page to link it.</p>
          )}
          {active.length === 0 && completed.length > 0 && <p className="text-sm text-muted-foreground">No active projects.</p>}
          {active.map(r => <ProjectLine key={r.project.id} row={r} />)}

          {completed.length > 0 && (
            <div className={cn(active.length > 0 && "mt-1 border-t border-border pt-3")}>
              <button
                type="button"
                aria-expanded={showCompleted}
                onClick={() => setShowCompleted(v => !v)}
                className="mt-1 flex items-center gap-1.5 font-mono text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {showCompleted ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
                Completed ({completed.length})
              </button>
              {showCompleted && (
                <div className="mt-3">
                  {completed.map(r => <ProjectLine key={r.project.id} row={r} />)}
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function UnlinkedSection({ rows }: { rows: PortfolioRow[] }) {
  return (
    <Card>
      <CardContent>
        <PanelHeader title="No client" aside={plural(rows.length, "project")} />
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          These projects are not linked to a client yet. A project&apos;s client is chosen on the project page.
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every project is linked to a client.</p>
        ) : (
          <div>
            {rows.map(r => {
              const due = dueInfo(r);
              return (
                <div key={r.project.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border py-3 first:border-t-0 first:pt-0">
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/projects/${r.project.id}`} className="block truncate text-sm font-semibold text-foreground hover:text-primary">
                      {r.project.title}
                    </Link>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {r.project.client_name ? <>Noted as &quot;{r.project.client_name}&quot; - needs linking</> : "Internal or unassigned"}
                    </p>
                  </div>
                  <HealthPill state={r.health.state} label={r.health.label} title={r.health.reasons.join(" · ")} />
                  <div className="min-w-[84px] text-right">
                    <p className="text-[13px] font-semibold text-foreground">{due.date}</p>
                    <p className={cn("text-xs", due.late ? "font-semibold text-bad" : "text-muted-foreground")}>{due.note}</p>
                  </div>
                  <AvatarStack people={r.team} size={24} />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ClientsPage() {
  const supabase = createClient();
  const { data: me } = useCurrentEmployee();
  const isAdmin = me?.role === "admin";
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<{ open: boolean; client: Client | null }>({ open: false, client: null });
  const [del, setDel] = useState<{ open: boolean; client: Client | null; projects: number }>({ open: false, client: null, projects: 0 });

  // A missing clients table/column must never break the page: treat it as "no clients".
  const { data: clients = [], isLoading: clientsLoading } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => { try { return await getClients(supabase); } catch { return []; } },
  });
  const { data: projects = [], isLoading: projectsLoading } = useQuery({ queryKey: ["projects"], queryFn: () => getProjects(supabase), refetchInterval: 30000 });
  const { data: tasks = [] } = useQuery({ queryKey: ["project-tasks"], queryFn: () => getAllProjectTasks(supabase), refetchInterval: 30000 });
  const { data: employeeTasks = [] } = useQuery({ queryKey: ["employee-tasks"], queryFn: () => getEmployeeTasks(supabase) });
  const { data: assignments = [] } = useQuery({ queryKey: ["project-assignments"], queryFn: () => getProjectAssignments(supabase) });
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: () => getEmployees(supabase) });
  const { data: blockers = [] } = useQuery({ queryKey: ["open-blockers"], queryFn: () => getOpenBlockers(supabase), refetchInterval: 30000 });

  const isLoading = clientsLoading || projectsLoading;

  const { rows } = useMemo(
    () => buildPortfolio({ projects, tasks, employeeTasks, assignments, employees, blockers, now: new Date() }),
    [projects, tasks, employeeTasks, assignments, employees, blockers],
  );

  const groups = useMemo(() => buildGroups(clients, rows), [clients, rows]);
  const known = useMemo(() => new Set(clients.map(c => c.id)), [clients]);
  // Also catches a client_id whose client was just deleted or is hidden from this user.
  const unlinked = useMemo(() => rows.filter(r => !r.project.client_id || !known.has(r.project.client_id)), [rows, known]);

  const q = search.trim().toLowerCase();
  const visible = groups.filter(g =>
    !q || [g.client.name, g.client.contact_name, g.client.contact_email].some(v => v?.toLowerCase().includes(q)),
  );

  const activeLinked = groups.reduce((n, g) => n + g.active.filter(r => r.project.status === "active" || r.project.status === "review").length, 0);
  const clientsWithActive = groups.filter(g => g.active.some(r => r.project.status === "active" || r.project.status === "review")).length;
  const atRiskClients = groups.filter(g => g.atRisk);
  const dash = isLoading ? "—" : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Clients</h1>
          <p className="mt-1 text-sm text-muted-foreground">Who we work for, and how each client&apos;s projects are doing right now.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              aria-label="Search clients"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search clients or contacts"
              className="w-64 pl-8"
            />
          </div>
          {isAdmin && (
            <Button type="button" onClick={() => setForm({ open: true, client: null })}>
              <Plus className="mr-1.5 size-4" aria-hidden />
              New client
            </Button>
          )}
        </div>
      </div>

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile label="Clients" value={dash ?? clients.length} sub={`${groups.filter(g => g.active.length + g.completed.length > 0).length} with projects`} />
        <KpiTile label="Active projects" value={dash ?? activeLinked} sub={`across ${plural(clientsWithActive, "client")}`} />
        <KpiTile
          label="Clients at risk"
          value={dash ?? atRiskClients.length}
          valueClassName={atRiskClients.length > 0 ? "text-warn" : undefined}
          sub={atRiskClients.length > 0 ? atRiskClients.slice(0, 2).map(g => g.client.name).join(" · ") : "Nothing at risk or late"}
        />
        <KpiTile
          label="No client"
          value={dash ?? unlinked.length}
          valueClassName={unlinked.length > 0 ? "text-warn" : undefined}
          sub={unlinked.length > 0 ? "Projects still to link" : "Every project has a client"}
        />
      </section>

      {isLoading ? (
        <div className="grid items-start gap-5 xl:grid-cols-2" aria-busy="true" aria-label="Loading clients">
          {[0, 1].map(i => (
            <Card key={i}>
              <CardContent className="space-y-3">
                <div className="h-5 w-40 animate-pulse rounded-full bg-foreground/10" />
                <div className="h-3 w-56 animate-pulse rounded-full bg-foreground/10" />
                <div className="h-16 animate-pulse rounded-2xl bg-foreground/5" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <Building2 className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-semibold text-foreground">
              {clients.length === 0 ? "No clients yet" : `No clients match "${search.trim()}"`}
            </p>
            <p className="text-sm text-muted-foreground">
              {clients.length === 0
                ? isAdmin ? "Add the first client with the New client button." : "An admin can add clients here."
                : "Try a different name or contact."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-2">
          {visible.map(g => (
            <ClientCard
              key={g.client.id}
              group={g}
              isAdmin={isAdmin}
              onEdit={() => setForm({ open: true, client: g.client })}
              onDelete={() => setDel({ open: true, client: g.client, projects: g.active.length + g.completed.length })}
            />
          ))}
        </div>
      )}

      {!isLoading && <UnlinkedSection rows={unlinked} />}

      {isAdmin && (
        <>
          <Dialog open={form.open} onOpenChange={open => setForm(f => ({ ...f, open }))}>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>{form.client ? "Edit client" : "New client"}</DialogTitle>
                <DialogDescription>
                  {form.client ? "Update how this client appears in the directory." : "Only the name is required."}
                </DialogDescription>
              </DialogHeader>
              <ClientForm client={form.client} meId={me?.id} onDone={() => setForm(f => ({ ...f, open: false }))} />
            </DialogContent>
          </Dialog>
          <DeleteClientDialog
            client={del.client}
            projectCount={del.projects}
            open={del.open}
            onOpenChange={open => setDel(d => ({ ...d, open }))}
          />
        </>
      )}
    </div>
  );
}
