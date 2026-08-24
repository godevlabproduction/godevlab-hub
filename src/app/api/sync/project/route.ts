import { NextResponse } from "next/server";
import { resolveSyncAuth } from "@/lib/supabase/sync-auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    token?: string; employee_email?: string; description?: string;
    commit_sha?: string; commit_message?: string;
  } | null;

  const { token, employee_email, description, commit_sha, commit_message } = body ?? {};
  if (!token || (!description?.trim() && !commit_sha?.trim())) {
    return NextResponse.json({ error: "Missing token, and at least one of description or commit_sha" }, { status: 400 });
  }

  const auth = await resolveSyncAuth(token, employee_email);
  if ("error" in auth) return auth.error;

  const update: { description?: string; last_commit_sha?: string; last_commit_message?: string } = {};
  if (description?.trim()) update.description = description.trim();
  if (commit_sha?.trim()) {
    update.last_commit_sha = commit_sha.trim();
    update.last_commit_message = commit_message?.trim() || "";
  }

  const { error } = await auth.admin
    .from("projects")
    .update(update)
    .eq("id", auth.projectId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
