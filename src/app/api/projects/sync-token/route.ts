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
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("project_sync_tokens")
    .select("created_at, regenerated_at")
    .eq("project_id", projectId)
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

  const body = await request.json().catch(() => null) as { projectId?: string } | null;
  const projectId = body?.projectId;
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: project } = await admin.from("projects").select("title").eq("id", projectId).single();
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const token = `gdl_sync_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { data: existing } = await admin
    .from("project_sync_tokens")
    .select("project_id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("project_sync_tokens")
      .update({ token_hash: tokenHash, regenerated_at: new Date().toISOString() })
      .eq("project_id", projectId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { error } = await admin
      .from("project_sync_tokens")
      .insert({ project_id: projectId, token_hash: tokenHash, created_by: auth.userId });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ token, projectId, projectTitle: project.title });
}
