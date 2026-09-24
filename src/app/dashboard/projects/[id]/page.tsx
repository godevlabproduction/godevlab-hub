"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { AccessTab } from "@/components/project/access-tab";
import { ActivityTab } from "@/components/project/activity-tab";
import { BoardTab } from "@/components/project/board-tab";
import { COCKPIT_TABS, CockpitHeader } from "@/components/project/cockpit-header";
import { DocsTab } from "@/components/project/docs-tab";
import { OverviewTab } from "@/components/project/overview-tab";
import { SyncTab } from "@/components/project/sync-tab";
import { TimelineTab } from "@/components/project/timeline-tab";
import { useCockpit } from "@/components/project/use-cockpit";

const TAB_KEYS: readonly string[] = COCKPIT_TABS.map(t => t.key);

export default function ProjectCockpitPage() {
  const { id } = useParams<{ id: string }>();
  const cockpit = useCockpit(id);
  // The active tab lives in the URL hash so a link can open a specific tab.
  // Nothing tab-specific renders until the project has loaded, so reading the
  // hash on the first client render cannot cause a hydration mismatch.
  const [tab, setTab] = useState(() => {
    if (typeof window === "undefined") return "overview";
    const fromHash = window.location.hash.slice(1);
    return TAB_KEYS.includes(fromHash) ? fromHash : "overview";
  });

  const goTo = (next: string) => {
    setTab(next);
    window.history.replaceState(null, "", `#${next}`);
  };

  if (cockpit.loading) {
    return <p className="p-2 text-sm text-muted-foreground">Loading project…</p>;
  }

  if (!cockpit.project) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3">
          <h1 className="font-heading text-xl font-bold text-foreground">Project not found</h1>
          <p className="text-sm text-muted-foreground">It may have been deleted, or the link is wrong.</p>
          <Link href="/dashboard/projects" className={buttonVariants({ variant: "outline" })}>Back to projects</Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <CockpitHeader cockpit={cockpit} tab={tab} onTab={goTo} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "overview" && <OverviewTab cockpit={cockpit} goTo={goTo} />}
        {tab === "board" && <BoardTab cockpit={cockpit} />}
        {tab === "timeline" && <TimelineTab cockpit={cockpit} goTo={goTo} />}
        {tab === "activity" && <ActivityTab cockpit={cockpit} />}
        {tab === "docs" && <DocsTab cockpit={cockpit} />}
        {tab === "access" && <AccessTab cockpit={cockpit} />}
        {tab === "sync" && <SyncTab key={cockpit.project.id} cockpit={cockpit} />}
      </div>
    </div>
  );
}
