"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { Copy, GitCommitHorizontal, RefreshCw } from "lucide-react";
import { generateSyncToken, getSyncTokenStatus } from "@/lib/supabase/queries";
import { buildSyncSnippet } from "@/lib/sync-snippet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { PanelHeader } from "@/components/hub-ui";
import type { Cockpit } from "./use-cockpit";

const ago = (iso: string) => formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });

export function SyncTab({ cockpit }: { cockpit: Cockpit }) {
  const { project, isAdmin, isAssigned, invalidate } = cockpit;
  const [token, setToken] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const canSync = isAdmin || isAssigned;

  const { data: status } = useQuery({
    queryKey: ["sync-token-status", project?.id],
    queryFn: () => getSyncTokenStatus(project!.id),
    enabled: Boolean(project) && canSync,
  });

  const generate = useMutation({
    mutationFn: () => generateSyncToken(project!.id),
    onSuccess: data => {
      setToken(data.token);
      setConfirmOpen(false);
      setError(null);
      invalidate(["sync-token-status", data.projectId]);
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!project) return null;

  const snippet = token ? buildSyncSnippet(project.title, token, typeof window !== "undefined" ? window.location.origin : "") : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardContent>
          <PanelHeader title="Live sync" aside="your token" />
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">
            Live sync lets your Claude Code session report progress, tasks, blockers and commits into this project while you work.
            The token is yours alone: everything it posts is attributed to you, and regenerating it never affects a teammate.
          </p>

          {!canSync ? (
            <p className="text-sm text-muted-foreground">You need to be assigned to this project (or be an admin) to set up live sync.</p>
          ) : (
            <>
              {!status?.exists && !token && (
                <Button type="button" disabled={generate.isPending} onClick={() => generate.mutate()}>
                  {generate.isPending ? "Setting up…" : "Set up live sync"}
                </Button>
              )}
              {status?.exists && !token && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-foreground/[0.04] px-4 py-3">
                  <div>
                    <p className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground">
                      <span className="size-2 rounded-full bg-ok" aria-hidden />Connected
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {status.regeneratedAt ? `Regenerated ${ago(status.regeneratedAt)}` : status.createdAt ? `Set up ${ago(status.createdAt)}` : "Active"}
                    </p>
                  </div>
                  <Button type="button" variant="outline" onClick={() => setConfirmOpen(true)}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />Regenerate
                  </Button>
                </div>
              )}
              {error && <p className="mt-3 text-xs text-bad">{error}</p>}

              {token && (
                <div className="space-y-3 rounded-2xl border border-border bg-foreground/[0.04] p-4">
                  <p className="text-xs text-muted-foreground">
                    Paste this into the project&apos;s CLAUDE.md. The token is shown only once, so copy it now.
                  </p>
                  <Textarea readOnly rows={10} value={snippet} className="font-mono text-xs" />
                  <Button type="button" variant="outline" size="sm" onClick={copy}>
                    {copied ? <span className="text-xs text-ok">Copied</span> : <><Copy className="mr-1.5 h-3.5 w-3.5" />Copy snippet</>}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardContent>
          <PanelHeader title="Latest from sync" />
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">Last sync</dt>
              <dd className="mt-1 text-foreground">{project.last_synced_at ? ago(project.last_synced_at) : "Never"}</dd>
            </div>
            <div>
              <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">Last commit</dt>
              <dd className="mt-1 flex items-start gap-2 text-foreground">
                <GitCommitHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                {project.last_commit_sha ? (
                  <span className="min-w-0">
                    <code className="font-mono text-xs">{project.last_commit_sha.slice(0, 7)}</code>
                    {project.last_commit_message && <span className="block truncate text-xs text-muted-foreground">{project.last_commit_message}</span>}
                  </span>
                ) : (
                  <span className="text-muted-foreground">No commit reported yet</span>
                )}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Regenerate your sync token?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Your current token stops working immediately. Any session still using it is rejected until you paste the new one. Teammates&apos; tokens are not affected.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={generate.isPending} onClick={() => generate.mutate()}>
              {generate.isPending ? "Regenerating…" : "Regenerate anyway"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
