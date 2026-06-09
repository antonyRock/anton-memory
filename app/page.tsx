"use client";

import {
  FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type ReactNode
} from "react";
import { SidebarMoreMenu } from "@/components/SidebarMoreMenu";
import { ProjectFolderList } from "@/components/ProjectFolderList";
import { ChatContextMenu } from "@/components/ChatContextMenu";
import { ObsidianBackground } from "@/components/ObsidianBackground";
import {
  ThinkingIndicator,
  type ThinkingPhase
} from "@/components/ThinkingIndicator";
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
  Search,
  Send,
  Square,
  X,
  Zap
} from "lucide-react";

type FileAttachment = {
  id?: string | number;
  batchId?: string;
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
  project_id?: string | number | null;
  created_at: string;
  updated_at: string;
};

type Project = {
  id: string | number;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type SearchResult = {
  type: string;
  typeLabel: string;
  id: string | number;
  conversationId?: string | number | null;
  title: string;
  snippet: string;
};

type LibraryView = "files" | "images" | "settings" | null;

const DEFAULT_CHAT_TITLE = "Новый чат";
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 420;
const DEFAULT_SIDEBAR_WIDTH = 280;

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Record<string, boolean>>({});
  const [openMenuProjectId, setOpenMenuProjectId] = useState<string | number | null>(null);
  const [draggingConversationId, setDraggingConversationId] = useState<string | number | null>(
    null
  );
  const [dropTargetProjectId, setDropTargetProjectId] = useState<string | "general" | null>(null);
  const [chatContextMenu, setChatContextMenu] = useState<{
    conversationId: string | number;
    x: number;
    y: number;
  } | null>(null);
  const [projectsCollapsed, setProjectsCollapsed] = useState(false);
  const [libraryView, setLibraryView] = useState<LibraryView>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const [activeConversationId, setActiveConversationId] = useState<string | number | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [recentCollapsed, setRecentCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [highlightTerm, setHighlightTerm] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [activityPhase, setActivityPhase] = useState<ThinkingPhase | null>(null);
  const [streamingAssistantText, setStreamingAssistantText] = useState<string | null>(null);
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
  const isUploadingFiles = attachments.some((file) => file.status === "uploading");
  const showChatIndicator =
    isLoading &&
    (streamingAssistantText === null || streamingAssistantText.length === 0);
  const showCompactIndicator = isUploadingFiles || isTranscribing;
  const matchCount = countMatchesInMessages(messages, highlightTerm);
  const bootstrappedRef = useRef(false);
  const generalConversations = conversations.filter((conversation) => !conversation.project_id);

  useLayoutEffect(() => {
    window.localStorage.removeItem("activeConversationId");
    setActiveConversationId(null);
    setMessages([]);
    pendingResetScrollRef.current = true;
  }, []);

  useEffect(() => {
    navigator.serviceWorker?.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.update();
      });
    });
    navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
    setSidebarCollapsed(window.localStorage.getItem("sidebarCollapsed") === "true");
    setRecentCollapsed(window.localStorage.getItem("recentCollapsed") === "true");
    const savedExpanded = window.localStorage.getItem("expandedProjectIds");
    if (savedExpanded) {
      try {
        setExpandedProjectIds(JSON.parse(savedExpanded) as Record<string, boolean>);
      } catch {
        setExpandedProjectIds({});
      }
    }
    const savedWidth = Number(window.localStorage.getItem("sidebarWidth"));
    if (Number.isFinite(savedWidth)) setSidebarWidth(clampSidebarWidth(savedWidth));
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!bootstrappedRef.current) return;
    const handle = window.setTimeout(() => {
      void loadSearchResults(search);
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
  }, [messages, isLoading, streamingAssistantText]);

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
    window.localStorage.setItem("expandedProjectIds", JSON.stringify(expandedProjectIds));
  }, [expandedProjectIds]);

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
    resetToNewChat();
    bootstrappedRef.current = true;
    await Promise.all([loadRecentConversations(), loadProjects()]);
  }

  async function loadProjects() {
    try {
      const response = await fetch("/api/projects");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить проекты");
      setProjects(data.projects ?? []);
    } catch {
      setProjects([]);
    }
  }

  async function createProject(options?: {
    title?: string;
    promptDefault?: string;
    conversationId?: string | number;
  }) {
    const title =
      options?.title?.trim() ||
      window.prompt("Название проекта", options?.promptDefault ?? "Новый проект")?.trim();
    if (!title) return null;

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось создать проект");
      const project = data.project as Project;
      setProjects((current) => [project, ...current]);
      setExpandedProjectIds((current) => ({ ...current, [String(project.id)]: true }));
      setProjectsCollapsed(false);

      if (options?.conversationId != null) {
        await moveConversationToProject(options.conversationId, project.id);
      }

      setSidebarOpen(false);
      return project;
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось создать проект");
      return null;
    }
  }

  function openChatContextMenu(event: ReactMouseEvent, conversationId: string | number) {
    event.preventDefault();
    event.stopPropagation();
    setChatContextMenu({
      conversationId,
      x: event.clientX,
      y: event.clientY
    });
  }

  function createProjectFromChat(conversationId: string | number) {
    const conversation = conversations.find(
      (item) => String(item.id) === String(conversationId)
    );
    const list = conversation?.project_id
      ? conversations.filter((item) => String(item.project_id) === String(conversation.project_id))
      : generalConversations;
    const index = list.findIndex((item) => String(item.id) === String(conversationId));
    const titled = conversation
      ? conversationTitle(conversation, list, Math.max(index, 0))
      : "Новый проект";
    const promptDefault = titled === DEFAULT_CHAT_TITLE ? "Новый проект" : titled;
    void createProject({ promptDefault, conversationId });
  }

  function getUploadProjectId() {
    const activeConversation = conversations.find(
      (conversation) => String(conversation.id) === String(activeConversationId)
    );
    return activeConversation?.project_id ?? null;
  }

  function toggleProject(projectId: string | number) {
    const key = String(projectId);
    setExpandedProjectIds((current) => ({ ...current, [key]: !current[key] }));
  }

  async function renameProject(projectId: string | number, title: string) {
    const project = projects.find((item) => String(item.id) === String(projectId));
    const trimmed = title.trim();
    if (!trimmed || trimmed === project?.title) {
      setOpenMenuProjectId(null);
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось переименовать проект");
      setProjects((current) =>
        current.map((item) => (String(item.id) === String(projectId) ? (data.project as Project) : item))
      );
      setOpenMenuProjectId(null);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось переименовать проект");
    }
  }

  async function deleteProjectById(projectId: string | number) {
    const project = projects.find((item) => String(item.id) === String(projectId));
    if (
      !window.confirm(
        `Удалить проект «${project?.title ?? "Без названия"}»? Чаты останутся в общем списке.`
      )
    ) {
      setOpenMenuProjectId(null);
      return;
    }

    try {
      const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось удалить проект");
      setProjects((current) => current.filter((item) => String(item.id) !== String(projectId)));
      setConversations((current) =>
        current.map((conversation) =>
          String(conversation.project_id) === String(projectId)
            ? { ...conversation, project_id: null }
            : conversation
        )
      );
      setExpandedProjectIds((current) => {
        const next = { ...current };
        delete next[String(projectId)];
        return next;
      });
      setOpenMenuProjectId(null);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось удалить проект");
    }
  }

  async function moveConversationToProject(
    conversationId: string | number,
    projectId: string | number | null
  ) {
    try {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось переместить чат");

      const updated = data.conversation as Conversation;
      setConversations((current) =>
        current.map((conversation) =>
          String(conversation.id) === String(conversationId) ? { ...conversation, ...updated } : conversation
        )
      );

      if (projectId != null) {
        setExpandedProjectIds((current) => ({ ...current, [String(projectId)]: true }));
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось переместить чат");
    } finally {
      setDraggingConversationId(null);
      setDropTargetProjectId(null);
    }
  }

  function handleConversationDragStart(conversationId: string | number) {
    setDraggingConversationId(conversationId);
  }

  function handleConversationDragEnd() {
    setDraggingConversationId(null);
    setDropTargetProjectId(null);
  }

  function expandProjectFromSearch(projectId: string | number) {
    setExpandedProjectIds((current) => ({ ...current, [String(projectId)]: true }));
    setProjectsCollapsed(false);
    setSidebarOpen(true);
  }

  async function loadRecentConversations() {
    try {
      const response = await fetch("/api/conversations?search=");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить историю");
      setConversations(
        (data.conversations ?? []).filter(
          (conversation: Conversation) => String(conversation.id) !== "legacy"
        )
      );
      return (data.conversations ?? []) as Conversation[];
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось загрузить историю");
      return [];
    }
  }

  async function loadSearchResults(query = search) {
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchResults([]);
      return [];
    }

    try {
      const response = await fetch(`/api/conversations?search=${encodeURIComponent(trimmed)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось выполнить поиск");
      setSearchResults(data.results ?? []);
      return (data.results ?? []) as SearchResult[];
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось выполнить поиск");
      setSearchResults([]);
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
            imageUrl?: string | null;
          }) => ({
            role: message.role,
            content: message.content,
            attachments: message.attachments ?? [],
            imageUrl: message.imageUrl ?? undefined
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
    setSearchResults([]);
    setSidebarOpen(false);
    setLibraryView(null);
    setNote(DEFAULT_CHAT_TITLE);
    window.localStorage.removeItem("activeConversationId");
  }

  async function createConversation() {
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось создать чат");
      const conversation = data.conversation as Conversation;
      if (String(conversation.id) === "legacy") {
        throw new Error("Не удалось создать чат");
      }
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
    if (!conversationId || String(conversationId) === "legacy") return;
    shouldAutoScrollRef.current = false;
    pendingResetScrollRef.current = true;
    resetMessagesScroll();
    setActiveConversationId(conversationId);
    setLibraryView(null);
    window.localStorage.setItem("activeConversationId", String(conversationId));
    void loadMessages(conversationId);
  }

  function clearSearch() {
    setSearch("");
    setSearchResults([]);
    setHighlightTerm("");
    setActiveMatchIndex(0);
  }

  function handleDragEnter(event: DragEvent) {
    event.preventDefault();
    dragDepthRef.current += 1;
    if (event.dataTransfer.types.includes("Files")) setIsDragOver(true);
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDragOver(false);
    }
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    if (event.dataTransfer.files?.length) {
      void onFilesSelected(event.dataTransfer.files);
    }
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
    if (result.type === "project") {
      expandProjectFromSearch(result.id);
      return;
    }
    if (result.conversationId) {
      openConversation(result.conversationId);
      return;
    }
    if (result.type === "conversation") {
      openConversation(result.id);
    }
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

    setLibraryView(null);

    let conversationId = activeConversationId;
    if (!conversationId) conversationId = await createConversation();
    if (!conversationId) {
      setNote("Не удалось создать чат. Проверьте подключение к Supabase.");
      return;
    }

    const readyFiles = files.filter((file) => file.status === "ready" && file.id);
    const readyDocumentIds = readyFiles.map((file) => file.id);
    const displayText = trimmed || files.map((file) => file.fileName).join(", ");
    const hasImageAttachment = readyFiles.some((file) => file.fileType.startsWith("image/"));
    const imageIntent =
      shouldGenerateImage(trimmed) || (hasImageAttachment && shouldEditImage(trimmed));

    shouldAutoScrollRef.current = true;
    setMessages((current) => [
      ...current,
      { role: "user", content: displayText, attachments: readyFiles },
      ...(imageIntent ? [] : [{ role: "assistant" as const, content: "" }])
    ]);
    if (!imageIntent) {
      setStreamingAssistantText("");
    }
    setInput("");
    setAttachments([]);
    setIsLoading(true);
    setActivityPhase(imageIntent ? "image" : "thinking");
    setNote("Готово");

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
          {
            role: "assistant",
            content: data.answer,
            imageUrl: data.imageUrl,
            attachments: data.documentId
              ? [
                  {
                    id: data.documentId,
                    fileName: "generated.png",
                    fileType: "image/png",
                    fileSize: 0,
                    previewUrl: data.imageUrl,
                    fullUrl: data.imageUrl,
                    metadata: { kind: "generated_image" }
                  }
                ]
              : undefined
          }
        ]);
      } else {
        await streamAssistantMessage(response);
      }

      setNote("Готово");
      void loadRecentConversations();
    } catch (error) {
      setStreamingAssistantText(null);
      setMessages((current) => {
        const last = current[current.length - 1];
        const withoutEmptyAssistant =
          last?.role === "assistant" && !last.content ? current.slice(0, -1) : current;
        return [
          ...withoutEmptyAssistant,
          {
            role: "assistant",
            content:
              error instanceof Error
                ? `Ошибка: ${error.message}`
                : "Ошибка: не удалось обработать сообщение."
          }
        ];
      });
      setNote("Нужна проверка настроек");
    } finally {
      setIsLoading(false);
      setStreamingAssistantText(null);
    }
  }

  async function streamAssistantMessage(response: Response) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Ответ пришёл без stream body.");

    const decoder = new TextDecoder();
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      fullText += decoder.decode(value, { stream: true });
      setStreamingAssistantText(fullText);
    }

    const trailing = decoder.decode();
    if (trailing) {
      fullText += trailing;
      setStreamingAssistantText(fullText);
    }

    setMessages((current) => replaceLastAssistantMessage(current, fullText));
    setStreamingAssistantText(null);
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

        setIsTranscribing(true);
        setActivityPhase("transcription");

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
        } finally {
          setIsTranscribing(false);
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
    const tooLarge = selectedFiles.find((file) => file.size > 4.5 * 1024 * 1024);
    if (tooLarge) {
      setNote(`Файл «${tooLarge.name}» слишком большой. Максимум 4.5 МБ.`);
      return;
    }

    const batchId = crypto.randomUUID();
    const pendingAttachments: FileAttachment[] = selectedFiles.map((file) => ({
      batchId,
      fileName: file.name,
      fileType: file.type || inferClientFileType(file.name),
      fileSize: file.size,
      status: "uploading"
    }));

    setAttachments((current) => [...current, ...pendingAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setActivityPhase("file");
    setNote(selectedFiles.length > 1 ? "Загружаю файлы..." : "Загружаю файл...");

    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append("files", file));
    const uploadProjectId = getUploadProjectId();
    if (uploadProjectId) formData.append("projectId", String(uploadProjectId));

    try {
      const response = await fetch("/api/files", {
        method: "POST",
        body: formData
      });
      let data: { documents?: FileAttachment[]; error?: string };
      try {
        data = await response.json();
      } catch {
        throw new Error("Сервер вернул некорректный ответ. Обновите страницу и попробуйте снова.");
      }
      if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить файл");
      if (!data.documents?.length) {
        throw new Error("Сервер не вернул данные файла. Попробуйте ещё раз.");
      }

      setAttachments((current) => {
        let documentIndex = 0;
        return current.map((attachment) => {
          if (attachment.batchId !== batchId) return attachment;
          const document = data.documents?.[documentIndex++];
          if (!document?.id) {
            return {
              ...attachment,
              status: "error",
              error: "Не удалось получить данные загруженного файла"
            };
          }
          return { ...document, batchId, status: "ready" };
        });
      });
      setNote(selectedFiles.length > 1 ? "Файлы готовы" : "Файл готов");
    } catch (error) {
      const message = formatUploadError(error);
      setAttachments((current) =>
        current.map((attachment) =>
          attachment.batchId === batchId
            ? { ...attachment, status: "error", error: message }
            : attachment
        )
      );
      setNote(message);
    } finally {
      setActivityPhase((current) => (current === "file" ? null : current));
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
            <div className="sidebar-brand">
              <span className="brand-accent">T</span>Brain
            </div>
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
            <button className="sidebar-action sidebar-action-new-chat" onClick={resetToNewChat} type="button">
              <span aria-hidden className="sidebar-action-icon-wrap">
                <Zap size={16} strokeWidth={1.5} />
              </span>
              Новый чат
            </button>

            <label className="search-box">
              <Search size={17} />
              <input
                aria-label="Поиск"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Поиск"
                value={search}
              />
              {search ? (
                <button
                  aria-label="Очистить поиск"
                  className="search-clear"
                  onClick={clearSearch}
                  type="button"
                >
                  <X size={15} />
                </button>
              ) : null}
            </label>

            <SidebarMoreMenu
              onFiles={() => {
                setLibraryView("files");
                resetToNewChat();
              }}
              onImages={() => {
                setLibraryView("images");
                resetToNewChat();
              }}
              onSettings={() => {
                setLibraryView("settings");
              }}
            />
          </div>

          <div aria-hidden="true" className="sidebar-divider" />
        </div>

        <div className="sidebar-scroll">
          <button
            className="sidebar-section-toggle"
            onClick={() => setProjectsCollapsed((current) => !current)}
            type="button"
          >
            {projectsCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
            Проекты
          </button>

          {!projectsCollapsed ? (
            <ProjectFolderList
              activeConversationId={activeConversationId}
              conversations={conversations}
              conversationTitle={conversationTitle}
              draggingConversationId={draggingConversationId}
              dropTargetProjectId={dropTargetProjectId}
              expandedProjectIds={expandedProjectIds}
              onCloseMenu={() => setOpenMenuProjectId(null)}
              onCreateProject={() => void createProject()}
              onConversationContextMenu={openChatContextMenu}
              onDeleteProject={(projectId) => void deleteProjectById(projectId)}
              onDragConversationEnd={handleConversationDragEnd}
              onDragConversationStart={handleConversationDragStart}
              onDragOverProject={(projectId) => setDropTargetProjectId(String(projectId))}
              onDropOnProject={(projectId) => {
                if (draggingConversationId != null) {
                  void moveConversationToProject(draggingConversationId, projectId);
                }
              }}
              onOpenConversation={openConversation}
              onOpenMenu={setOpenMenuProjectId}
              onRenameProject={(projectId, title) => void renameProject(projectId, title)}
              onToggleProject={toggleProject}
              openMenuProjectId={openMenuProjectId}
              projects={projects}
            />
          ) : null}

          {!search.trim() ? (
            <>
              <div aria-hidden="true" className="sidebar-divider sidebar-divider-scroll" />
              <button
                className="sidebar-section-toggle"
                onClick={() => setRecentCollapsed((current) => !current)}
                type="button"
              >
                {recentCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                Недавние
              </button>

              {!recentCollapsed ? (
                <nav
                  className={`conversation-list ${
                    dropTargetProjectId === "general" ? "is-drop-target" : ""
                  }`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (draggingConversationId != null) setDropTargetProjectId("general");
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggingConversationId != null) {
                      void moveConversationToProject(draggingConversationId, null);
                    }
                  }}
                >
                  {generalConversations.length ? (
                    generalConversations.map((conversation, index) => (
                      <button
                        className={`conversation-item ${
                          String(conversation.id) === String(activeConversationId) ? "active" : ""
                        } ${String(draggingConversationId) === String(conversation.id) ? "is-dragging" : ""}`}
                        draggable
                        key={conversation.id}
                        onClick={() => openConversation(conversation.id)}
                        onContextMenu={(event) => openChatContextMenu(event, conversation.id)}
                        onDragEnd={handleConversationDragEnd}
                        onDragStart={() => handleConversationDragStart(conversation.id)}
                        type="button"
                      >
                        <span>
                          {conversationTitle(conversation, generalConversations, index)}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="sidebar-empty">Пока нет чатов</p>
                  )}
                </nav>
              ) : null}
            </>
          ) : null}

          {search.trim() ? (
            searchResults.length > 0 ? (
            <div className="search-results">
              <div className="sidebar-section-title">Найдено</div>
              {searchResults.slice(0, 12).map((result) => (
                <button
                  className="search-result"
                  key={`${result.type}-${result.id}`}
                  onClick={() => openSearchResult(result)}
                  type="button"
                >
                  <span className="search-result-type">{result.typeLabel}</span>
                  <strong>{result.title}</strong>
                  {result.snippet ? <span>{result.snippet}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="search-results-empty">Ничего не найдено</div>
          )) : null}
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

      <section
        className={`chat-shell ${hasMessages ? "with-messages" : "empty"}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <ObsidianBackground />
        {isDragOver ? (
          <div aria-hidden="true" className="drop-overlay">
            <div className="drop-overlay-card">Отпустите файл для загрузки</div>
          </div>
        ) : null}
        <header className="top-bar">
          {/*
          <button
            aria-label="История"
          */}
          <div className="brand">
            <div className="brand-mark">T</div>
            <div className="brand-title">
              <strong>
                <span className="brand-accent">T</span>Brain
              </strong>
              <span>Умный чат с личной памятью</span>
            </div>
          </div>
        </header>

        <section
          className={`messages ${hasMessages ? "" : "empty"}`}
          key={String(activeConversationId ?? "no-conversation")}
          ref={messagesRef}
          aria-live="polite"
        >
          {!hasMessages && libraryView === "settings" ? (
            <div className="empty-state">
              <div>
                <h1>Настройки</h1>
                <p>Раздел настроек скоро появится.</p>
              </div>
            </div>
          ) : null}
          {!hasMessages && (libraryView === "files" || libraryView === "images") ? (
            <div className="empty-state">
              <div>
                <h1>{libraryView === "files" ? "Файлы" : "Изображения"}</h1>
                <p>Откройте проект или загрузите файл в чат, чтобы увидеть материалы здесь.</p>
              </div>
            </div>
          ) : null}
          {!hasMessages && !libraryView ? (
            <div className="empty-state">
              <div>
                <h1>
                  Добро пожаловать в <span className="brand-accent">T</span>Brain
                </h1>
              </div>
            </div>
          ) : null}
          {hasMessages ? (
            messages.map((message, index) => {
              const isStreamingBubble =
                message.role === "assistant" &&
                index === messages.length - 1 &&
                streamingAssistantText !== null;
              const displayContent = isStreamingBubble
                ? streamingAssistantText
                : message.content;
              const generatedImageUrl = resolveGeneratedImageUrl(message);
              const visibleAttachments = (message.attachments ?? []).filter(
                (attachment) => attachment.metadata?.kind !== "generated_image"
              );

              return (
              <article
                className={`message-row ${message.role} ${
                  message.attachments?.length ? "has-attachments" : ""
                }`}
                key={`${message.role}-${index}`}
              >
                {message.role === "assistant" ? <div className="avatar avatar-assistant">T</div> : null}
                <div className="bubble">
                  {displayContent ? (
                    <div>
                      {renderHighlightedText(
                        displayContent,
                        highlightTerm,
                        activeMatchIndex,
                        countMatchesInMessages(messages.slice(0, index), highlightTerm)
                      )}
                    </div>
                  ) : null}
                  {visibleAttachments.length ? (
                    <MessageAttachments
                      attachments={visibleAttachments}
                      onPreview={setPreviewImage}
                    />
                  ) : null}
                  {generatedImageUrl ? (
                    <img
                      className="generated-image"
                      src={generatedImageUrl}
                      alt="Generated result"
                    />
                  ) : null}
                </div>
                {message.role === "user" ? <div className="avatar avatar-user">Я</div> : null}
              </article>
              );
            })
          ) : null}
          {activityPhase && activityPhase !== "file" && activityPhase !== "transcription" ? (
            <ThinkingIndicator
              active={showChatIndicator}
              layout="message"
              phase={activityPhase}
            />
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
          {activityPhase === "file" || activityPhase === "transcription" ? (
            <ThinkingIndicator
              active={showCompactIndicator}
              layout="compact"
              phase={activityPhase}
            />
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
              accept=".pdf,.docx,.txt,.md,.csv,.json,.xlsx,.xls,.png,.jpg,.jpeg,.webp"
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
          {note && note !== "Готово" && !showChatIndicator && !showCompactIndicator ? (
            <div className="composer-note">{note}</div>
          ) : null}
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

      {chatContextMenu ? (
        <ChatContextMenu
          onClose={() => setChatContextMenu(null)}
          onCreateProject={() => createProjectFromChat(chatContextMenu.conversationId)}
          x={chatContextMenu.x}
          y={chatContextMenu.y}
        />
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
  conversation: { title: string | null },
  conversations: { title: string | null }[],
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

function resolveGeneratedImageUrl(message: ChatMessage) {
  if (message.imageUrl) return message.imageUrl;
  const generated = message.attachments?.find(
    (attachment) => attachment.metadata?.kind === "generated_image"
  );
  return generated?.previewUrl ?? generated?.fullUrl ?? undefined;
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
  const text = message.trim();
  if (!text) return false;

  const hasImageWord =
    /(?:изображен|картин|picture|image|photo|фото|иллюстра|арт\b|artwork|icon|лого|logo|wallpaper|обо[ий])/i.test(
      text
    );
  const hasCreateVerb =
    /(?:сгенериру|созда|нарисуй|нарис|отрис|сделай|сделать|нарисовать|создать|generate|create|make|draw|render|paint|design|produce|visuali)/i.test(
      text
    );
  const shortCommand =
    /(?:^|\s)(?:нарисуй|сгенерируй|создай(?:\s+(?:мне\s+)?(?:картин|изображ|фото|picture|image))?|generate(?:\s+an?\s+image)?|draw(?:\s+me)?)(?:[\s!.?]|$)/i.test(
      text
    );
  const politeRequest =
    /(?:хочу|нужн|можешь|можно|please|want|need).{0,50}(?:изображ|картин|picture|image|photo|фото|иллюстра)/i.test(
      text
    );

  return shortCommand || politeRequest || (hasImageWord && hasCreateVerb);
}

function shouldEditImage(message: string) {
  return /(?:улучши|измени|перегенерируй|переделай|отредактируй|сделай|добавь|убери|замени|вариант|edit|improve|change|modify|variation)/i.test(
    message
  );
}

function formatUploadError(error: unknown) {
  const message = error instanceof Error ? error.message : "Ошибка загрузки файла";
  if (/unsupported Unicode escape sequence/i.test(message)) {
    return "Не удалось сохранить файл: неподдерживаемая кодировка. Сохраните файл как UTF-8.";
  }
  if (/pdf\.worker|fake worker failed/i.test(message)) {
    return "Не удалось обработать PDF. Попробуйте другой файл или формат.";
  }
  if (/Could not upload file to storage|Bucket not found|fetch failed/i.test(message)) {
    return "Не удалось загрузить файл в хранилище Supabase. Проверьте bucket documents и интернет.";
  }
  if (/Could not save document metadata/i.test(message)) {
    return "Файл загружен, но не сохранился в базе. Проверьте таблицу documents в Supabase.";
  }
  if (/не поддержан/i.test(message)) {
    return message;
  }
  return message;
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
