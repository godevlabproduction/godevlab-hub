"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { ExternalLink, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createNote, deleteNote, getNotes, updateProject } from "@/lib/supabase/queries";
import type { ProjectLink } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PanelHeader } from "@/components/hub-ui";
import { labelCls } from "./form-styles";
import type { Cockpit } from "./use-cockpit";

// Only http(s) links are stored, so a pasted "javascript:" URL can never end
// up behind a clickable link.
function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function DocsTab({ cockpit }: { cockpit: Cockpit }) {
  const supabase = createClient();
  const { project, me, canEdit, isAdmin, invalidate } = cockpit;

  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");

  const { data: allNotes = [] } = useQuery({ queryKey: ["notes"], queryFn: () => getNotes(supabase) });
  const notes = allNotes.filter(n => n.project_id === project?.id);

  const saveLinks = useMutation({
    mutationFn: (links: ProjectLink[]) => updateProject(supabase, project!.id, { links }),
    onSuccess: () => invalidate(["projects"]),
    onError: () => setLinkError("Couldn't save the links."),
  });

  const addNote = useMutation({
    mutationFn: () => createNote(supabase, { title: noteTitle.trim(), description: noteBody.trim(), project_id: project!.id, created_by: me!.id }),
    onSuccess: () => { setNoteTitle(""); setNoteBody(""); invalidate(["notes"]); },
  });
  const removeNote = useMutation({
    mutationFn: (id: string) => deleteNote(supabase, id),
    onSuccess: () => invalidate(["notes"]),
  });

  if (!project) return null;
  const links = project.links ?? [];

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="h-fit">
        <CardContent>
          <PanelHeader title="Links" aside={`${links.length + Number(Boolean(project.repo_url)) + Number(Boolean(project.deployed_url))} total`} />
          <ul className="mb-4 space-y-1.5">
            {project.repo_url && (
              <li><a href={project.repo_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-xl px-2.5 py-2 text-[13px] font-medium text-foreground hover:bg-foreground/5">Repository<ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /></a></li>
            )}
            {project.deployed_url && (
              <li><a href={project.deployed_url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between rounded-xl px-2.5 py-2 text-[13px] font-medium text-foreground hover:bg-foreground/5">Production<ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /></a></li>
            )}
            {links.map((l, i) => (
              <li key={`${l.url}-${i}`} className="group flex items-center gap-1">
                <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex flex-1 items-center justify-between rounded-xl px-2.5 py-2 text-[13px] font-medium text-foreground hover:bg-foreground/5">
                  <span className="truncate">{l.label}</span><ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </a>
                {canEdit && (
                  <button type="button" aria-label={`Remove ${l.label}`} onClick={() => saveLinks.mutate(links.filter((_, idx) => idx !== i))} className="rounded p-1 text-muted-foreground hover:text-bad">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
            {links.length === 0 && !project.repo_url && !project.deployed_url && <li className="text-sm text-muted-foreground">No links yet.</li>}
          </ul>
          {canEdit && (
            <form
              onSubmit={e => {
                e.preventDefault();
                const safe = normalizeUrl(url);
                if (!label.trim() || !safe) { setLinkError("Add a label and a valid http(s) address."); return; }
                setLinkError(null);
                saveLinks.mutate([...links, { label: label.trim(), url: safe }]);
                setLabel(""); setUrl("");
              }}
              className="space-y-2 border-t border-border pt-4"
            >
              <div className="grid grid-cols-[120px_1fr] gap-2">
                <div>
                  <label htmlFor="link-label" className={labelCls}>Label</label>
                  <Input id="link-label" value={label} onChange={e => setLabel(e.target.value)} placeholder="Figma" />
                </div>
                <div>
                  <label htmlFor="link-url" className={labelCls}>Address</label>
                  <Input id="link-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" />
                </div>
              </div>
              {linkError && <p className="text-xs text-bad">{linkError}</p>}
              <Button type="submit" variant="outline" size="sm" disabled={saveLinks.isPending}>Add link</Button>
              <p className="text-xs text-muted-foreground">The repository and production addresses are edited from the project details.</p>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardContent>
          <PanelHeader title="Project notes" aside={`${notes.length} notes`} />
          <form
            onSubmit={e => { e.preventDefault(); if (noteTitle.trim() && noteBody.trim() && me) addNote.mutate(); }}
            className="mb-4 space-y-2"
          >
            <label htmlFor="note-title" className="sr-only">Note title</label>
            <Input id="note-title" value={noteTitle} onChange={e => setNoteTitle(e.target.value)} placeholder="Title" />
            <label htmlFor="note-body" className="sr-only">Note</label>
            <Textarea id="note-body" rows={3} value={noteBody} onChange={e => setNoteBody(e.target.value)} placeholder="Meeting notes, decisions, specs…" />
            <Button type="submit" size="sm" disabled={!noteTitle.trim() || !noteBody.trim() || addNote.isPending}>Add note</Button>
          </form>
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes for this project yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {notes.map(n => (
                <li key={n.id} className="rounded-2xl border border-border bg-foreground/[0.04] p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[13.5px] font-semibold text-foreground">{n.title}</p>
                    {(isAdmin || n.created_by === me?.id) && (
                      <button type="button" aria-label={`Delete ${n.title}`} onClick={() => removeNote.mutate(n.id)} className="rounded p-1 text-muted-foreground hover:text-bad">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{n.description}</p>
                  <p className="mt-2 text-[11.5px] text-muted-foreground">{n.employee?.full_name ?? "Someone"} · {formatDistanceToNowStrict(parseISO(n.created_at), { addSuffix: true })}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
