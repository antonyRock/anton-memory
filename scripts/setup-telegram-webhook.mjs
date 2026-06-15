import { config } from "dotenv";

config({ path: ".env.local" });

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const origin = process.argv[2]?.trim() || process.env.TBRAIN_APP_ORIGIN?.trim() || "https://tbrain.vercel.app";

if (!token || !secret) {
  console.error("Need TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in .env.local");
  process.exit(1);
}

const url = `${origin.replace(/\/$/, "")}/api/telegram/webhook`;
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
