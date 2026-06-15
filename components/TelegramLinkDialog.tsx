"use client";

import { Copy, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuthFetch } from "@/hooks/useAuthFetch";

type TelegramLinkDialogProps = {
  open: boolean;
  onClose: () => void;
  onNotify?: (message: string) => void;
};

type LinkStatus = {
  linked: boolean;
  botUsername?: string;
  code?: string;
  expiresAt?: string;
  command?: string;
};

function formatExpiry(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function TelegramLinkDialog({ open, onClose, onNotify }: TelegramLinkDialogProps) {
  const { authFetch } = useAuthFetch();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<LinkStatus | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/telegram/link");
      const data = (await response.json()) as LinkStatus & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Не удалось загрузить статус Telegram");
      }
      setStatus(data);
      if (!data.linked && !data.code) {
        const postResponse = await authFetch("/api/telegram/link", { method: "POST" });
        const postData = (await postResponse.json()) as LinkStatus & { error?: string };
        if (postResponse.ok) {
          setStatus(postData);
        }
      }
    } catch (error) {
      setStatus(null);
      onNotify?.(
        error instanceof Error ? error.message : "Не удалось загрузить статус Telegram"
      );
    } finally {
      setLoading(false);
    }
  }, [authFetch, onNotify]);

  const createCode = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/telegram/link", { method: "POST" });
      const data = (await response.json()) as LinkStatus & { error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "Не удалось получить код");
      }
      setStatus(data);
    } catch (error) {
      onNotify?.(
        error instanceof Error ? error.message : "Не удалось получить код"
      );
    } finally {
      setLoading(false);
    }
  }, [authFetch, onNotify]);

  useEffect(() => {
    if (!open) return;
    void loadStatus();
  }, [open, loadStatus]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  async function copyCommand() {
    const command = status?.command ?? (status?.code ? `/link ${status.code}` : "");
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      onNotify?.("Команда скопирована");
    } catch {
      onNotify?.("Не удалось скопировать");
    }
  }

  if (!open) return null;

  const botLabel = status?.botUsername ? `@${status.botUsername}` : "вашего бота TBrain";

  return (
    <div className="telegram-link-overlay" role="presentation">
      <button aria-label="Закрыть" className="telegram-link-backdrop" onClick={onClose} type="button" />
      <div aria-labelledby="telegram-link-title" aria-modal="true" className="telegram-link-dialog" role="dialog">
        <div className="telegram-link-header">
          <h2 id="telegram-link-title">Подключить Telegram</h2>
          <button aria-label="Закрыть" className="telegram-link-close" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        {loading && !status ? (
          <div className="telegram-link-empty">
            <Loader2 className="spin" size={22} />
            <span>Загрузка...</span>
          </div>
        ) : status?.linked ? (
          <div className="telegram-link-body">
            <p className="telegram-link-success">Telegram уже привязан к вашему аккаунту TBrain.</p>
            <p className="telegram-link-hint">
              Отправляйте текст и файлы боту {botLabel} — они попадут только в ваш TBrain.
            </p>
            <button className="telegram-link-primary" onClick={() => void loadStatus()} type="button">
              Обновить статус
            </button>
          </div>
        ) : (
          <div className="telegram-link-body">
            <p className="telegram-link-lead">
              Личный код привязки — только для вашего аккаунта. Действует 15 минут.
            </p>

            {status?.code ? (
              <>
                <div className="telegram-link-code-box">
                  <strong>{status.code}</strong>
                  <button
                    aria-label="Скопировать команду"
                    className="telegram-link-copy"
                    onClick={() => void copyCommand()}
                    type="button"
                  >
                    <Copy size={16} />
                  </button>
                </div>
                <p className="telegram-link-command">
                  В Telegram отправьте боту {botLabel}:
                  <code>{status.command ?? `/link ${status.code}`}</code>
                </p>
                {status.expiresAt ? (
                  <p className="telegram-link-hint">Код действует до {formatExpiry(status.expiresAt)}</p>
                ) : null}
              </>
            ) : (
              <p className="telegram-link-hint">Нажмите кнопку ниже, чтобы получить ваш код.</p>
            )}

            <button
              className="telegram-link-primary"
              disabled={loading}
              onClick={() => void createCode()}
              type="button"
            >
              {loading ? "Готовлю код..." : status?.code ? "Новый код" : "Получить мой код"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
