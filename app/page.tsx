"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Paperclip, Send, Square } from "lucide-react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
};

type Attachment = {
  id?: string | number;
  name: string;
  type: string;
  size: number;
  status: "uploading" | "ready" | "error";
  error?: string;
  summary?: string | null;
};

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [note, setNote] = useState("Готово к вводу");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordingActionRef = useRef<"send" | "cancel">("send");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const hasMessages = messages.length > 0;

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function sendMessage(text: string, files = attachments) {
    const trimmed = text.trim();
    if ((!trimmed && files.length === 0) || isLoading) return;
    if (files.some((file) => file.status === "uploading")) {
      setNote("Дождитесь загрузки файла");
      return;
    }

    const readyFiles = files.filter((file) => file.status === "ready" && file.id);
    const displayText = trimmed || files.map((file) => file.name).join(", ");

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: displayText }
    ];
    setMessages(nextMessages);
    setInput("");
    setAttachments([]);
    setIsLoading(true);
    setNote("Ищу память и формулирую ответ");

    try {
      const isImageRequest = shouldGenerateImage(trimmed);
      const response = await fetch(isImageRequest ? "/api/images" : "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isImageRequest
            ? { prompt: trimmed }
            : { message: trimmed || "Посмотри прикрепленные файлы.", documentIds: readyFiles.map((file) => file.id) }
        )
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Не удалось получить ответ");
      }

      setMessages((current) => [
        ...current,
        { role: "assistant", content: data.answer, imageUrl: data.imageUrl }
      ]);
      setNote("Память обновлена");
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error instanceof Error
              ? `Ошибка: ${error.message}`
              : "Ошибка: не удалось обработать сообщение."
        }
      ]);
      setNote("Нужна проверка настроек");
    } finally {
      setIsLoading(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRecording) {
      stopRecording("send");
      return;
    }
    await sendMessage(input);
  }

  function stopRecording(action: "send" | "cancel") {
    recordingActionRef.current = action;
    recorderRef.current?.stop();
  }

  async function startRecording() {
    if (isRecording) {
      stopRecording("cancel");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        setIsRecording(false);

        if (recordingActionRef.current === "cancel") {
          chunksRef.current = [];
          setNote("Запись отменена");
          return;
        }

        setNote("Расшифровываю голос");

        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm"
        });
        const formData = new FormData();
        formData.append("audio", blob, "voice.webm");

        try {
          const response = await fetch("/api/transcribe", {
            method: "POST",
            body: formData
          });
          const data = await response.json();
          if (!response.ok) {
            throw new Error(data.error ?? "Не удалось распознать аудио");
          }
          await sendMessage(data.text);
        } catch (error) {
          setNote(
            error instanceof Error
              ? `Ошибка распознавания: ${error.message}`
              : "Ошибка распознавания"
          );
        }
      };

      recorderRef.current = recorder;
      recordingActionRef.current = "send";
      recorder.start();
      setIsRecording(true);
      setNote("Идет запись");
    } catch {
      setNote("Браузер не дал доступ к микрофону");
    }
  }

  async function onFilesSelected(fileList: FileList | null) {
    if (!fileList?.length) return;
    const selectedFiles = Array.from(fileList);
    const pendingAttachments: Attachment[] = selectedFiles.map((file) => ({
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      status: "uploading"
    }));

    setAttachments((current) => [...current, ...pendingAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setNote("Загружаю файл");

    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append("files", file));

    try {
      const response = await fetch("/api/files", {
        method: "POST",
        body: formData
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Не удалось загрузить файл");
      }

      setAttachments((current) => {
        const next = [...current];
        const start = next.length - pendingAttachments.length;
        data.documents.forEach(
          (
            document: {
              id: string | number;
              fileName: string;
              fileType: string;
              fileSize: number;
              summary?: string | null;
            },
            index: number
          ) => {
            next[start + index] = {
              id: document.id,
              name: document.fileName,
              type: document.fileType,
              size: document.fileSize,
              status: "ready",
              summary: document.summary
            };
          }
        );
        return next;
      });
      setNote("Файл готов");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ошибка загрузки файла";
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.status === "uploading"
            ? { ...attachment, status: "error", error: message }
            : attachment
        )
      );
      setNote(message);
    }
  }

  return (
    <main className={`app-shell ${hasMessages ? "with-messages" : "empty"}`}>
      <header className="top-bar">
        <div className="brand">
          <div className="brand-mark">B</div>
          <div className="brand-title">
            <strong>Второй мозг</strong>
            <span>личная долговременная память</span>
          </div>
        </div>
        <div className="status">{note}</div>
      </header>

      <section className={`messages ${hasMessages ? "" : "empty"}`} aria-live="polite">
        {!hasMessages ? (
          <div className="empty-state">
            <div>
              <h1>Рад тебя видеть, Антон.</h1>
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <article
              className={`message-row ${message.role}`}
              key={`${message.role}-${index}`}
            >
              {message.role === "assistant" ? (
                <div className="avatar">B</div>
              ) : null}
              <div className="bubble">
                {message.content}
                {message.imageUrl ? (
                  <img className="generated-image" src={message.imageUrl} alt="Generated result" />
                ) : null}
              </div>
            </article>
          ))
        )}
        {isLoading ? (
          <article className="message-row assistant">
            <div className="avatar">B</div>
            <div className="bubble">Думаю...</div>
          </article>
        ) : null}
        <div ref={endRef} />
      </section>

      <div className={`composer-wrap ${hasMessages ? "" : "empty"}`}>
        {isRecording ? (
          <div className="recording-pill">
            <span className="recording-dot" />
            <span>Идет запись</span>
            <div className="recording-bars" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="attachments">
            {attachments.map((attachment, index) => (
              <button
                className="attachment-chip"
                key={`${attachment.name}-${index}`}
                onClick={() =>
                  setAttachments((current) =>
                    current.filter((_, currentIndex) => currentIndex !== index)
                  )
                }
                title="Убрать файл"
                type="button"
              >
                {attachment.name}
                {attachment.status === "uploading" ? "..." : ""}
                {attachment.status === "error" ? " !" : ""}
              </button>
            ))}
          </div>
        ) : null}
        <form className="composer" onSubmit={onSubmit}>
          <input
            ref={fileInputRef}
            className="file-input"
            multiple
            onChange={(event) => void onFilesSelected(event.target.files)}
            type="file"
          />
          <button
            aria-label={isRecording ? "Отменить запись" : "Добавить файл"}
            className="icon-button"
            disabled={isLoading}
            onClick={() =>
              isRecording ? stopRecording("cancel") : fileInputRef.current?.click()
            }
            title={isRecording ? "Отменить запись" : "Добавить файл"}
            type="button"
          >
            {isRecording ? <Square size={20} /> : <Paperclip size={20} />}
          </button>
          <button
            aria-label={isRecording ? "Запись идет" : "Начать запись"}
            className={`icon-button ${isRecording ? "recording" : ""}`}
            disabled={isLoading || isRecording}
            onClick={startRecording}
            title={isRecording ? "Запись идет" : "Микрофон"}
            type="button"
          >
            <Mic size={20} />
          </button>
          <textarea
            aria-label="Сообщение"
            disabled={isLoading || isRecording}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage(input);
              }
            }}
            placeholder="Спросите что-нибудь..."
            rows={1}
            value={input}
          />
          <button
            aria-label={isRecording ? "Отправить запись" : "Отправить"}
            className="icon-button primary"
            disabled={isLoading || (!isRecording && !input.trim() && attachments.length === 0)}
            title={isRecording ? "Отправить запись" : "Отправить"}
            type="submit"
          >
            {isLoading ? (
              <Loader2 className="spin" size={20} />
            ) : (
              <Send size={20} />
            )}
          </button>
        </form>
        {hasMessages ? <div className="composer-note">{note}</div> : null}
      </div>
    </main>
  );
}

function shouldGenerateImage(message: string) {
  return /(?:создай|сгенерируй|нарисуй|generate|create).{0,40}(?:изображ|картин|image|picture)/i.test(
    message
  );
}
