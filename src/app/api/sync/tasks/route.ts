import { NextResponse } from "next/server";
import { resolveSyncAuth } from "@/lib/supabase/sync-auth";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const auth = await resolveSyncAuth(token);
  if ("error" in auth) return auth.error;

  const { data, error } = await auth.admin
    .from("project_tasks")
    .select("id, title, details, status, due_date")
    .eq("project_id", auth.projectId)
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ tasks: data });
}
