import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const VALID_UPDATE_TYPES = ["progress", "note", "blocker", "decision"] as const;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    token?: string; project_id?: string; title?: string; details?: string; update_type?: string;
  } | null;

  const { token, project_id, title, details, update_type } = body ?? {};
  if (!token || !project_id || !title?.trim()) {
    return NextResponse.json({ error: "Missing token, project_id, or title" }, { status: 400 });
  }
  const updateType = VALID_UPDATE_TYPES.includes(update_type as typeof VALID_UPDATE_TYPES[number])
    ? (update_type as typeof VALID_UPDATE_TYPES[number])
    : "progress";

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const admin = createAdminClient();

  const { data: tokenRow } = await admin
    .from("employee_sync_tokens")
    .select("employee_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!tokenRow) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const { error } = await admin.from("project_updates").insert({
    project_id,
    title: title.trim(),
    details: details?.trim() || "",
    update_type: updateType,
    created_by: tokenRow.employee_id,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
