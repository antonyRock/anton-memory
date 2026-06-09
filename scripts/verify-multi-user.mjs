import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ANTON_ID = "f224756a-d4ae-4f09-a315-9991c03ebe84";
const TABLES = [
  "conversations",
  "messages",
  "projects",
  "documents",
  "facts",
  "entities",
  "tasks"
];

function loadEnvLocal() {
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
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing Supabase env in .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false }
});

let failed = false;

for (const table of TABLES) {
  const { count: total, error: totalError } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });

  if (totalError) {
    console.error(`FAIL ${table}: ${totalError.message}`);
    failed = true;
    continue;
  }

  const { count: nullCount, error: nullError } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .is("user_id", null);

  if (nullError) {
    console.error(`FAIL ${table} null check: ${nullError.message}`);
    failed = true;
    continue;
  }

  const { count: otherCount, error: otherError } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .neq("user_id", ANTON_ID);

  if (otherError) {
    console.error(`FAIL ${table} owner check: ${otherError.message}`);
    failed = true;
    continue;
  }

  const ok = (nullCount ?? 0) === 0 && (otherCount ?? 0) === 0;
  console.log(
    `${ok ? "OK" : "WARN"} ${table}: rows=${total ?? 0}, null_user_id=${nullCount ?? 0}, not_anton=${otherCount ?? 0}`
  );
  if (!ok) failed = true;
}

const { data: profiles, error: profilesError } = await supabase
  .from("users")
  .select("id, display_name")
  .in("id", [ANTON_ID, "8c246548-94a6-4cab-a5d9-718a64f8f887"]);

if (profilesError) {
  console.error(`FAIL users: ${profilesError.message}`);
  failed = true;
} else {
  console.log(`OK users profiles: ${(profiles ?? []).map((p) => p.display_name).join(", ") || "(none)"}`);
}

if (failed) {
  console.error("\nMulti-user verification failed.");
  process.exit(1);
}

console.log("\nMulti-user migration verified.");
