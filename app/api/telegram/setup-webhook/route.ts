import { NextResponse } from "next/server";
import { setTelegramWebhook } from "@/lib/telegram-api";
import { getTelegramWebhookSecret, isTelegramConfigured } from "@/lib/telegram-config";

export const runtime = "nodejs";

function resolveAppOrigin(request: Request) {
  const configured = process.env.TBRAIN_APP_ORIGIN?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProduction) {
    return vercelProduction.startsWith("http")
      ? vercelProduction.replace(/\/$/, "")
      : `https://${vercelProduction.replace(/\/$/, "")}`;
  }

  return new URL(request.url).origin.replace(/\/$/, "");
}

export async function POST(request: Request) {
  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: "Telegram is not configured." }, { status: 503 });
  }

  const secret = getTelegramWebhookSecret();
  const headerSecret = request.headers.get("x-telegram-setup-secret");
  if (!headerSecret || headerSecret !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = resolveAppOrigin(request);

  try {
    const data = await setTelegramWebhook(origin, secret);
    return NextResponse.json({
      ok: true,
      webhookUrl: `${origin}/api/telegram/webhook`,
      telegram: data
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook setup failed.";
    console.error("Telegram setup-webhook error:", message);
    return NextResponse.json({ ok: false, error: message, origin }, { status: 502 });
  }
}
