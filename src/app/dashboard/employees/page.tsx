"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Users, PlusCircle, X, Radio, RefreshCw, Copy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getEmployees, createEmployee, getProjects,
  getProjectAssignments, assignEmployeeToProject, unassignEmployeeFromProject,
  getEmployeeSyncTokenStatus, generateEmployeeSyncToken,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { EmployeeRole } from "@/types";

const roleStyles: Record<string, string> = {
  admin: "border-brand-300 bg-brand-50 text-brand-700",
  member: "border-gray-200 bg-gray-100 text-gray-600",
};

function buildEmployeeSyncSnippet(employeeName: string, token: string): string {
  return `## GoDevLab Hub — live sync

This is your personal GoDevLab Hub sync token (\`${employeeName}\`). It works across every project on this laptop — nothing project-specific to set up.

At the start of a session in any project worth tracking in the Hub, first make sure it's registered (safe to call every session — it's find-or-create by slug, so it never duplicates):

\`\`\`bash
curl -s -X POST http://localhost:3000/api/projects/register \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${token}","slug":"<short-project-slug>","title":"<project name>","description":"<one-line description>","stack":["..."],"repo_path":"<absolute path to this project>"}'
\`\`\`

This returns \`{"project": {"id": "...", ...}}\` — note the \`id\`, you need it for updates below (just remember it for the rest of this session).

After finishing each meaningful task, milestone, bug fix, or decision, post a progress update:

\`\`\`bash
curl -s -X POST http://localhost:3000/api/sync/update \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${token}","project_id":"<id from above>","title":"<short title>","details":"<1-3 sentences on what changed>","update_type":"progress"}'
\`\`\`

Use \`update_type\`: \`"progress"\` (default), \`"blocker"\`, \`"decision"\`, or \`"note"\`.

This requires the GoDevLab Hub dev server (\`npm run dev\`) running on this laptop to receive updates.`;
}

export default function EmployeesPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: employee } = useCurrentEmployee();
  const isAdmin = employee?.role === "admin";

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => getEmployees(supabase),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(supabase),
    enabled: isAdmin,
  });
  const { data: assignments = [] } = useQuery({
    queryKey: ["project_assignments"],
    queryFn: () => getProjectAssignments(supabase),
    enabled: isAdmin,
  });

  const [addingEmployee, setAddingEmployee] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<EmployeeRole>("member");
  const [createError, setCreateError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [syncTokens, setSyncTokens] = useState<Record<string, string>>({});
  const [regenerateDialogEmployeeId, setRegenerateDialogEmployeeId] = useState<string | null>(null);
  const [copiedSnippetFor, setCopiedSnippetFor] = useState<string | null>(null);
  const [syncGenerateError, setSyncGenerateError] = useState<string | null>(null);

  const createEmployeeMutation = useMutation({
    mutationFn: () => createEmployee({ full_name: newName, email: newEmail, password: newPassword, role: newRole }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      setNewName(""); setNewEmail(""); setNewPassword(""); setNewRole("member");
      setAddingEmployee(false); setCreateError(null);
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const assignMutation = useMutation({
    mutationFn: ({ projectId, employeeId }: { projectId: string; employeeId: string }) =>
      assignEmployeeToProject(supabase, projectId, employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project_assignments"] });
      setAssignError(null);
    },
    onError: (err: Error) => setAssignError(err.message),
  });
  const unassignMutation = useMutation({
    mutationFn: ({ projectId, employeeId }: { projectId: string; employeeId: string }) =>
      unassignEmployeeFromProject(supabase, projectId, employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project_assignments"] });
      setAssignError(null);
    },
    onError: (err: Error) => setAssignError(err.message),
  });

  const generateEmployeeSyncTokenMutation = useMutation({
    mutationFn: (employeeId: string) => generateEmployeeSyncToken(employeeId),
    onSuccess: (data) => {
      setSyncTokens(t => ({ ...t, [data.employeeId]: data.token }));
      setRegenerateDialogEmployeeId(null);
      queryClient.invalidateQueries({ queryKey: ["employee-sync-status", data.employeeId] });
      setSyncGenerateError(null);
    },
    onError: (err: Error) => setSyncGenerateError(err.message),
  });

  function copySnippet(employeeId: string, text: string) {
    navigator.clipboard.writeText(text);
    setCopiedSnippetFor(employeeId);
    setTimeout(() => setCopiedSnippetFor(null), 1500);
  }

  const canCreate = Boolean(newName.trim() && newEmail.trim() && newPassword.length >= 8);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">{employees.length} member{employees.length !== 1 ? "s" : ""}</p>
        </div>
        {isAdmin && !addingEmployee && (
          <Button size="sm" className="bg-brand-700 hover:bg-brand-800" onClick={() => setAddingEmployee(true)}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add employee
          </Button>
        )}
      </div>

      {isAdmin && addingEmployee && (
        <Card>
          <CardHeader><CardTitle className="text-base">New employee</CardTitle></CardHeader>
          <CardContent>
            <form
              onSubmit={e => { e.preventDefault(); if (canCreate) createEmployeeMutation.mutate(); }}
              className="grid gap-3 sm:grid-cols-2"
            >
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full name" />
              <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email" />
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Initial password (min 8 chars)" />
              <select
                value={newRole}
                onChange={e => setNewRole(e.target.value as EmployeeRole)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              {createError && <p className="sm:col-span-2 text-sm text-red-600">{createError}</p>}
              <div className="sm:col-span-2 flex gap-2">
                <Button type="submit" disabled={!canCreate || createEmployeeMutation.isPending} className="bg-brand-700 hover:bg-brand-800">
                  {createEmployeeMutation.isPending ? "Creating..." : "Create employee"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setAddingEmployee(false); setCreateError(null); }}>
                  <X className="mr-1 h-4 w-4" /> Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {employees.map(emp => {
          const empAssignments = assignments.filter(a => a.employee_id === emp.id);
          const isExpanded = expandedId === emp.id;
          return (
            <Card key={emp.id} className={emp.id === employee?.id ? "border-brand-300" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
                    {emp.full_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                  </div>
                  <Badge variant="outline" className={roleStyles[emp.role]}>{emp.role}</Badge>
                </div>
                <CardTitle className="mt-3 text-base">{emp.full_name}{emp.id === employee?.id && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}</CardTitle>
                <CardDescription>{emp.email}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Joined {format(new Date(emp.created_at), "MMM d, yyyy")}</p>
                {isAdmin && emp.role === "member" && (
                  <div className="mt-3 border-t pt-3">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : emp.id)}
                      className="text-xs font-medium text-brand-700 hover:text-brand-800"
                    >
                      {empAssignments.length} project{empAssignments.length !== 1 ? "s" : ""} assigned {isExpanded ? "▲" : "▼"}
                    </button>
                    {isExpanded && (
                      <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                        {projects.length === 0 && <p className="text-xs text-muted-foreground">No projects yet.</p>}
                        {projects.map(p => {
                          const checked = empAssignments.some(a => a.project_id === p.id);
                          return (
                            <label key={p.id} className="flex items-center gap-2 text-xs">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  if (checked) unassignMutation.mutate({ projectId: p.id, employeeId: emp.id });
                                  else assignMutation.mutate({ projectId: p.id, employeeId: emp.id });
                                }}
                              />
                              <span className="truncate">{p.title}</span>
                            </label>
                          );
                        })}
                        {assignError && <p className="text-xs text-red-600">{assignError}</p>}
                      </div>
                    )}
                  </div>
                )}
                {isAdmin && (
                  <EmployeeSyncSection
                    employeeId={emp.id}
                    employeeName={emp.full_name}
                    generateMutation={generateEmployeeSyncTokenMutation}
                    syncToken={syncTokens[emp.id] ?? null}
                    regenerateDialogOpen={regenerateDialogEmployeeId === emp.id}
                    onOpenRegenerateDialog={() => setRegenerateDialogEmployeeId(emp.id)}
                    onCloseRegenerateDialog={() => setRegenerateDialogEmployeeId(null)}
                    copiedSnippet={copiedSnippetFor === emp.id}
                    onCopySnippet={text => copySnippet(emp.id, text)}
                    generateError={syncGenerateError}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}

        {employees.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-12 text-center text-sm text-muted-foreground">
            <Users className="mx-auto mb-2 h-6 w-6" />
            No employees found. Make sure the schema is applied in Supabase.
          </div>
        )}
      </div>
    </div>
  );
}

function EmployeeSyncSection({
  employeeId,
  employeeName,
  generateMutation,
  syncToken,
  regenerateDialogOpen,
  onOpenRegenerateDialog,
  onCloseRegenerateDialog,
  copiedSnippet,
  onCopySnippet,
  generateError,
}: {
  employeeId: string;
  employeeName: string;
  generateMutation: ReturnType<typeof useMutation<{ token: string; employeeId: string; employeeName: string }, Error, string>>;
  syncToken: string | null;
  regenerateDialogOpen: boolean;
  onOpenRegenerateDialog: () => void;
  onCloseRegenerateDialog: () => void;
  copiedSnippet: boolean;
  onCopySnippet: (text: string) => void;
  generateError: string | null;
}) {
  const { data: syncStatus } = useQuery({
    queryKey: ["employee-sync-status", employeeId],
    queryFn: () => getEmployeeSyncTokenStatus(employeeId),
  });

  return (
    <div className="mt-3 border-t pt-3 space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
        <Radio className="h-3.5 w-3.5 text-brand-700" />
        Live Sync
      </div>
      {!syncStatus?.exists && !syncToken && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => generateMutation.mutate(employeeId)}
          disabled={generateMutation.isPending}
        >
          {generateMutation.isPending ? "Setting up..." : "Set up sync"}
        </Button>
      )}
      {generateError && <p className="text-xs text-red-600">{generateError}</p>}
      {syncToken && (
        <div className="space-y-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs text-muted-foreground">
            Paste this into your <code>~/.claude/CLAUDE.md</code>. This token is shown only once — copy it now.
          </p>
          <Textarea readOnly rows={8} value={buildEmployeeSyncSnippet(employeeName, syncToken)} className="font-mono text-xs" />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onCopySnippet(buildEmployeeSyncSnippet(employeeName, syncToken))}
          >
            {copiedSnippet ? <span className="text-xs text-green-600">Copied</span> : <><Copy className="mr-1.5 h-3.5 w-3.5" />Copy snippet</>}
          </Button>
        </div>
      )}
      {syncStatus?.exists && !syncToken && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            Sync active — {syncStatus.regeneratedAt
              ? `regenerated ${formatDistanceToNow(new Date(syncStatus.regeneratedAt), { addSuffix: true })}`
              : `set up ${formatDistanceToNow(new Date(syncStatus.createdAt!), { addSuffix: true })}`}
          </span>
          <Dialog open={regenerateDialogOpen} onOpenChange={open => (open ? onOpenRegenerateDialog() : onCloseRegenerateDialog())}>
            <DialogTrigger className={cn(buttonVariants(), "h-7 px-2.5 text-xs bg-white border border-gray-200 text-gray-700 hover:bg-gray-50")}>
              <RefreshCw className="mr-1 h-3 w-3 inline" />Regenerate
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Regenerate sync token?</DialogTitle></DialogHeader>
              <p className="text-sm text-muted-foreground">
                The current token will stop working immediately. Any project sync calls using it will get rejected (401) until updated with the new one.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={onCloseRegenerateDialog}>Cancel</Button>
                <Button
                  type="button"
                  className="bg-red-600 hover:bg-red-700"
                  onClick={() => generateMutation.mutate(employeeId)}
                  disabled={generateMutation.isPending}
                >
                  {generateMutation.isPending ? "Regenerating..." : "Regenerate anyway"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}
