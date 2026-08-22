import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    token?: string; slug?: string; title?: string; client_name?: string;
    description?: string; status?: string; priority?: string; due_date?: string;
    repo_path?: string; repo_url?: string; stack?: string[];
  } | null;

  const { token, slug, title } = body ?? {};
  if (!token || !slug?.trim() || !title?.trim()) {
    return NextResponse.json({ error: "Missing token, slug, or title" }, { status: 400 });
  }

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

  const { data: existingProject } = await admin
    .from("projects")
    .select("*")
    .eq("slug", slug.trim())
    .maybeSingle();

  if (existingProject) {
    return NextResponse.json({ project: existingProject });
  }

  const { data: created, error } = await admin
    .from("projects")
    .insert({
      slug: slug.trim(),
      title: title.trim(),
      client_name: body?.client_name ?? null,
      description: body?.description ?? null,
      status: body?.status ?? "active",
      priority: body?.priority ?? "medium",
      due_date: body?.due_date ?? null,
      repo_path: body?.repo_path ?? null,
      repo_url: body?.repo_url ?? null,
      stack: body?.stack ?? [],
      created_by: tokenRow.employee_id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ project: created });
}
