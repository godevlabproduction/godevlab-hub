"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, FolderKanban, StickyNote, Users, LogOut, Sparkles,
  ClipboardList, CheckSquare, ExternalLink, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemePicker } from "@/components/theme-picker";
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
    title: "Tools",
    items: [
      { href: "/dashboard/tools/eye-timer", label: "Eye Rest Timer", icon: Eye },
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
    <aside className="glass-panel w-64 shrink-0 flex flex-col h-[calc(100dvh-2.5rem)] sticky top-5">
      <div className="p-4">
        <div className="flex items-center gap-3 px-1 py-1">
          <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand-700 to-brand-800">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <p className="font-mono text-base font-bold text-sidebar-foreground">GoDevLab</p>
        </div>
      </div>
      <nav className="flex-1 px-3 pb-3">
        <div className="space-y-6">
          {navSections.map((section) => (
            <div key={section.title} className="space-y-1">
              <p className="px-3 text-[10px] font-mono font-medium uppercase tracking-[0.1em] text-muted-foreground">
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
                      className="flex items-center gap-3 rounded-2xl px-3 py-2.5 font-mono text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                    >
                      <item.icon className="w-4 h-4" />
                      {item.label}
                    </a>
                  ) : (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl px-3 py-2.5 font-mono text-sm font-medium transition-colors",
                        isActive(item.href)
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
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
      <div className="space-y-2 p-3">
        <div className="flex items-center justify-between gap-2 px-1 pb-2">
          {employee && (
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-mono font-bold text-primary-foreground">
                {employee.full_name.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-medium text-sidebar-foreground">{employee.full_name}</p>
                <p className="font-mono text-[11px] text-muted-foreground capitalize">{employee.role}</p>
              </div>
            </div>
          )}
          <ThemePicker />
        </div>
        <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={handleLogout}>
          <LogOut className="w-4 h-4 mr-2" />
          Sign Out
        </Button>
      </div>
    </aside>
  );
}
