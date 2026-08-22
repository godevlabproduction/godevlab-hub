"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Users, PlusCircle, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getEmployees, createEmployee, getProjects,
  getProjectAssignments, assignEmployeeToProject, unassignEmployeeFromProject,
} from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { EmployeeRole } from "@/types";

const roleStyles: Record<string, string> = {
  admin: "border-brand-300 bg-brand-50 text-brand-700",
  member: "border-gray-200 bg-gray-100 text-gray-600",
};

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
