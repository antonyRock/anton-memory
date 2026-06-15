import "server-only";

import { runWithRequestUser } from "@/lib/request-context";
import { touchConversation } from "@/lib/conversations";
import { saveMessage } from "@/lib/memory";
import {
  linkDocumentsToMessage,
  processAndStoreFile,
  storedDocumentToAttachment
} from "@/lib/documents";
import { downloadTelegramFile, sendTelegramMessage } from "@/lib/telegram-api";
import { generateTelegramChatReply } from "@/lib/telegram-chat-reply";
import { getOrCreateTelegramConversation } from "@/lib/telegram-inbox";
import {
  linkTelegramByCode,
  resolveTbrainUserIdForTelegram
} from "@/lib/telegram-users";
import { isTelegramConfigured } from "@/lib/telegram-config";
import { storeAudioFile } from "@/lib/documents";
import { transcribeAudioWithCleanup } from "@/lib/transcription";
import { MAX_AUDIO_BYTES, formatAudioSize } from "@/lib/voice-recording";

type TelegramUser = {
  id: number;
  first_name?: string;
  username?: string;
};

type TelegramMessage = {
  message_id: number;
  chat: { id: number; type: string };
  from?: TelegramUser;
  text?: string;
  caption?: string;
  document?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  photo?: Array<{
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
  }>;
  voice?: {
    file_id: string;
    mime_type?: string;
    file_size?: number;
    duration?: number;
  };
  audio?: {
    file_id: string;
    mime_type?: string;
    file_name?: string;
    file_size?: number;
    duration?: number;
  };
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

const HELP_TEXT = [
  "TBrain · Telegram",
  "",
  "Отправьте текст — получите ответ и запись в чат «📱 Telegram».",
  "Голосовое сообщение — расшифровка и ответ, важное запомнится.",
  "Отправьте файл или фото — сохранится в TBrain.",
  "Подпись к файлу обрабатывается как сообщение.",
  "",
  "Команды:",
  "/new — новый чат Telegram",
  "/link КОД — привязка аккаунта (код в TBrain)",
  "/help — эта справка"
].join("\n");

function pickLargestPhoto(message: TelegramMessage) {
  const photos = message.photo ?? [];
  if (photos.length === 0) return null;
  return photos.reduce((best, photo) =>
    (photo.file_size ?? photo.width * photo.height) >
    (best.file_size ?? best.width * best.height)
      ? photo
      : best
  );
}

async function handleTelegramFile(
  chatId: number,
  message: TelegramMessage,
  caption: string
) {
  const document = message.document;
  const photo = pickLargestPhoto(message);
  const fileDescriptor = document
    ? {
        file_id: document.file_id,
        file_name: document.file_name,
        mime_type: document.mime_type,
        file_size: document.file_size
      }
    : photo
      ? {
          file_id: photo.file_id,
          file_name: `telegram-photo-${message.message_id}.jpg`,
          mime_type: "image/jpeg",
          file_size: photo.file_size
        }
      : null;

  if (!fileDescriptor) {
    await sendTelegramMessage(chatId, "Не удалось распознать файл.");
    return;
  }

  const downloaded = await downloadTelegramFile(fileDescriptor);
  const stored = await processAndStoreFile(downloaded);
  const attachment = await storedDocumentToAttachment(stored);
  const conversationId = await getOrCreateTelegramConversation();

  const messageId = await saveMessage(
    "user",
    caption || `Файл: ${attachment.fileName}`,
    {
      document_ids: [attachment.id],
      source: "telegram"
    },
    conversationId
  );

  await linkDocumentsToMessage({
    messageId,
    documentIds: [attachment.id],
    relationType: "attachment"
  });
  await touchConversation(conversationId);

  if (caption.trim()) {
    const { answer } = await generateTelegramChatReply({
      conversationId,
      userMessage: caption.trim(),
      documentIds: [attachment.id],
      skipUserMessage: true,
      existingUserMessageId: messageId
    });
    await sendTelegramMessage(
      chatId,
      `📎 ${attachment.fileName} сохранён.\n\n${answer}`
    );
    return;
  }

  await sendTelegramMessage(
    chatId,
    `📎 Сохранено в TBrain: ${attachment.fileName}\nОткройте чат «📱 Telegram» на tbrain.vercel.app`
  );
}

function buildTelegramAudioDescriptor(message: TelegramMessage) {
  const voice = message.voice;
  if (voice) {
    return {
      file_id: voice.file_id,
      file_name: `telegram-voice-${message.message_id}.ogg`,
      mime_type: voice.mime_type?.trim() || "audio/ogg",
      file_size: voice.file_size
    };
  }

  const audio = message.audio;
  if (audio) {
    const mimeType = audio.mime_type?.trim() || "audio/mpeg";
    const extension = mimeType.includes("ogg")
      ? "ogg"
      : mimeType.includes("mp4") || mimeType.includes("aac")
        ? "m4a"
        : "mp3";
    return {
      file_id: audio.file_id,
      file_name: audio.file_name?.trim() || `telegram-audio-${message.message_id}.${extension}`,
      mime_type: mimeType,
      file_size: audio.file_size
    };
  }

  return null;
}

function previewTranscript(text: string, maxLength = 700) {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}…`;
}

async function handleTelegramVoice(chatId: number, message: TelegramMessage) {
  const descriptor = buildTelegramAudioDescriptor(message);
  if (!descriptor) {
    await sendTelegramMessage(chatId, "Не удалось распознать голосовое сообщение.");
    return;
  }

  if (descriptor.file_size && descriptor.file_size > MAX_AUDIO_BYTES) {
    await sendTelegramMessage(
      chatId,
      `Голосовое слишком большое (${formatAudioSize(descriptor.file_size)}). Максимум ${formatAudioSize(MAX_AUDIO_BYTES)}.`
    );
    return;
  }

  await sendTelegramMessage(chatId, "🎙 Расшифровываю…");

  const downloaded = await downloadTelegramFile(descriptor);
  if (downloaded.size > MAX_AUDIO_BYTES) {
    await sendTelegramMessage(
      chatId,
      `Голосовое слишком большое (${formatAudioSize(downloaded.size)}). Максимум ${formatAudioSize(MAX_AUDIO_BYTES)}.`
    );
    return;
  }

  const transcript = await transcribeAudioWithCleanup(downloaded);
  const text = transcript.text.trim();
  if (!text) {
    await sendTelegramMessage(chatId, "Не удалось распознать речь. Попробуйте ещё раз.");
    return;
  }

  const stored = await storeAudioFile({
    file: downloaded,
    transcript: text
  });

  const conversationId = await getOrCreateTelegramConversation();
  const { answer } = await generateTelegramChatReply({
    conversationId,
    userMessage: text,
    documentIds: [stored.id],
    voiceTranscript: {
      rawTranscript: transcript.rawTranscript,
      cleanedTranscript: transcript.cleanedTranscript,
      transcriptStatus: transcript.transcriptStatus
    }
  });

  await sendTelegramMessage(
    chatId,
    [`📝 ${previewTranscript(text)}`, "", answer].join("\n")
  );
}

async function handleTelegramText(
  chatId: number,
  telegramUserId: number,
  text: string,
  forceNew = false
) {
  const trimmed = text.trim();
  if (!trimmed) return;

  if (trimmed.startsWith("/help") || trimmed.startsWith("/start")) {
    await sendTelegramMessage(chatId, HELP_TEXT);
    return;
  }

  if (trimmed.startsWith("/new")) {
    await getOrCreateTelegramConversation({ forceNew: true });
    await sendTelegramMessage(chatId, "Создан новый чат «📱 Telegram».");
    return;
  }

  if (trimmed.startsWith("/link")) {
    const code = trimmed.replace(/^\/link\s*/i, "").trim();
    const result = await linkTelegramByCode(telegramUserId, code);
    await sendTelegramMessage(
      chatId,
      result.ok ? "✅ Telegram привязан к TBrain." : result.error
    );
    return;
  }

  const conversationId = await getOrCreateTelegramConversation({ forceNew });
  const { answer } = await generateTelegramChatReply({
    conversationId,
    userMessage: trimmed
  });

  await sendTelegramMessage(chatId, answer);
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  if (!isTelegramConfigured()) {
    throw new Error("Telegram is not configured.");
  }

  const message = update.message;
  if (!message?.from?.id) return;

  const telegramUserId = message.from.id;
  const chatId = message.chat.id;
  const tbrainUserId = await resolveTbrainUserIdForTelegram(telegramUserId);

  if (!tbrainUserId) {
    await sendTelegramMessage(
      chatId,
      [
        "Telegram ещё не привязан к TBrain.",
        "",
        "1. Откройте tbrain.vercel.app",
        "2. Профиль внизу → «Подключить Telegram»",
        "3. Получите личный код",
        "4. Отправьте боту: /link ВАШ_КОД"
      ].join("\n")
    );
    return;
  }

  await runWithRequestUser(tbrainUserId, async () => {
    try {
      const caption = message.caption?.trim() ?? "";
      if (message.document || (message.photo?.length ?? 0) > 0) {
        await handleTelegramFile(chatId, message, caption);
        return;
      }

      if (message.voice || message.audio) {
        await handleTelegramVoice(chatId, message);
        return;
      }

      if (message.text) {
        await handleTelegramText(chatId, telegramUserId, message.text);
        return;
      }

      await sendTelegramMessage(chatId, "Поддерживаются текст, голос, файлы и фото.");
    } catch (error) {
      const text =
        error instanceof Error ? error.message : "Не удалось обработать сообщение.";
      await sendTelegramMessage(chatId, `⚠️ ${text}`);
    }
  });
}
