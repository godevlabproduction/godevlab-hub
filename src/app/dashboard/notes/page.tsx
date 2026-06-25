"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { PlusCircle, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getNotes, createNote, deleteNote, getProjects } from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function NotesPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: employee } = useCurrentEmployee();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");

  const { data: notes = [] } = useQuery({ queryKey: ["notes"], queryFn: () => getNotes(supabase) });
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: () => getProjects(supabase) });

  const createMutation = useMutation({
    mutationFn: () => createNote(supabase, {
      title, description, project_id: projectId || undefined, created_by: employee!.id,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notes"] });
      setTitle(""); setDescription(""); setProjectId("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => deleteNote(supabase, noteId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes"] }),
  });

  const canCreate = Boolean(title.trim() && description.trim() && employee);
  const canManage = (createdBy: string) => employee?.role === "admin" || createdBy === employee?.id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Notes</h1>
        <p className="mt-1 text-sm text-muted-foreground">Global notes and per-project references.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader><CardTitle className="text-base">Add Note</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={e => { e.preventDefault(); if (canCreate) createMutation.mutate(); }} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Title</label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Note title" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Content</label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Write your note..." rows={5} />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Project (optional)</label>
                <select
                  value={projectId}
                  onChange={e => setProjectId(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">Global note</option>
                  {projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </div>
              <Button type="submit" className="w-full bg-brand-700 hover:bg-brand-800" disabled={!canCreate || createMutation.isPending}>
                <PlusCircle className="mr-2 h-4 w-4" />
                {createMutation.isPending ? "Adding..." : "Add Note"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-3">
          {notes.length === 0 ? (
            <Card><CardContent className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">No notes yet.</CardContent></Card>
          ) : notes.map(note => (
            <Card key={note.id}>
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">{note.title}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{note.description}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-medium text-brand-700">{note.employee?.full_name ?? "Unknown"}</span>
                      <span>{formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}</span>
                      {note.project_id && <span className="capitalize">{projects.find(p => p.id === note.project_id)?.title ?? "project"}</span>}
                    </div>
                  </div>
                  {canManage(note.created_by) && (
                    <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-red-600" onClick={() => deleteMutation.mutate(note.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
