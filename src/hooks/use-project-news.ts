"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getProjectActivity, getProjectViews, markProjectSectionSeen } from "@/lib/supabase/queries";
import { computeProjectNews, totalProjectsWithNews } from "@/lib/news";
import { useCurrentEmployee } from "@/hooks/use-employee";
import type { NewsSection } from "@/types";

// Shared "what's new" data: the sidebar's Projects badge, each project card's
// dot, and a project's own tab dots all read from this one pair of queries so
// marking a section seen anywhere updates every badge at once.
export function useProjectNews() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { data: me } = useCurrentEmployee();

  const { data: activity = [] } = useQuery({
    queryKey: ["project-activity"],
    queryFn: () => getProjectActivity(supabase),
    refetchInterval: 30000,
  });
  const { data: views = [] } = useQuery({
    queryKey: ["project-views"],
    queryFn: () => getProjectViews(supabase),
  });

  const news = useMemo(() => computeProjectNews(activity, views), [activity, views]);
  const projectsWithNews = useMemo(() => totalProjectsWithNews(news), [news]);

  const markSeen = useMutation({
    mutationFn: ({ projectId, section }: { projectId: string; section: NewsSection }) =>
      markProjectSectionSeen(supabase, me!.id, projectId, section),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["project-views"] }),
  });

  return {
    news,
    projectsWithNews,
    hasNews: (projectId: string) => news.get(projectId)?.hasNews ?? false,
    sectionHasNews: (projectId: string, section: NewsSection) => news.get(projectId)?.sections[section] ?? false,
    markSeen: (projectId: string, section: NewsSection) => {
      if (me) markSeen.mutate({ projectId, section });
    },
  };
}
