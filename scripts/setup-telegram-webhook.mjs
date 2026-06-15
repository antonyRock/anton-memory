import { readFileSync } from "node:fs";

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
    // .env.local is optional if vars are already in the environment
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let origin = process.env.TBRAIN_APP_ORIGIN?.trim() || "https://tbrain.vercel.app";
  let mode = "auto";

  for (const arg of args) {
    if (arg === "--via-vercel") {
      mode = "vercel";
      continue;
    }
    if (arg === "--direct") {
      mode = "direct";
      continue;
    }
    if (!arg.startsWith("-")) {
      origin = arg;
    }
  }

  return { origin: origin.replace(/\/$/, ""), mode };
}

async function setupViaVercel(origin, secret) {
  const response = await fetch(`${origin}/api/telegram/setup-webhook`, {
    method: "POST",
    headers: { "x-telegram-setup-secret": secret }
  });
  const data = await response.json().catch(() => ({}));
  console.log(JSON.stringify(data, null, 2));

  if (!response.ok || !data.ok) {
    process.exit(1);
  }

  console.log(`Webhook set to ${data.webhookUrl ?? `${origin}/api/telegram/webhook`}`);
}

async function setupDirect(token, secret, origin) {
  const url = `${origin}/api/telegram/webhook`;
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ["message"]
    })
  });
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));

  if (!response.ok || !data.ok) {
    process.exit(1);
  }

  console.log(`Webhook set to ${url}`);
}

loadEnvLocal();

const { origin, mode } = parseArgs(process.argv);
const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

if (!secret) {
  console.error("Need TELEGRAM_WEBHOOK_SECRET in .env.local (or environment).");
  process.exit(1);
}

if (mode === "vercel") {
  await setupViaVercel(origin, secret);
  process.exit(0);
}

if (mode === "direct") {
  if (!token) {
    console.error("Need TELEGRAM_BOT_TOKEN for --direct mode.");
    process.exit(1);
  }
  await setupDirect(token, secret, origin);
  process.exit(0);
}

// auto: try direct first, fall back to Vercel when Telegram API is blocked locally
if (token) {
  try {
    await setupDirect(token, secret, origin);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/fetch failed|timeout|timed out|ECONNREFUSED|ENOTFOUND/i.test(message)) {
      throw error;
    }
    console.warn("Telegram API недоступен с этого ПК. Пробую через Vercel...");
  }
} else {
  console.warn("TELEGRAM_BOT_TOKEN не задан — использую Vercel.");
}

await setupViaVercel(origin, secret);
