import { NextResponse } from "next/server";
import { resolveSyncAuth } from "@/lib/supabase/sync-auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    token?: string; employee_email?: string; title?: string; details?: string; due_date?: string;
  } | null;

  const { token, employee_email, title, details, due_date } = body ?? {};
  if (!token || !title?.trim()) {
    return NextResponse.json({ error: "Missing token or title" }, { status: 400 });
  }

  const auth = await resolveSyncAuth(token, employee_email);
  if ("error" in auth) return auth.error;

  const { error } = await auth.admin.from("project_tasks").insert({
    project_id: auth.projectId,
    title: title.trim(),
    details: details?.trim() || null,
    due_date: due_date || null,
    status: "todo",
    created_by: auth.attributedTo,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
