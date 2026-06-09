import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  const raw = readFileSync(".env.local", "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const tables = [
  "conversations",
  "messages",
  "projects",
  "documents",
  "facts",
  "entities",
  "tasks",
  "users"
];

for (const table of tables) {
  const sample = await supabase.from(table).select("*").limit(1);
  if (sample.error) {
    console.log(`${table}: ERROR ${sample.error.message}`);
    continue;
  }
  const row = sample.data?.[0];
  const keys = row ? Object.keys(row) : [];
  console.log(`${table}: has user_id=${keys.includes("user_id")} keys=${keys.join(",")}`);
  if (row?.user_id != null) console.log(`  sample user_id=${row.user_id}`);
}

const conv = await supabase.from("conversations").select("id, user_id").limit(5);
console.log("\nconversations sample:", conv.data);

const distinct = await supabase.from("conversations").select("user_id");
const counts = new Map();
for (const row of distinct.data ?? []) {
  const k = String(row.user_id);
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
console.log("\nconversations user_id distribution:", Object.fromEntries(counts));
