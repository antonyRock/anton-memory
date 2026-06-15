import { NextResponse } from "next/server";
import { handleTelegramUpdate, type TelegramUpdate } from "@/lib/telegram-handler";
import { getTelegramWebhookSecret, isTelegramConfigured } from "@/lib/telegram-config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: "Telegram is not configured." }, { status: 503 });
  }

  const secret = getTelegramWebhookSecret();
  const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (!headerSecret || headerSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    await handleTelegramUpdate(update);
  } catch (error) {
    console.error("Telegram webhook error:", error);
  }

  return NextResponse.json({ ok: true });
}
