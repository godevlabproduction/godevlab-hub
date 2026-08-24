import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type SyncAuthResult =
  | { admin: ReturnType<typeof createAdminClient>; projectId: string; attributedTo: string }
  | { error: NextResponse };

export async function resolveSyncAuth(token: string, employeeEmail?: string): Promise<SyncAuthResult> {
  const admin = createAdminClient();
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { data: tokenRow } = await admin
    .from("project_sync_tokens")
    .select("project_id, employee_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!tokenRow) {
    return { error: NextResponse.json({ error: "Invalid token" }, { status: 401 }) };
  }

  // The token now identifies the employee on its own (one token per person
  // per project) - employeeEmail survives only as an explicit override for
  // the rare case someone else is using your token on your behalf.
  let attributedTo = tokenRow.employee_id;
  if (employeeEmail?.trim()) {
    const { data: matchedEmployee } = await admin
      .from("employees")
      .select("id")
      .eq("email", employeeEmail.trim())
      .maybeSingle();
    if (matchedEmployee) {
      attributedTo = matchedEmployee.id;
    }
  }

  return { admin, projectId: tokenRow.project_id, attributedTo };
}
