import { NextResponse } from "next/server";
import { resolveSyncAuth } from "@/lib/supabase/sync-auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    token?: string; employee_email?: string; title?: string; description?: string;
  } | null;

  const { token, employee_email, title, description } = body ?? {};
  if (!token || !title?.trim() || !description?.trim()) {
    return NextResponse.json({ error: "Missing token, title, or description" }, { status: 400 });
  }

  const auth = await resolveSyncAuth(token, employee_email);
  if ("error" in auth) return auth.error;

  const { error } = await auth.admin.from("notes").insert({
    project_id: auth.projectId,
    title: title.trim(),
    description: description.trim(),
    created_by: auth.attributedTo,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
