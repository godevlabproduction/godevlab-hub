import { randomBytes, createHash } from "crypto";
import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  const { data: caller } = await supabase.from("employees").select("role").eq("id", user.id).single();
  if (caller?.role !== "admin") {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }

  return { userId: user.id };
}

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employeeId");
  if (!employeeId) {
    return NextResponse.json({ error: "Missing employeeId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("employee_sync_tokens")
    .select("created_at, regenerated_at")
    .eq("employee_id", employeeId)
    .maybeSingle();

  return NextResponse.json({
    exists: Boolean(data),
    createdAt: data?.created_at ?? null,
    regeneratedAt: data?.regenerated_at ?? null,
  });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await request.json().catch(() => null) as { employeeId?: string } | null;
  const employeeId = body?.employeeId;
  if (!employeeId) {
    return NextResponse.json({ error: "Missing employeeId" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: targetEmployee } = await admin.from("employees").select("full_name").eq("id", employeeId).single();
  if (!targetEmployee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const token = `gdl_sync_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { data: existing } = await admin
    .from("employee_sync_tokens")
    .select("employee_id")
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("employee_sync_tokens")
      .update({ token_hash: tokenHash, regenerated_at: new Date().toISOString() })
      .eq("employee_id", employeeId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { error } = await admin
      .from("employee_sync_tokens")
      .insert({ employee_id: employeeId, token_hash: tokenHash, created_by: auth.userId });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ token, employeeId, employeeName: targetEmployee.full_name });
}
