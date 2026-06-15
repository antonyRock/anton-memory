import "server-only";

import { getTelegramBotToken } from "@/lib/telegram-config";

const TELEGRAM_API = "https://api.telegram.org";

function botUrl(method: string) {
  const token = getTelegramBotToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  return `${TELEGRAM_API}/bot${token}/${method}`;
}

export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options: { disableWebPagePreview?: boolean } = {}
) {
  const response = await fetch(botUrl("sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096),
      disable_web_page_preview: options.disableWebPagePreview ?? true
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram sendMessage failed: ${body}`);
  }
}

type TelegramFileDescriptor = {
  file_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
};

export async function downloadTelegramFile(file: TelegramFileDescriptor) {
  const metaResponse = await fetch(
    `${botUrl("getFile")}?file_id=${encodeURIComponent(file.file_id)}`
  );
  const meta = (await metaResponse.json()) as {
    ok?: boolean;
    result?: { file_path?: string };
    description?: string;
  };

  if (!metaResponse.ok || !meta.ok || !meta.result?.file_path) {
    throw new Error(meta.description ?? "Telegram getFile failed.");
  }

  const token = getTelegramBotToken();
  const fileResponse = await fetch(
    `${TELEGRAM_API}/file/bot${token}/${meta.result.file_path}`
  );
  if (!fileResponse.ok) {
    throw new Error("Telegram file download failed.");
  }

  const bytes = Buffer.from(await fileResponse.arrayBuffer());
  const fileName =
    file.file_name?.trim() ||
    meta.result.file_path.split("/").pop() ||
    "telegram-file";
  const mimeType = file.mime_type?.trim() || "application/octet-stream";

  return new File([bytes], fileName, { type: mimeType });
}

export async function setTelegramWebhook(appOrigin: string, secret: string) {
  const url = `${appOrigin.replace(/\/$/, "")}/api/telegram/webhook`;
  const response = await fetch(botUrl("setWebhook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ["message"]
    })
  });
  const data = await response.json();
  if (!response.ok || !(data as { ok?: boolean }).ok) {
    throw new Error(JSON.stringify(data));
  }
  return data;
}
