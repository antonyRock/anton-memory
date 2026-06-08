"use client";

import {
  FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode
} from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  GripVertical,
  Image as ImageIcon,
  Loader2,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  Square,
  X
} from "lucide-react";

type FileAttachment = {
  id?: string | number;
  fileName: string;
  fileType: string;
  fileSize: number;
  status?: "uploading" | "ready" | "error";
  error?: string;
  summary?: string | null;
  metadata?: Record<string, unknown>;
  previewUrl?: string | null;
  fullUrl?: string | null;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  imageUrl?: string;
  attachments?: FileAttachment[];
};

type Conversation = {
  id: string | number;
  title: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
};

type SearchResult = {
  type: string;
  id: string | number;
  conversationId?: string | number | null;
  title: string;
  snippet: string;
};

const DEFAULT_CHAT_TITLE = "Новый чат";
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 420;
const DEFAULT_SIDEBAR_WIDTH = 280;

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | number | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [recentCollapsed, setRecentCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [highlightTerm, setHighlightTerm] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [previewImage, setPreviewImage] = useState<FileAttachment | null>(null);
  const [note, setNote] = useState("Готово");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordingActionRef = useRef<"send" | "cancel">("send");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<HTMLElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(false);
  const pendingResetScrollRef = useRef(false);
  const resizingSidebarRef = useRef(false);
  const hasMessages = messages.length > 0;
  const showThinking = isLoading && messages[messages.length - 1]?.role !== "assistant";
  const matchCount = countMatchesInMessages(messages, highlightTerm);

  useEffect(() => {
    navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
    setSidebarCollapsed(window.localStorage.getItem("sidebarCollapsed") === "true");
    setRecentCollapsed(window.localStorage.getItem("recentCollapsed") === "true");
    const savedWidth = Number(window.localStorage.getItem("sidebarWidth"));
    if (Number.isFinite(savedWidth)) setSidebarWidth(clampSidebarWidth(savedWidth));
    void bootstrap();
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void loadConversations(search);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    const term = search.trim();
    setHighlightTerm(term);
    setActiveMatchIndex(0);
  }, [search, activeConversationId]);

  useEffect(() => {
    if (!shouldAutoScrollRef.current) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useLayoutEffect(() => {
    if (!pendingResetScrollRef.current) return;
    resetMessagesScroll();
    pendingResetScrollRef.current = false;
  }, [messages, activeConversationId]);

  useLayoutEffect(() => {
    resizeComposerTextarea();
  }, [input]);

  useLayoutEffect(() => {
    if (!highlightTerm || matchCount === 0) return;
    const active = messagesRef.current?.querySelector(".search-highlight.active");
    active?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatchIndex, highlightTerm, matchCount, messages]);

  useEffect(() => {
    window.localStorage.setItem("sidebarCollapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    window.localStorage.setItem("recentCollapsed", String(recentCollapsed));
  }, [recentCollapsed]);

  useEffect(() => {
    window.localStorage.setItem("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (activeMatchIndex >= matchCount) {
      setActiveMatchIndex(Math.max(0, matchCount - 1));
    }
  }, [activeMatchIndex, matchCount]);

  async function bootstrap() {
    await loadConversations("");
    resetToNewChat();
  }

  async function loadConversations(query = search) {
    try {
      const response = await fetch(`/api/conversations?search=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить историю");
      setConversations(data.conversations ?? []);
      setSearchResults(data.results ?? []);
      return (data.conversations ?? []) as Conversation[];
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось загрузить историю");
      return [];
    }
  }

  async function loadMessages(conversationId: string | number) {
    try {
      shouldAutoScrollRef.current = false;
      pendingResetScrollRef.current = true;
      resetMessagesScroll();
      const response = await fetch(`/api/conversations/${conversationId}/messages`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить сообщения");
      setMessages(
        (data.messages ?? []).map(
          (message: {
            role: "user" | "assistant";
            content: string;
            attachments?: FileAttachment[];
          }) => ({
            role: message.role,
            content: message.content,
            attachments: message.attachments ?? []
          })
        )
      );
      window.localStorage.setItem("activeConversationId", String(conversationId));
      setSidebarOpen(false);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось загрузить сообщения");
    }
  }

  function resetToNewChat() {
    shouldAutoScrollRef.current = false;
    pendingResetScrollRef.current = true;
    resetMessagesScroll();
    setActiveConversationId(null);
    setMessages([]);
    setInput("");
    setAttachments([]);
    setSearch("");
    setSidebarOpen(false);
    setNote(DEFAULT_CHAT_TITLE);
    window.localStorage.removeItem("activeConversationId");
  }

  async function createConversation() {
    try {
      const response = await fetch("/api/conversations", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось создать чат");
      const conversation = data.conversation as Conversation;
      setConversations((current) => [
        conversation,
        ...current.filter((item) => String(item.id) !== String(conversation.id))
      ]);
      setActiveConversationId(conversation.id);
      window.localStorage.setItem("activeConversationId", String(conversation.id));
      return conversation.id;
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось создать чат");
      return null;
    }
  }

  function openConversation(conversationId: string | number | null | undefined) {
    if (!conversationId) return;
    shouldAutoScrollRef.current = false;
    pendingResetScrollRef.current = true;
    resetMessagesScroll();
    setActiveConversationId(conversationId);
    window.localStorage.setItem("activeConversationId", String(conversationId));
    void loadMessages(conversationId);
  }

  function resetMessagesScroll() {
    if (messagesRef.current) messagesRef.current.scrollTop = 0;
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  function resizeComposerTextarea() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
    textarea.style.overflowY = textarea.scrollHeight > 160 ? "auto" : "hidden";
  }

  function openSearchResult(result: SearchResult) {
    const term = search.trim();
    if (term) {
      setHighlightTerm(term);
      setActiveMatchIndex(0);
    }
    openConversation(result.conversationId);
  }

  function clearSearchHighlight() {
    setHighlightTerm("");
    setActiveMatchIndex(0);
  }

  function showNextMatch() {
    if (matchCount === 0) return;
    setActiveMatchIndex((current) => (current + 1) % matchCount);
  }

  function showPreviousMatch() {
    if (matchCount === 0) return;
    setActiveMatchIndex((current) => (current - 1 + matchCount) % matchCount);
  }

  function startSidebarResize(event: PointerEvent<HTMLDivElement>) {
    if (window.matchMedia("(max-width: 800px)").matches) return;
    event.preventDefault();
    resizingSidebarRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: globalThis.PointerEvent) => {
      if (!resizingSidebarRef.current) return;
      setSidebarWidth(clampSidebarWidth(moveEvent.clientX));
    };

    const onUp = () => {
      resizingSidebarRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  async function sendMessage(text: string, files = attachments) {
    const trimmed = text.trim();
    if ((!trimmed && files.length === 0) || isLoading) return;
    if (files.some((file) => file.status === "uploading")) {
      setNote("Дождитесь загрузки файла");
      return;
    }

    let conversationId = activeConversationId;
    if (!conversationId) conversationId = await createConversation();
    if (!conversationId) return;

    const readyFiles = files.filter((file) => file.status === "ready" && file.id);
    const readyDocumentIds = readyFiles.map((file) => file.id);
    const displayText = trimmed || files.map((file) => file.fileName).join(", ");
    const hasImageAttachment = readyFiles.some((file) => file.fileType.startsWith("image/"));
    const imageIntent =
      shouldGenerateImage(trimmed) || (hasImageAttachment && shouldEditImage(trimmed));

    shouldAutoScrollRef.current = true;
    setMessages((current) => [
      ...current,
      { role: "user", content: displayText, attachments: readyFiles }
    ]);
    setInput("");
    setAttachments([]);
    setIsLoading(true);
    setNote(imageIntent ? "Работаю с изображением" : "Формулирую ответ");

    try {
      const response = await fetch(imageIntent ? "/api/images" : "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          imageIntent
            ? { prompt: trimmed, documentIds: readyDocumentIds, conversationId }
            : {
                message: trimmed || "Посмотри прикреплённые файлы.",
                documentIds: readyDocumentIds,
                conversationId
              }
        )
      });

      if (!response.ok) throw new Error(await readError(response));

      if (imageIntent) {
        const data = await response.json();
        setMessages((current) => [
          ...current,
          { role: "assistant", content: data.answer, imageUrl: data.imageUrl }
        ]);
      } else {
        await streamAssistantMessage(response);
      }

      setNote("Готово");
      void loadConversations(search);
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

  async function streamAssistantMessage(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Ответ пришёл без stream body.");

    const decoder = new TextDecoder();
    let fullText = "";

    setMessages((current) => [...current, { role: "assistant", content: "" }]);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      fullText += decoder.decode(value, { stream: true });
      setMessages((current) => replaceLastAssistantMessage(current, fullText));
    }

    const trailing = decoder.decode();
    if (trailing) {
      fullText += trailing;
      setMessages((current) => replaceLastAssistantMessage(current, fullText));
    }
  }

  async function readError(response: Response) {
    try {
      const data = await response.json();
      return data.error ?? "Не удалось получить ответ";
    } catch {
      return "Не удалось получить ответ";
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
          if (!response.ok) throw new Error(data.error ?? "Не удалось распознать аудио");
          await sendMessage(data.text, [
            {
              id: data.documentId,
              fileName: "voice.webm",
              fileType: "audio/webm",
              fileSize: blob.size,
              status: "ready"
            }
          ]);
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
      setNote("Идёт запись");
    } catch {
      setNote("Браузер не дал доступ к микрофону");
    }
  }

  async function onFilesSelected(fileList: FileList | null) {
    if (!fileList?.length) return;
    const selectedFiles = Array.from(fileList);
    const pendingAttachments: FileAttachment[] = selectedFiles.map((file) => ({
      fileName: file.name,
      fileType: file.type || inferClientFileType(file.name),
      fileSize: file.size,
      status: "uploading"
    }));

    setAttachments((current) => [...current, ...pendingAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setNote(selectedFiles.length > 1 ? "Загружаю файлы" : "Загружаю файл");

    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append("files", file));

    try {
      const response = await fetch("/api/files", {
        method: "POST",
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить файл");

      setAttachments((current) => {
        const next = [...current];
        const start = next.length - pendingAttachments.length;
        data.documents.forEach((document: FileAttachment, index: number) => {
          next[start + index] = { ...document, status: "ready" };
        });
        return next;
      });
      setNote(selectedFiles.length > 1 ? "Файлы готовы" : "Файл готов");
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
    <main
      className={`app-shell ${sidebarOpen ? "sidebar-open" : ""} ${
        sidebarCollapsed ? "sidebar-collapsed" : ""
      }`}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      {sidebarCollapsed ? (
        <button
          aria-label="Показать sidebar"
          className="sidebar-reopen"
          onClick={() => setSidebarCollapsed(false)}
          type="button"
        >
          <PanelLeftOpen size={20} />
        </button>
      ) : null}

      <aside className="sidebar">
        <div className="sidebar-fixed">
          <div className="sidebar-header">
            <div className="sidebar-brand">Второй мозг</div>
            <button
              aria-label="Скрыть sidebar"
              className="sidebar-close"
              onClick={() => {
                if (window.matchMedia("(max-width: 800px)").matches) {
                  setSidebarOpen(false);
                } else {
                  setSidebarCollapsed(true);
                }
              }}
              type="button"
            >
              <PanelLeftClose size={18} />
            </button>
          </div>

          <div className="sidebar-actions">
            <button className="sidebar-action" onClick={resetToNewChat} type="button">
              <Plus size={18} />
              Новый чат
            </button>
            <button
              className="sidebar-action"
              onClick={() => setSearchOpen(true)}
              type="button"
            >
              <Search size={18} />
              Искать чаты
            </button>
            <button className="sidebar-action" type="button">
              <Paperclip size={18} />
              Библиотека / Файлы
            </button>
            <button className="sidebar-action" type="button">
              <Settings size={18} />
              Настройки
            </button>
          </div>

          {searchOpen ? (
            <label className="search-box">
              <Search size={17} />
              <input
                aria-label="Поиск"
                autoFocus
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск по чатам и памяти"
                value={search}
              />
            </label>
          ) : null}
        </div>

        <div className="sidebar-scroll">
          <button
            className="sidebar-section-toggle"
            onClick={() => setRecentCollapsed((current) => !current)}
            type="button"
          >
            {recentCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
            Недавние
          </button>

          {!recentCollapsed ? (
            <nav className="conversation-list">
              {conversations.map((conversation, index) => (
                <button
                  className={`conversation-item ${
                    String(conversation.id) === String(activeConversationId) ? "active" : ""
                  }`}
                  key={conversation.id}
                  onClick={() => openConversation(conversation.id)}
                  type="button"
                >
                  <span>{conversationTitle(conversation, conversations, index)}</span>
                </button>
              ))}
            </nav>
          ) : null}

          {search.trim() && searchResults.length > 0 ? (
            <div className="search-results">
              <div className="sidebar-section-title">Найдено</div>
              {searchResults.slice(0, 12).map((result) => (
                <button
                  className="search-result"
                  key={`${result.type}-${result.id}`}
                  onClick={() => openSearchResult(result)}
                  type="button"
                >
                  <strong>{result.title}</strong>
                  <span>{result.snippet}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div
          aria-hidden="true"
          className="sidebar-resize-handle"
          onPointerDown={startSidebarResize}
        >
          <GripVertical size={14} />
        </div>
      </aside>

      {sidebarOpen ? (
        <button
          aria-label="Закрыть историю"
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          type="button"
        />
      ) : null}

      <section className={`chat-shell ${hasMessages ? "with-messages" : "empty"}`}>
        <header className="top-bar">
          {/*
          <button
            aria-label="История"
          */}
          <div className="brand">
            <div className="brand-mark">B</div>
            <div className="brand-title">
              <strong>Второй мозг</strong>
              <span>ChatGPT-like с личной памятью</span>
            </div>
          </div>
        </header>

        <section
          className={`messages ${hasMessages ? "" : "empty"}`}
          key={String(activeConversationId ?? "no-conversation")}
          ref={messagesRef}
          aria-live="polite"
        >
          {!hasMessages ? (
            <div className="empty-state">
              <div>
                <h1>Рад тебя видеть, Антон.</h1>
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <article
                className={`message-row ${message.role} ${
                  message.attachments?.length ? "has-attachments" : ""
                }`}
                key={`${message.role}-${index}`}
              >
                {message.role === "assistant" ? <div className="avatar">B</div> : null}
                <div className="bubble">
                  {message.content ? (
                    <div>
                      {renderHighlightedText(
                        message.content,
                        highlightTerm,
                        activeMatchIndex,
                        countMatchesInMessages(messages.slice(0, index), highlightTerm)
                      )}
                    </div>
                  ) : null}
                  {message.attachments?.length ? (
                    <MessageAttachments
                      attachments={message.attachments}
                      onPreview={setPreviewImage}
                    />
                  ) : null}
                  {message.imageUrl ? (
                    <img className="generated-image" src={message.imageUrl} alt="Generated result" />
                  ) : null}
                </div>
              </article>
            ))
          )}
          {showThinking ? (
            <article className="message-row assistant">
              <div className="avatar">B</div>
              <div className="bubble">Думаю...</div>
            </article>
          ) : null}
          <div ref={endRef} />
        </section>

        <div className={`composer-wrap ${hasMessages ? "" : "empty"}`}>
          {highlightTerm && matchCount > 0 ? (
            <div className="search-navigation">
              <span>
                {activeMatchIndex + 1}/{matchCount}
              </span>
              <button onClick={showPreviousMatch} type="button">
                Предыдущее
              </button>
              <button onClick={showNextMatch} type="button">
                Следующее
              </button>
              <button aria-label="Убрать подсветку" onClick={clearSearchHighlight} type="button">
                <X size={14} />
              </button>
            </div>
          ) : null}
          {isRecording ? (
            <div className="recording-pill">
              <span className="recording-dot" />
              <span>Идёт запись</span>
              <div className="recording-bars" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : null}
          {attachments.length > 0 ? (
            <div className="attachments" aria-live="polite">
              {attachments.map((attachment, index) => (
                <UploadAttachmentCard
                  attachment={attachment}
                  key={`${attachment.fileName}-${index}`}
                  onRemove={() =>
                    setAttachments((current) =>
                      current.filter((_, currentIndex) => currentIndex !== index)
                    )
                  }
                />
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
              aria-label={isRecording ? "Запись идёт" : "Начать запись"}
              className={`icon-button ${isRecording ? "recording" : ""}`}
              disabled={isLoading || isRecording}
              onClick={startRecording}
              title={isRecording ? "Запись идёт" : "Микрофон"}
              type="button"
            >
              <Mic size={20} />
            </button>
            <textarea
              ref={textareaRef}
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
              {isLoading ? <Loader2 className="spin" size={20} /> : <Send size={20} />}
            </button>
          </form>
          {hasMessages ? <div className="composer-note">{note}</div> : null}
        </div>
      </section>

      {previewImage?.fullUrl ? (
        <div className="image-modal" role="dialog" aria-modal="true">
          <button
            aria-label="Закрыть изображение"
            className="image-modal-backdrop"
            onClick={() => setPreviewImage(null)}
            type="button"
          />
          <div className="image-modal-content">
            <button
              aria-label="Закрыть изображение"
              className="image-modal-close"
              onClick={() => setPreviewImage(null)}
              type="button"
            >
              <X size={20} />
            </button>
            <img src={previewImage.fullUrl} alt={previewImage.fileName} />
            <div>{previewImage.fileName}</div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function replaceLastAssistantMessage(messages: ChatMessage[], content: string) {
  const next = [...messages];
  const last = next[next.length - 1];
  if (last?.role === "assistant") {
    next[next.length - 1] = { ...last, content };
  }
  return next;
}

function renderHighlightedText(
  text: string,
  term: string,
  activeMatchIndex: number,
  startIndex: number
) {
  const query = term.trim();
  if (!query) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = startIndex;

  while (true) {
    const found = lowerText.indexOf(lowerQuery, cursor);
    if (found === -1) break;

    if (found > cursor) parts.push(text.slice(cursor, found));

    const value = text.slice(found, found + query.length);
    const isActive = matchIndex === activeMatchIndex;
    parts.push(
      <mark
        className={`search-highlight ${isActive ? "active" : ""}`}
        key={`${found}-${matchIndex}`}
      >
        {value}
      </mark>
    );
    cursor = found + query.length;
    matchIndex += 1;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.length > 0 ? parts : text;
}

function countMatchesInMessages(messages: ChatMessage[], term: string) {
  const query = term.trim();
  if (!query) return 0;
  return messages.reduce((sum, message) => sum + countMatchesInText(message.content, query), 0);
}

function countMatchesInText(text: string, term: string) {
  const query = term.trim().toLowerCase();
  if (!query) return 0;
  const source = text.toLowerCase();
  let count = 0;
  let cursor = 0;

  while (true) {
    const found = source.indexOf(query, cursor);
    if (found === -1) return count;
    count += 1;
    cursor = found + query.length;
  }
}

function clampSidebarWidth(width: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

function conversationTitle(
  conversation: Conversation,
  conversations: Conversation[],
  index: number
) {
  const base = normalizeConversationTitle(conversation.title);
  const sameTitle = conversations.filter(
    (item) => normalizeConversationTitle(item.title) === base
  );
  if (sameTitle.length <= 1) return base;

  const occurrence =
    conversations
      .slice(0, index + 1)
      .filter((item) => normalizeConversationTitle(item.title) === base).length || 1;
  return `${base} ${occurrence}`;
}

function normalizeConversationTitle(title: string | null) {
  const trimmed = title?.trim();
  if (!trimmed) return DEFAULT_CHAT_TITLE;
  if (trimmed === "История") return "Старые сообщения";
  return trimmed;
}

function MessageAttachments({
  attachments,
  onPreview
}: {
  attachments: FileAttachment[];
  onPreview: (attachment: FileAttachment) => void;
}) {
  return (
    <div className="message-attachments">
      {attachments.map((attachment) =>
        isImage(attachment) && attachment.previewUrl ? (
          <button
            className="message-image-attachment"
            key={attachment.id ?? attachment.fileName}
            onClick={() => onPreview(attachment)}
            type="button"
          >
            <img src={attachment.previewUrl} alt={attachment.fileName} />
            <span>{attachment.fileName}</span>
          </button>
        ) : (
          <div className="message-file-attachment" key={attachment.id ?? attachment.fileName}>
            <div className="message-file-icon">{iconForAttachment(attachment)}</div>
            <div className="message-file-meta">
              <strong>{attachment.fileName}</strong>
              <span>{attachmentDetails(attachment)}</span>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function UploadAttachmentCard({
  attachment,
  onRemove
}: {
  attachment: FileAttachment;
  onRemove: () => void;
}) {
  return (
    <div className={`attachment-card ${attachment.status ?? "ready"}`}>
      <div className="attachment-file-icon">{iconForAttachment(attachment)}</div>
      <div className="attachment-meta">
        <div className="attachment-name">{attachment.fileName}</div>
        <div className="attachment-status">
          {statusText(attachment)}
          {attachment.status !== "uploading" ? ` · ${formatFileSize(attachment.fileSize)}` : ""}
        </div>
      </div>
      <div className="attachment-indicator" aria-hidden="true">
        {attachment.status === "uploading" ? <Loader2 className="spin" size={18} /> : null}
        {attachment.status === "ready" ? <Check size={18} /> : null}
        {attachment.status === "error" ? <X size={18} /> : null}
      </div>
      <button
        aria-label="Убрать файл"
        className="attachment-remove"
        onClick={onRemove}
        title="Убрать файл"
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function iconForAttachment(attachment: FileAttachment) {
  if (isImage(attachment)) return <ImageIcon size={18} />;
  if (isSpreadsheet(attachment)) return <FileSpreadsheet size={18} />;
  return <FileText size={18} />;
}

function statusText(attachment: FileAttachment) {
  if (attachment.status === "uploading") return "Загрузка...";
  if (attachment.status === "ready") return "Файл загружен";
  return attachment.error ?? "Ошибка загрузки";
}

function attachmentDetails(attachment: FileAttachment) {
  const metadata = attachment.metadata ?? {};
  const parts = [formatFileSize(attachment.fileSize)];

  if (attachment.fileType === "application/pdf" && typeof metadata.page_count === "number") {
    parts.push(`${metadata.page_count} стр.`);
  }

  if (isSpreadsheet(attachment)) {
    if (typeof metadata.sheet_count === "number") parts.push(`${metadata.sheet_count} лист.`);
    if (typeof metadata.row_count === "number") parts.push(`${metadata.row_count} строк`);
  }

  return parts.join(" · ");
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

function isImage(attachment: FileAttachment) {
  return (
    attachment.fileType.startsWith("image/") ||
    attachment.metadata?.kind === "image" ||
    attachment.metadata?.kind === "generated_image"
  );
}

function isSpreadsheet(attachment: FileAttachment) {
  return (
    attachment.fileType.includes("spreadsheet") ||
    attachment.fileType.includes("excel") ||
    attachment.fileName.toLowerCase().endsWith(".xlsx") ||
    attachment.fileName.toLowerCase().endsWith(".xls")
  );
}

function shouldGenerateImage(message: string) {
  return /(?:создай|сгенерируй|нарисуй|generate|create|make).{0,60}(?:изображ|картин|image|picture|photo|фото)/i.test(
    message
  );
}

function shouldEditImage(message: string) {
  return /(?:улучши|измени|перегенерируй|переделай|отредактируй|сделай|добавь|убери|замени|вариант|edit|improve|change|modify|variation)/i.test(
    message
  );
}

function inferClientFileType(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
  return "application/octet-stream";
}
