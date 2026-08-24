import { NextResponse } from "next/server";
import { resolveSyncAuth } from "@/lib/supabase/sync-auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    token?: string; employee_email?: string; task_id?: string;
  } | null;

  const { token, employee_email, task_id } = body ?? {};
  if (!token || !task_id) {
    return NextResponse.json({ error: "Missing token or task_id" }, { status: 400 });
  }

  const auth = await resolveSyncAuth(token, employee_email);
  if ("error" in auth) return auth.error;

  const { data: task } = await auth.admin
    .from("project_tasks")
    .select("project_id")
    .eq("id", task_id)
    .maybeSingle();

  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 400 });
  }
  if (task.project_id !== auth.projectId) {
    return NextResponse.json({ error: "Task does not belong to this project" }, { status: 403 });
  }

  const { error } = await auth.admin
    .from("project_tasks")
    .delete()
    .eq("id", task_id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
