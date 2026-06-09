import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  try {
    const raw = readFileSync(".env.local", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    console.error("Could not read .env.local");
    process.exit(1);
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

console.log("Supabase URL:", url);

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const list = await supabase
  .from("projects")
  .select("id, title")
  .limit(5);

if (list.error) {
  console.error("\n❌ SELECT from projects failed:");
  console.error("   Code:", list.error.code);
  console.error("   Message:", list.error.message);
  console.error("   Details:", list.error.details ?? "(none)");
  process.exit(1);
}

console.log("\n✅ Table projects exists. Rows:", list.data?.length ?? 0);
if (list.data?.length) {
  console.log("   Sample:", list.data);
}

const insert = await supabase
  .from("projects")
  .insert({ title: "__diagnostic_test__" })
  .select("id, title")
  .single();

if (insert.error) {
  console.error("\n❌ INSERT into projects failed:");
  console.error("   Code:", insert.error.code);
  console.error("   Message:", insert.error.message);
  process.exit(1);
}

console.log("\n✅ INSERT works. Created test project id:", insert.data.id);

await supabase.from("projects").delete().eq("id", insert.data.id);
console.log("✅ Test project deleted.");
