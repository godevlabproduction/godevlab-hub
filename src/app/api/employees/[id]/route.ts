import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function requireAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };

  const { data: caller } = await supabase.from("employees").select("role").eq("id", user.id).single();
  if (caller?.role !== "admin") {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return { userId: user.id };
}

// True unless this employee is the only admin left - used to block both
// demoting and removing the last admin, which would lock everyone out.
async function isLastAdmin(admin: ReturnType<typeof createAdminClient>, employeeId: string) {
  const { data: target } = await admin.from("employees").select("role").eq("id", employeeId).maybeSingle();
  if (target?.role !== "admin") return false;
  const { count } = await admin.from("employees").select("id", { count: "exact", head: true }).eq("role", "admin");
  return (count ?? 0) <= 1;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  const body = await request.json().catch(() => null) as {
    full_name?: string; email?: string; role?: string; reactivate?: boolean;
  } | null;
  const full_name = body?.full_name?.trim();
  const email = body?.email?.trim();
  const role = body?.role;
  if (role !== undefined && role !== "admin" && role !== "member") {
    return NextResponse.json({ error: "Role must be admin or member" }, { status: 400 });
  }

  const admin = createAdminClient();

  if (role === "member" && await isLastAdmin(admin, id)) {
    return NextResponse.json({ error: "Can't demote the last admin. Promote someone else first." }, { status: 409 });
  }

  if (body?.reactivate) {
    const { error: unbanError } = await admin.auth.admin.updateUserById(id, { ban_duration: "none" });
    if (unbanError) return NextResponse.json({ error: unbanError.message }, { status: 400 });
    const { error } = await admin.from("employees").update({ deactivated_at: null }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (email) {
    const { error: authError } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });
    if (authError) {
      const message = authError.message.toLowerCase().includes("already been registered")
        ? "That email is already in use by another account."
        : authError.message;
      return NextResponse.json({ error: message }, { status: 400 });
    }
  }

  const patch: Record<string, string> = {};
  if (full_name) patch.full_name = full_name;
  if (email) patch.email = email;
  if (role) patch.role = role;

  const { data: updated, error } = await admin.from("employees").update(patch).eq("id", id).select().single();
  if (error) {
    return NextResponse.json({ error: error.code === "23505" ? "That email is already in use." : error.message }, { status: 400 });
  }

  return NextResponse.json({ employee: updated });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const { id } = await params;

  if (id === auth.userId) {
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { searchParams } = new URL(request.url);
  const deactivateOnly = searchParams.get("mode") === "deactivate";

  if (await isLastAdmin(admin, id)) {
    return NextResponse.json({ error: "Can't remove the last admin. Promote someone else first." }, { status: 409 });
  }

  if (deactivateOnly) {
    // Bans login (Supabase Auth: ban_duration in hours, "none" lifts it) and
    // records it on the row. Nothing they created is touched.
    const { error: banError } = await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
    if (banError) return NextResponse.json({ error: banError.message }, { status: 400 });
    const { error } = await admin.from("employees").update({ deactivated_at: new Date().toISOString() }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ success: true, deactivated: true });
  }

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    // No ON DELETE clause on most employees(id) foreign keys means Postgres
    // blocks the delete (23503) the moment this person has created anything.
    const blocked = error.message.toLowerCase().includes("foreign key") || error.code === "23503";
    return NextResponse.json({
      error: blocked
        ? "Can't delete - they've created projects, tasks or other records. Deactivate them instead to keep that history and block their login."
        : error.message,
      blocked,
    }, { status: blocked ? 409 : 400 });
  }

  return NextResponse.json({ success: true, deactivated: false });
}
