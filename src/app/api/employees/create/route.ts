import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: caller } = await supabase
    .from("employees")
    .select("role")
    .eq("id", user.id)
    .single();
  if (caller?.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as {
    full_name?: string; email?: string; password?: string; role?: string;
  } | null;

  const { full_name, email, password, role } = body ?? {};
  if (!full_name?.trim() || !email?.trim() || !password || password.length < 8 || (role !== "admin" && role !== "member")) {
    return NextResponse.json({ error: "Missing or invalid fields (password must be at least 8 characters)" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? "Failed to create user" }, { status: 400 });
  }

  const { data: employee, error: insertError } = await admin
    .from("employees")
    .insert({ id: created.user.id, full_name: full_name.trim(), email: email.trim(), role })
    .select()
    .single();
  if (insertError) {
    // Roll back the auth user so a failed insert doesn't leave an orphaned login.
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({ employee });
}
