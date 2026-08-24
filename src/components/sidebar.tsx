"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, FolderKanban, StickyNote, Users, LogOut, Sparkles,
  ClipboardList, CheckSquare, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { Employee } from "@/types";

const navSections = [
  {
    title: "Operations",
    items: [
      { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { href: "/dashboard/employees", label: "Employees", icon: Users },
      { href: "/dashboard/operations/employee-tasks", label: "Employee Tasks", icon: ClipboardList },
      { href: "/dashboard/operations/personal-tasks", label: "My Tasks", icon: CheckSquare },
    ],
  },
  {
    title: "Project Tracking",
    items: [
      { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
      { href: "/dashboard/notes", label: "Notes", icon: StickyNote },
    ],
  },
  {
    title: "Apps",
    items: [
      { href: "https://dashboard.gogevgelija.com", label: "GoGevgelija Dashboard", icon: ExternalLink, external: true },
    ],
  },
];

interface SidebarProps {
  employee: Employee | null;
}

export function Sidebar({ employee }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <aside className="w-64 border-r bg-white flex flex-col h-screen sticky top-0">
      <div className="p-4">
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">GoDevLab</p>
            <p className="text-xs text-muted-foreground">Agency Hub</p>
          </div>
        </div>
      </div>
      <Separator />
      <nav className="flex-1 p-3">
        <div className="space-y-5">
          {navSections.map((section) => (
            <div key={section.title} className="space-y-1.5">
              <p className="px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {section.title}
              </p>
              <div className="space-y-1">
                {section.items.map((item) =>
                  "external" in item && item.external ? (
                    <a
                      key={item.href}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-gray-600 hover:bg-gray-100"
                    >
                      <item.icon className="w-4 h-4" />
                      {item.label}
                    </a>
                  ) : (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                        isActive(item.href)
                          ? "bg-brand-50 text-brand-700"
                          : "text-gray-600 hover:bg-gray-100"
                      )}
                    >
                      <item.icon className="w-4 h-4" />
                      {item.label}
                    </Link>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <Separator />
      <div className="p-3 space-y-2">
        {employee && (
          <div className="px-3 py-2">
            <p className="text-sm font-medium truncate">{employee.full_name}</p>
            <p className="text-xs text-muted-foreground capitalize">{employee.role}</p>
          </div>
        )}
        <Button variant="ghost" className="w-full justify-start text-gray-600" onClick={handleLogout}>
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}
