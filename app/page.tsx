"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Send, Square } from "lucide-react";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [note, setNote] = useState("Готово к вводу");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: trimmed }
    ];
    setMessages(nextMessages);
    setInput("");
    setIsLoading(true);
    setNote("Ищу память и формулирую ответ");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Не удалось получить ответ");
      }

      setMessages((current) => [
        ...current,
        { role: "assistant", content: data.answer }
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
    await sendMessage(input);
  }

  async function toggleRecording() {
    if (isRecording) {
      recorderRef.current?.stop();
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
      recorder.start();
      setIsRecording(true);
      setNote("Идет запись");
    } catch {
      setNote("Браузер не дал доступ к микрофону");
    }
  }

  return (
    <main className="app-shell">
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

      <section className="messages" aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div>
              <h1>Что запомнить?</h1>
              <p>
                Пишите или диктуйте как в обычном чате. Приложение сохранит
                сообщения, подтянет релевантную память и обновит факты, сущности
                и задачи после ответа.
              </p>
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
              <div className="bubble">{message.content}</div>
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

      <div className="composer-wrap">
        <form className="composer" onSubmit={onSubmit}>
          <button
            aria-label={isRecording ? "Остановить запись" : "Начать запись"}
            className={`icon-button ${isRecording ? "recording" : ""}`}
            disabled={isLoading}
            onClick={toggleRecording}
            title={isRecording ? "Остановить запись" : "Микрофон"}
            type="button"
          >
            {isRecording ? <Square size={20} /> : <Mic size={20} />}
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
            placeholder="Напишите сообщение..."
            rows={1}
            value={input}
          />
          <button
            aria-label="Отправить"
            className="icon-button primary"
            disabled={isLoading || isRecording || !input.trim()}
            title="Отправить"
            type="submit"
          >
            {isLoading ? (
              <Loader2 className="spin" size={20} />
            ) : (
              <Send size={20} />
            )}
          </button>
        </form>
        <div className="composer-note">{note}</div>
      </div>
    </main>
  );
}
