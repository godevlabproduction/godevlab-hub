import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const CONFIG_PATH = path.resolve(__dirname, "../projects.config.json");

interface ProjectConfig {
  slug: string;
  path: string;
}

async function sync() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const configs: ProjectConfig[] = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));

  for (const config of configs) {
    const reportPath = path.join(config.path, "report", "report.json");

    if (!fs.existsSync(reportPath)) {
      console.log(`[skip] ${config.slug} — no report.json found at ${reportPath}`);
      continue;
    }

    await supabase
      .from("projects")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("slug", config.slug);

    console.log(`[synced] ${config.slug}`);
  }

  console.log("Sync complete.");
}

sync().catch(console.error);
