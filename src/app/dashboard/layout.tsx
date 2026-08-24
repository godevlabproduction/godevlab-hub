"use client";

import { useCurrentEmployee } from "@/hooks/use-employee";
import { Sidebar } from "@/components/sidebar";
import { AmbientBackground } from "@/components/ambient-background";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { data: employee = null } = useCurrentEmployee();

  return (
    <div className="flex h-screen gap-5 p-5">
      <AmbientBackground />
      <Sidebar employee={employee} />
      <main className="flex-1 overflow-y-auto p-1">{children}</main>
    </div>
  );
}
