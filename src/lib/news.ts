import type { NewsSection, ProjectActivity, ProjectView } from "@/types";

export const NEWS_SECTIONS: NewsSection[] = ["board", "timeline", "activity", "docs", "access", "sync"];

const ACTIVITY_KEY: Record<NewsSection, keyof ProjectActivity> = {
  board: "board_at",
  timeline: "timeline_at",
  activity: "activity_at",
  docs: "docs_at",
  access: "access_at",
  sync: "sync_at",
};

export interface ProjectNews {
  projectId: string;
  sections: Record<NewsSection, boolean>;
  /** True if any tracked section changed since it was last viewed. */
  hasNews: boolean;
}

// A section has news when its latest activity timestamp exists and is newer
// than this viewer's last visit to that section (or they've never visited).
export function computeProjectNews(activity: ProjectActivity[], views: ProjectView[]): Map<string, ProjectNews> {
  const lastSeen = new Map<string, string>(); // `${projectId}:${section}` -> ISO timestamp
  for (const v of views) lastSeen.set(`${v.project_id}:${v.section}`, v.last_viewed_at);

  const out = new Map<string, ProjectNews>();
  for (const a of activity) {
    const sections = {} as Record<NewsSection, boolean>;
    let hasNews = false;
    for (const section of NEWS_SECTIONS) {
      const at = a[ACTIVITY_KEY[section]];
      const seen = lastSeen.get(`${a.project_id}:${section}`);
      const isNews = Boolean(at) && (!seen || new Date(at as string).getTime() > new Date(seen).getTime());
      sections[section] = isNews;
      if (isNews) hasNews = true;
    }
    out.set(a.project_id, { projectId: a.project_id, sections, hasNews });
  }
  return out;
}

export function totalProjectsWithNews(news: Map<string, ProjectNews>): number {
  let n = 0;
  for (const p of news.values()) if (p.hasNews) n++;
  return n;
}
