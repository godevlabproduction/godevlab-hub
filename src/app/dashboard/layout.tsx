"use client";

import { useCurrentEmployee } from "@/hooks/use-employee";
import { Sidebar } from "@/components/sidebar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: employee = null } = useCurrentEmployee();

  return (
    <div className="flex h-screen bg-background">
      <Sidebar employee={employee} />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
