import { NextResponse } from "next/server";
import { resolveSyncAuth } from "@/lib/supabase/sync-auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    token?: string; employee_email?: string; description?: string;
  } | null;

  const { token, employee_email, description } = body ?? {};
  if (!token || !description?.trim()) {
    return NextResponse.json({ error: "Missing token or description" }, { status: 400 });
  }

  const auth = await resolveSyncAuth(token, employee_email);
  if ("error" in auth) return auth.error;

  const { error } = await auth.admin
    .from("projects")
    .update({ description: description.trim() })
    .eq("id", auth.projectId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
