"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getEmployees } from "@/lib/supabase/queries";
import { useCurrentEmployee } from "@/hooks/use-employee";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const roleStyles: Record<string, string> = {
  admin: "border-brand-300 bg-brand-50 text-brand-700",
  member: "border-gray-200 bg-gray-100 text-gray-600",
};

export default function EmployeesPage() {
  const supabase = createClient();
  const { data: employee } = useCurrentEmployee();
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => getEmployees(supabase),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Team</h1>
        <p className="mt-1 text-sm text-muted-foreground">{employees.length} member{employees.length !== 1 ? "s" : ""}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {employees.map(emp => (
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
            </CardContent>
          </Card>
        ))}

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
