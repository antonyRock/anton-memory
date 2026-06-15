import { NextResponse } from "next/server";
import { setTelegramWebhook } from "@/lib/telegram-api";
import { getTelegramWebhookSecret, isTelegramConfigured } from "@/lib/telegram-config";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: "Telegram is not configured." }, { status: 503 });
  }

  const secret = getTelegramWebhookSecret();
  const headerSecret = request.headers.get("x-telegram-setup-secret");
  if (!headerSecret || headerSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = new URL(request.url).origin;
  const data = await setTelegramWebhook(origin, secret);

  return NextResponse.json({
    ok: true,
    webhookUrl: `${origin.replace(/\/$/, "")}/api/telegram/webhook`,
    telegram: data
  });
}
