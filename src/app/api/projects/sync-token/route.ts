import { randomBytes, createHash } from "crypto";
import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Admins can manage sync for any project; a non-admin employee can manage it
// only for a project actually assigned to them (project_assignments).
async function requireProjectAccess(projectId: string) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  const { data: caller } = await supabase.from("employees").select("role").eq("id", user.id).single();
  if (caller?.role === "admin") {
    return { userId: user.id };
  }

  const { data: assignment } = await supabase
    .from("project_assignments")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("employee_id", user.id)
    .maybeSingle();
  if (!assignment) {
    return { error: NextResponse.json({ error: "Admin access or project assignment required" }, { status: 403 }) };
  }

  return { userId: user.id };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  const auth = await requireProjectAccess(projectId);
  if ("error" in auth) return auth.error;

  const admin = createAdminClient();
  const { data } = await admin
    .from("project_sync_tokens")
    .select("created_at, regenerated_at")
    .eq("project_id", projectId)
    .eq("employee_id", auth.userId)
    .maybeSingle();

  return NextResponse.json({
    exists: Boolean(data),
    createdAt: data?.created_at ?? null,
    regeneratedAt: data?.regenerated_at ?? null,
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { projectId?: string } | null;
  const projectId = body?.projectId;
  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  const auth = await requireProjectAccess(projectId);
  if ("error" in auth) return auth.error;

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
    .eq("employee_id", auth.userId)
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("project_sync_tokens")
      .update({ token_hash: tokenHash, regenerated_at: new Date().toISOString() })
      .eq("project_id", projectId)
      .eq("employee_id", auth.userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  } else {
    const { error } = await admin
      .from("project_sync_tokens")
      .insert({ project_id: projectId, employee_id: auth.userId, token_hash: tokenHash });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ token, projectId, projectTitle: project.title });
}
