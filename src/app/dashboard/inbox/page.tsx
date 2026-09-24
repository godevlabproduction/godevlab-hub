"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict, isToday, isYesterday, parseISO } from "date-fns";
import {
  AlertTriangle, CheckCheck, CheckCircle2, ClipboardCheck, FolderPlus, Inbox, Trash2,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getNotifications, getEmployees, markNotificationRead, markAllNotificationsRead, deleteNotification,
} from "@/lib/supabase/queries";
import { useUnreadCount } from "@/hooks/use-unread-count";
import { Avatar, PanelHeader } from "@/components/hub-ui";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { HubNotification, NotificationType } from "@/types";

type Filter = "all" | "unread";
type Group = "today" | "yesterday" | "earlier";

const GROUPS: { key: Group; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "earlier", label: "Earlier" },
];

// One entry per notification type: icon, label and the status token that tints it.
const TYPE_META: Record<NotificationType, { icon: LucideIcon; label: string; tint: string }> = {
  task_assigned: { icon: ClipboardCheck, label: "Task assigned", tint: "bg-info-soft text-info" },
  blocker: { icon: AlertTriangle, label: "Blocker", tint: "bg-warn-soft text-warn" },
  blocker_resolved: { icon: CheckCircle2, label: "Blocker resolved", tint: "bg-ok-soft text-ok" },
  project_assigned: { icon: FolderPlus, label: "Project assigned", tint: "bg-violet-soft text-violet" },
};

const FALLBACK_META = TYPE_META.task_assigned;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const ago = (iso: string) => formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });

function groupOf(iso: string): Group {
  const d = parseISO(iso);
  if (isToday(d)) return "today";
  if (isYesterday(d)) return "yesterday";
  return "earlier";
}

const ROW_LINK =
  "flex min-w-0 flex-1 items-start gap-3 rounded-xl px-2 py-3 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50";

export default function InboxPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => getNotifications(supabase, 100),
    refetchInterval: 30000,
  });
  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: () => getEmployees(supabase) });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
  };
  const onSuccess = () => {
    setActionError(null);
    refresh();
  };
  const onError = () => {
    setActionError("Couldn't update your inbox - please try again.");
    refresh();
  };

  const markRead = useMutation({ mutationFn: (id: string) => markNotificationRead(supabase, id), onSuccess, onError });
  const markAll = useMutation({ mutationFn: () => markAllNotificationsRead(supabase), onSuccess, onError });
  const remove = useMutation({ mutationFn: (id: string) => deleteNotification(supabase, id), onSuccess, onError });

  const people = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);

  const list: HubNotification[] = Array.isArray(notifications) ? notifications : [];
  // The badge count comes from the database and can exceed the 100 rows loaded here.
  const { data: dbUnread = 0 } = useUnreadCount();
  const unreadInList = list.filter(n => !n.read_at).length;
  const unreadCount = Math.max(unreadInList, dbUnread);
  const visible = filter === "unread" ? list.filter(n => !n.read_at) : list;

  const grouped = GROUPS
    .map(g => ({ ...g, items: visible.filter(n => groupOf(n.created_at) === g.key) }))
    .filter(g => g.items.length > 0);

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: list.length },
    { key: "unread", label: "Unread", count: unreadCount },
  ];

  const open = (n: HubNotification) => {
    if (!n.read_at) markRead.mutate(n.id);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {unreadCount > 0
              ? `${plural(unreadCount, "unread notification")} · assignments and blockers that involve you`
              : "Assignments and blockers that involve you"}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={unreadCount === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          <CheckCheck className="mr-2 h-4 w-4" aria-hidden />
          Mark all read
        </Button>
      </div>

      <Card>
        <CardContent>
          <PanelHeader title="Notifications" aside={`${visible.length} of ${plural(list.length, "notification")}`} />
          <div role="group" aria-label="Filter notifications" className="mb-4 flex flex-wrap gap-2">
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
                <span className={cn("text-[11px]", filter === c.key ? "opacity-70" : "text-muted-foreground")}>{c.count}</span>
              </button>
            ))}
          </div>

          {actionError && <p role="alert" className="mb-3 text-xs text-bad">{actionError}</p>}

          {isLoading && (
            <p role="status" className="border-t border-border px-1 py-6 text-sm text-muted-foreground">Loading notifications…</p>
          )}

          {!isLoading && visible.length === 0 && (
            <div className="flex flex-col items-center gap-2 border-t border-border px-1 py-12 text-center">
              <span className="flex size-11 items-center justify-center rounded-full bg-ok-soft text-ok">
                <Inbox className="size-5" aria-hidden />
              </span>
              <p className="font-heading text-base font-semibold text-foreground">You&apos;re all caught up.</p>
              <p className="text-sm text-muted-foreground">
                {list.length === 0
                  ? "New task and project assignments and blockers will show up here."
                  : "You have no unread notifications."}
              </p>
              {list.length > 0 && filter === "unread" && (
                <Button type="button" variant="outline" size="sm" className="mt-1" onClick={() => setFilter("all")}>
                  Show all notifications
                </Button>
              )}
            </div>
          )}

          {!isLoading && grouped.map(g => (
            <section key={g.key} aria-label={g.label} className="mt-1 first:mt-0">
              <h3 className="flex items-center gap-2 px-1 pb-1 pt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                {g.label}
                <span className="text-[10px]">{g.items.length}</span>
              </h3>
              <ul>
                {g.items.map(n => {
                  const meta = TYPE_META[n.type] ?? FALLBACK_META;
                  const Icon = meta.icon;
                  const unread = !n.read_at;
                  const actor = n.actor_id ? people.get(n.actor_id) : undefined;
                  const deleting = remove.isPending && remove.variables === n.id;

                  const body: ReactNode = (
                    <>
                      <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full", meta.tint)}>
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start gap-2">
                          <span
                            className={cn(
                              "line-clamp-2 text-[13.5px] leading-snug text-foreground",
                              unread ? "font-bold" : "font-normal",
                            )}
                          >
                            {unread && <span className="sr-only">Unread: </span>}
                            {n.title}
                          </span>
                          {unread && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden />}
                        </span>
                        {n.body && <span className="mt-0.5 line-clamp-1 block text-xs leading-snug text-muted-foreground">{n.body}</span>}
                        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
                          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.08em]">{meta.label}</span>
                          {actor && (
                            <span className="flex items-center gap-1.5">
                              <Avatar employee={actor} size={16} />
                              by {actor.full_name}
                            </span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 pt-0.5 text-[11.5px] text-muted-foreground">{ago(n.created_at)}</span>
                    </>
                  );

                  return (
                    <li
                      key={n.id}
                      className={cn(
                        "flex items-start gap-1 border-t border-border first:border-t-0",
                        deleting && "opacity-50",
                      )}
                    >
                      {n.project_id ? (
                        <Link
                          href={`/dashboard/projects/${n.project_id}`}
                          onClick={() => open(n)}
                          className={cn(ROW_LINK, "hover:bg-foreground/5", unread && "bg-foreground/[0.04]")}
                        >
                          {body}
                        </Link>
                      ) : unread ? (
                        <button
                          type="button"
                          onClick={() => open(n)}
                          className={cn(ROW_LINK, "bg-foreground/[0.04] hover:bg-foreground/5")}
                        >
                          {body}
                        </button>
                      ) : (
                        <div className={ROW_LINK}>{body}</div>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete notification: ${n.title}`}
                        title="Delete"
                        disabled={deleting}
                        onClick={() => remove.mutate(n.id)}
                        className="mt-3 text-muted-foreground hover:bg-bad-soft hover:text-bad"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
