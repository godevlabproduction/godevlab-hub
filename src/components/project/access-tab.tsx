"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Eye, EyeOff, Lock, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createProjectCredential, deleteProjectCredential, getProjectCredentials } from "@/lib/supabase/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PanelHeader } from "@/components/hub-ui";
import { labelCls } from "./form-styles";
import type { Cockpit } from "./use-cockpit";

export function AccessTab({ cockpit }: { cockpit: Cockpit }) {
  const supabase = createClient();
  const { project, me, isAdmin, canEdit, invalidate } = cockpit;
  const [service, setService] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: credentials = [] } = useQuery({
    queryKey: ["project_credentials", project?.id],
    queryFn: () => getProjectCredentials(supabase, project!.id),
    enabled: Boolean(project),
  });

  const key = ["project_credentials", project?.id] as (string | number)[];

  const add = useMutation({
    mutationFn: () => createProjectCredential(supabase, { project_id: project!.id, created_by: me!.id, service: service.trim(), username: username.trim(), password: password.trim() }),
    onSuccess: () => { setService(""); setUsername(""); setPassword(""); setError(null); invalidate(key); },
    onError: () => setError("Only admins can save logins."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteProjectCredential(supabase, id),
    onSuccess: () => invalidate(key),
  });

  const copy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(c => (c === id ? null : c)), 1500);
    } catch {}
  };

  if (!project) return null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardContent>
          <PanelHeader title="Logins & passwords" aside={`${credentials.length} saved`} />
          {credentials.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {canEdit ? "No logins saved for this project yet." : "Logins are only visible to admins and people assigned to this project."}
            </p>
          ) : (
            <ul className="space-y-2.5">
              {credentials.map(c => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border bg-foreground/[0.04] px-4 py-3">
                  <span className="w-32 shrink-0 truncate text-[13.5px] font-semibold text-foreground">{c.service}</span>
                  <span className="flex min-w-[150px] flex-1 items-center gap-2 text-sm text-muted-foreground">
                    <span className="truncate">{c.username}</span>
                    <button type="button" aria-label={`Copy username for ${c.service}`} onClick={() => copy(c.username, `u${c.id}`)} className="shrink-0 hover:text-foreground">
                      {copied === `u${c.id}` ? <span className="text-xs text-ok">Copied</span> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </span>
                  <span className="flex min-w-[150px] flex-1 items-center gap-2 text-sm text-muted-foreground">
                    <span className="truncate font-mono">{shown[c.id] ? c.password : "••••••••"}</span>
                    <button type="button" aria-label={shown[c.id] ? `Hide password for ${c.service}` : `Show password for ${c.service}`} onClick={() => setShown(s => ({ ...s, [c.id]: !s[c.id] }))} className="shrink-0 hover:text-foreground">
                      {shown[c.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <button type="button" aria-label={`Copy password for ${c.service}`} onClick={() => copy(c.password, `p${c.id}`)} className="shrink-0 hover:text-foreground">
                      {copied === `p${c.id}` ? <span className="text-xs text-ok">Copied</span> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </span>
                  {isAdmin && (
                    <button type="button" aria-label={`Delete login for ${c.service}`} onClick={() => remove.mutate(c.id)} className="shrink-0 rounded p-1 text-muted-foreground hover:text-bad">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="space-y-5">
        {isAdmin && (
          <Card>
            <CardContent>
              <PanelHeader title="Add a login" />
              <form
                onSubmit={e => { e.preventDefault(); if (service.trim() && username.trim() && password.trim() && me) add.mutate(); }}
                className="space-y-2.5"
              >
                <div>
                  <label htmlFor="cred-service" className={labelCls}>Service</label>
                  <Input id="cred-service" value={service} onChange={e => setService(e.target.value)} placeholder="Supabase" />
                </div>
                <div>
                  <label htmlFor="cred-user" className={labelCls}>Username or email</label>
                  <Input id="cred-user" value={username} onChange={e => setUsername(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="cred-pass" className={labelCls}>Password</label>
                  <Input id="cred-pass" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
                </div>
                {error && <p className="text-xs text-bad">{error}</p>}
                <Button type="submit" disabled={!service.trim() || !username.trim() || !password.trim() || add.isPending}>Save login</Button>
              </form>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent>
            <p className="flex items-center gap-2 text-[13.5px] font-semibold text-foreground"><Lock className="h-4 w-4 text-muted-foreground" aria-hidden />Who can see this</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Logins are visible to admins and to people assigned to this project. Only admins can add or remove them.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
