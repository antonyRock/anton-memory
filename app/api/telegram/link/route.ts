import { NextResponse } from "next/server";
import {
  createTelegramLinkCode,
  getTelegramBotUsername,
  getTelegramLinkStatus
} from "@/lib/telegram-users";
import { isTelegramConfigured } from "@/lib/telegram-config";
import { handleAuthenticatedRoute } from "@/lib/server-auth";

export const runtime = "nodejs";

function linkPayload(input: {
  code?: string;
  expiresAt?: string | null;
  linked?: boolean;
}) {
  const botUsername = getTelegramBotUsername();
  const code = input.code ?? undefined;
  return {
    linked: Boolean(input.linked),
    botUsername,
    code,
    expiresAt: input.expiresAt ?? undefined,
    command: code ? `/link ${code}` : undefined
  };
}

export async function GET(request: Request) {
  return handleAuthenticatedRoute(request, async (user) => {
    if (!isTelegramConfigured()) {
      return NextResponse.json(
        { error: "Telegram не настроен на сервере." },
        { status: 503 }
      );
    }

    const status = await getTelegramLinkStatus(user.id);
    const expiresAt = status.pendingExpiresAt;
    const expiresMs = expiresAt ? Date.parse(expiresAt) : NaN;
    const codeActive = Boolean(
      status.pendingCode && Number.isFinite(expiresMs) && expiresMs > Date.now()
    );

    return NextResponse.json(
      linkPayload({
        linked: status.linked,
        code: codeActive ? status.pendingCode ?? undefined : undefined,
        expiresAt: codeActive ? expiresAt : undefined
      })
    );
  });
}

export async function POST(request: Request) {
  return handleAuthenticatedRoute(request, async (user) => {
    if (!isTelegramConfigured()) {
      return NextResponse.json(
        { error: "Telegram не настроен на сервере." },
        { status: 503 }
      );
    }

    const status = await getTelegramLinkStatus(user.id);
    if (status.linked) {
      return NextResponse.json(
        linkPayload({
          linked: true
        })
      );
    }

    const link = await createTelegramLinkCode(user.id);
    return NextResponse.json(
      linkPayload({
        linked: false,
        code: link.code,
        expiresAt: link.expiresAt
      })
    );
  });
}
