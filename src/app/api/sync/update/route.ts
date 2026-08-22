import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const VALID_UPDATE_TYPES = ["progress", "note", "blocker", "decision"] as const;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    token?: string; employee_email?: string; title?: string; details?: string; update_type?: string;
  } | null;

  const { token, employee_email, title, details, update_type } = body ?? {};
  if (!token || !title?.trim()) {
    return NextResponse.json({ error: "Missing token or title" }, { status: 400 });
  }
  const updateType = VALID_UPDATE_TYPES.includes(update_type as typeof VALID_UPDATE_TYPES[number])
    ? (update_type as typeof VALID_UPDATE_TYPES[number])
    : "progress";

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const admin = createAdminClient();

  const { data: tokenRow } = await admin
    .from("project_sync_tokens")
    .select("project_id, created_by")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!tokenRow) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  let attributedTo = tokenRow.created_by;
  if (employee_email?.trim()) {
    const { data: matchedEmployee } = await admin
      .from("employees")
      .select("id")
      .eq("email", employee_email.trim())
      .maybeSingle();
    if (matchedEmployee) {
      attributedTo = matchedEmployee.id;
    }
  }

  const { error } = await admin.from("project_updates").insert({
    project_id: tokenRow.project_id,
    title: title.trim(),
    details: details?.trim() || "",
    update_type: updateType,
    created_by: attributedTo,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
