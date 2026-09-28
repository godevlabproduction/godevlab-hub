"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Pencil, PlusCircle, Trash2, UserX, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getEmployees, createEmployee, updateEmployee, deactivateEmployee, reactivateEmployee, deleteEmployeeAccount,
  getProjects, getProjectAssignments, assignEmployeeToProject, unassignEmployeeFromProject,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { fieldCls, labelCls } from "@/components/project/form-styles";
import type { Employee, EmployeeRole } from "@/types";

const roleStyles: Record<string, string> = {
  admin: "border-primary/40 bg-primary/10 text-primary",
  member: "border-border bg-foreground/10 text-muted-foreground",
};

function initials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

export default function EmployeesPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: employee } = useCurrentEmployee();
  const isAdmin = employee?.role === "admin";

  const { data: allEmployees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => getEmployees(supabase),
  });
  const employees = allEmployees.filter(e => !e.deactivated_at);
  const deactivated = allEmployees.filter(e => e.deactivated_at);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(supabase),
    enabled: isAdmin,
  });
  const { data: assignments = [] } = useQuery({
    queryKey: ["project-assignments"],
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
  const [editing, setEditing] = useState<Employee | null>(null);
  const [removing, setRemoving] = useState<Employee | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["employees"] });

  const createEmployeeMutation = useMutation({
    mutationFn: () => createEmployee({ full_name: newName, email: newEmail, password: newPassword, role: newRole }),
    onSuccess: () => {
      invalidate();
      setNewName(""); setNewEmail(""); setNewPassword(""); setNewRole("member");
      setAddingEmployee(false); setCreateError(null);
    },
    onError: (err: Error) => setCreateError(err.message),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => reactivateEmployee(id),
    onSuccess: invalidate,
  });

  const assignMutation = useMutation({
    mutationFn: ({ projectId, employeeId }: { projectId: string; employeeId: string }) =>
      assignEmployeeToProject(supabase, projectId, employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-assignments"] });
      setAssignError(null);
    },
    onError: (err: Error) => setAssignError(err.message),
  });
  const unassignMutation = useMutation({
    mutationFn: ({ projectId, employeeId }: { projectId: string; employeeId: string }) =>
      unassignEmployeeFromProject(supabase, projectId, employeeId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-assignments"] });
      setAssignError(null);
    },
    onError: (err: Error) => setAssignError(err.message),
  });

  const canCreate = Boolean(newName.trim() && newEmail.trim() && newPassword.length >= 8);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">People</h1>
          <p className="mt-1 text-sm text-muted-foreground">{employees.length} member{employees.length !== 1 ? "s" : ""}</p>
        </div>
        {isAdmin && !addingEmployee && (
          <Button size="sm" onClick={() => setAddingEmployee(true)}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add member
          </Button>
        )}
      </div>

      {isAdmin && addingEmployee && (
        <Card>
          <CardHeader><CardTitle className="text-base">New member</CardTitle></CardHeader>
          <CardContent>
            <form
              onSubmit={e => { e.preventDefault(); if (canCreate) createEmployeeMutation.mutate(); }}
              className="grid gap-3 sm:grid-cols-2"
            >
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full name" />
              <Input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email" />
              <Input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Initial password (min 8 chars)" />
              <select value={newRole} onChange={e => setNewRole(e.target.value as EmployeeRole)} className={fieldCls}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
              {createError && <p className="text-sm text-bad sm:col-span-2">{createError}</p>}
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={!canCreate || createEmployeeMutation.isPending}>
                  {createEmployeeMutation.isPending ? "Creating..." : "Create member"}
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
          const isSelf = emp.id === employee?.id;
          return (
            <Card key={emp.id} className={isSelf ? "border-primary/40" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                    {initials(emp.full_name)}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className={roleStyles[emp.role]}>{emp.role}</Badge>
                    {isAdmin && (
                      <button
                        type="button"
                        aria-label={`Edit ${emp.full_name}`}
                        onClick={() => setEditing(emp)}
                        className="rounded p-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                <CardTitle className="mt-3 text-base">
                  {emp.full_name}
                  {isSelf && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
                </CardTitle>
                <CardDescription>{emp.email}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">Joined {format(new Date(emp.created_at), "MMM d, yyyy")}</p>
                {isAdmin && emp.role === "member" && (
                  <div className="mt-3 border-t border-border pt-3">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : emp.id)}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      {empAssignments.length} project{empAssignments.length !== 1 ? "s" : ""} assigned {isExpanded ? "▲" : "▼"}
                    </button>
                    {isExpanded && (
                      <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">
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
                        {assignError && <p className="text-xs text-bad">{assignError}</p>}
                      </div>
                    )}
                  </div>
                )}
                {isAdmin && !isSelf && (
                  <div className="mt-3 flex gap-2 border-t border-border pt-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => setRemoving(emp)}>
                      <UserX className="mr-1.5 h-3.5 w-3.5" />Remove
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {employees.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-border bg-foreground/5 px-4 py-12 text-center text-sm text-muted-foreground">
            <Users className="mx-auto mb-2 h-6 w-6" />
            No members found. Make sure the schema is applied in Supabase.
          </div>
        )}
      </div>

      {isAdmin && deactivated.length > 0 && (
        <div>
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
            Deactivated ({deactivated.length})
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {deactivated.map(emp => (
              <Card key={emp.id} className="opacity-70">
                <CardContent className="flex items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{emp.full_name}</p>
                    <p className="truncate text-xs text-muted-foreground">{emp.email}</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={reactivateMutation.isPending}
                    onClick={() => reactivateMutation.mutate(emp.id)}
                  >
                    Reactivate
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <EditDialog employee={editing} onClose={() => setEditing(null)} onSaved={invalidate} />
      <RemoveDialog employee={removing} onClose={() => setRemoving(null)} onDone={invalidate} />
    </div>
  );
}

function EditDialog({ employee, onClose, onSaved }: { employee: Employee | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Dialog open={employee !== null} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        {employee && <EditForm employee={employee} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ employee, onClose, onSaved }: { employee: Employee; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(employee.full_name);
  const [email, setEmail] = useState(employee.email);
  const [role, setRole] = useState<EmployeeRole>(employee.role);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const patch: { full_name?: string; email?: string; role?: EmployeeRole } = {};
      if (name.trim() !== employee.full_name) patch.full_name = name.trim();
      if (email.trim() !== employee.email) patch.email = email.trim();
      if (role !== employee.role) patch.role = role;
      return updateEmployee(employee.id, patch);
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  const changed = name.trim() !== employee.full_name || email.trim() !== employee.email || role !== employee.role;

  return (
    <>
      <DialogHeader><DialogTitle>Edit member</DialogTitle></DialogHeader>
      <form
        onSubmit={e => { e.preventDefault(); if (name.trim() && email.trim() && changed) save.mutate(); }}
        className="space-y-3"
      >
        <div>
          <label htmlFor="emp-name" className={labelCls}>Full name</label>
          <Input id="emp-name" autoFocus value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="emp-email" className={labelCls}>Email</label>
          <Input id="emp-email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">They&rsquo;ll sign in with the new email right away.</p>
        </div>
        <div>
          <label htmlFor="emp-role" className={labelCls}>Role</label>
          <select id="emp-role" className={fieldCls} value={role} onChange={e => setRole(e.target.value as EmployeeRole)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        {error && <p className="text-xs text-bad">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!name.trim() || !email.trim() || !changed || save.isPending}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </>
  );
}

function RemoveDialog({ employee, onClose, onDone }: { employee: Employee | null; onClose: () => void; onDone: () => void }) {
  return (
    <Dialog open={employee !== null} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        {employee && <RemoveForm employee={employee} onClose={onClose} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  );
}

function RemoveForm({ employee, onClose, onDone }: { employee: Employee; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deactivate = useMutation({
    mutationFn: () => deactivateEmployee(employee.id),
    onSuccess: () => { onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteEmployeeAccount(employee.id),
    onSuccess: () => { onDone(); onClose(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <>
      <DialogHeader><DialogTitle>Remove {employee.full_name}?</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground">Deactivate</strong> blocks their login immediately and keeps everything they created (projects, tasks, updates) exactly as it is. This is reversible.
      </p>
      {!confirmDelete ? (
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">Delete permanently</strong> removes their account for good. It only works if they haven&rsquo;t created anything yet - otherwise use Deactivate.
        </p>
      ) : (
        <p className="text-sm font-semibold text-bad">This can&rsquo;t be undone. Their login is destroyed immediately.</p>
      )}
      {error && <p className="text-xs text-bad">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        {!confirmDelete && (
          <Button type="button" variant="ghost" className="text-bad hover:text-bad" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />Delete permanently
          </Button>
        )}
        {confirmDelete && (
          <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? "Deleting…" : "Confirm delete"}
          </Button>
        )}
        <Button type="button" disabled={deactivate.isPending} onClick={() => deactivate.mutate()}>
          {deactivate.isPending ? "Deactivating…" : "Deactivate"}
        </Button>
      </div>
    </>
  );
}
