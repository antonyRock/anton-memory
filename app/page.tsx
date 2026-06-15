"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent,
  type ReactNode
} from "react";
import { SearchResultsList } from "@/components/SearchResultsList";
import { ComposerTextarea, type ComposerTextareaHandle } from "@/components/ComposerTextarea";
import { VoiceRecordingPanel } from "@/components/VoiceRecordingPanel";
import { MessageCopyButton } from "@/components/MessageCopyButton";
import { MessageReplyButton } from "@/components/MessageReplyButton";
import { ComposerReplyBanner } from "@/components/ComposerReplyBanner";
import { PullToRefreshIndicator } from "@/components/PullToRefreshIndicator";
import { SidebarUserProfile } from "@/components/SidebarUserProfile";
import { ProjectFolderList } from "@/components/ProjectFolderList";
import { ChatFilesPanel } from "@/components/ChatFilesPanel";
import { ChatContextMenu } from "@/components/ChatContextMenu";
import { SidebarConversationItem } from "@/components/SidebarConversationItem";
import { ProjectNavigator } from "@/components/ProjectNavigator";
import { ObsidianBackground } from "@/components/ObsidianBackground";
import { WelcomeRotatingText } from "@/components/WelcomeRotatingText";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import {
  isImageAttachment,
  normalizeClientAttachment,
  resolveAttachmentDownloadSources,
  resolveAttachmentPreviewUrl
} from "@/lib/attachment-client";
import { downloadClientAttachment } from "@/lib/attachment-download";
import { sanitizeDownloadFileName } from "@/lib/download-filename";
import { ImagePreviewModal } from "@/components/ImagePreviewModal";
import {
  buildChatUrl,
  syncChatQueryParam
} from "@/lib/chat-links";
import { shareOrCopyText } from "@/lib/copy-to-clipboard";
import { createRuntimeId } from "@/lib/id";
import { logClientEvent } from "@/lib/client-log";
import { isConversationPinned, sortConversationsForSidebar } from "@/lib/chat-pins";
import type { FileNavItem } from "@/lib/file-nav-shared";
import { renderMessageContent } from "@/lib/message-text";
import { isMobileViewport } from "@/lib/viewport";
import { useVoiceRecording } from "@/hooks/useVoiceRecording";
import type { VoiceTranscriptMeta } from "@/lib/transcription";
import { useAuthFetch } from "@/hooks/useAuthFetch";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { MOBILE_MEDIA_QUERY } from "@/lib/viewport";
import {
  ThinkingIndicator,
  type ThinkingPhase
} from "@/components/ThinkingIndicator";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Download,
  FileSpreadsheet,
  FileText,
  GripVertical,
  Image as ImageIcon,
  Link2,
  Loader2,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Pin,
  Search,
  Send,
  Square,
  X,
  TextCursorInput,
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
  metadata?: Record<string, unknown>;
  attachments?: FileAttachment[];
  replyTo?: {
    role: "user" | "assistant";
    content: string;
  };
};

type ReplyTarget = {
  role: "user" | "assistant";
  content: string;
};

type Conversation = {
  id: string | number;
  title: string | null;
  summary: string | null;
  project_id?: string | number | null;
  metadata?: Record<string, unknown> | null;
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
  documentId?: string | number | null;
  title: string;
  snippet: string;
  fileName?: string;
  conversationTitle?: string;
  projectTitle?: string;
  matchText?: string;
};

type LibraryView = "settings" | null;
type MessageSubmitSource = "form" | "enter" | "voice";
type ChatMode = "fast" | "smart" | "analytics";

const DEFAULT_CHAT_TITLE = "Новый чат";
const VOICE_REVIEW_PREF_KEY = "reviewVoiceBeforeSend";
const CHAT_MODE_PREF_KEY = "chatMode";
const MIN_SIDEBAR_WIDTH = 240;
const MAX_SIDEBAR_WIDTH = 420;
const DEFAULT_SIDEBAR_WIDTH = 280;
const SCROLL_BOTTOM_THRESHOLD = 200;
const CHAT_MODE_OPTIONS: Array<{ value: ChatMode; label: string }> = [
  { value: "fast", label: "Быстро" },
  { value: "smart", label: "Умно" },
  { value: "analytics", label: "Аналитика" }
];
const QUICK_ACTION_PROMPTS = [
  "Какие ссылки я сохранил?",
  "Что ты помнишь обо мне?",
  "Покажи мои последние проекты",
  "Что важного я обсуждал сегодня?"
] as const;

function readReplyFromMetadata(metadata?: Record<string, unknown>) {
  const reply = metadata?.reply_to;
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) return undefined;
  const role = (reply as { role?: string }).role;
  const content = String((reply as { content?: string }).content ?? "").trim();
  if ((role !== "user" && role !== "assistant") || !content) return undefined;
  return { role: role as "user" | "assistant", content };
}

function beginReplyToMessage(
  message: ChatMessage,
  focusComposer: () => void,
  setReplyTo: (value: ReplyTarget | null) => void,
  setNote: (value: string) => void
) {
  const content = message.content.trim();
  if (!content) return;
  setReplyTo({ role: message.role, content });
  focusComposer();
  setNote("Ответ на сообщение");
}

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
  const [activeProjectId, setActiveProjectId] = useState<string | number | null>(null);
  const [projectNavigatorTab, setProjectNavigatorTab] = useState<"chats" | "files" | "images">("chats");
  const [showChatFilesPanel, setShowChatFilesPanel] = useState(false);
  const [chatFilesPanelKind, setChatFilesPanelKind] = useState<"files" | "images">("files");
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
  const [reviewVoiceBeforeSend, setReviewVoiceBeforeSend] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>("smart");
  const pendingVoiceTranscriptRef = useRef<VoiceTranscriptMeta | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [activityPhase, setActivityPhase] = useState<ThinkingPhase | null>(null);
  const [streamingAssistantText, setStreamingAssistantText] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [previewImage, setPreviewImage] = useState<FileAttachment | null>(null);
  const [note, setNote] = useState("Готово");
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [isRenamingChat, setIsRenamingChat] = useState(false);
  const [renameChatValue, setRenameChatValue] = useState("");
  const [mobileRenameChat, setMobileRenameChat] = useState<{
    conversationId: string | number;
    value: string;
  } | null>(null);
  const [pullToRefreshEnabled, setPullToRefreshEnabled] = useState(false);
  const activeRequestRef = useRef<AbortController | null>(null);
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerTextareaRef = useRef<ComposerTextareaHandle | null>(null);
  const chatRenameInputRef = useRef<HTMLInputElement | null>(null);
  const mobileRenameInputRef = useRef<HTMLInputElement | null>(null);
  const mobileRenameOpenedRef = useRef(false);
  const pendingChatRenameRef = useRef<{
    conversationId: string | number;
    title: string;
  } | null>(null);
  const renameBlurGuardRef = useRef(false);
  const submitInFlightRef = useRef(false);
  const activeConversationIdRef = useRef<string | number | null>(null);
  activeConversationIdRef.current = activeConversationId;
  const { authFetch, authUrl, accessToken } = useAuthFetch();
  const {
    isRecording,
    recordingDurationLabel,
    recordingSizeLabel,
    recordingSizeStatus,
    isTranscribing,
    pendingRecording,
    transcriptionError,
    startRecording,
    stopRecording,
    retryTranscription,
    deletePendingRecording
  } = useVoiceRecording({
    disabled: isLoading,
    authFetch,
    getConversationId: () => activeConversationIdRef.current,
    onNote: setNote,
    onTranscriptReady: (text, meta) => {
      if (reviewVoiceBeforeSend) {
        setInput((current) => (current.trim() ? `${current.trim()} ${text}` : text));
        if (meta) pendingVoiceTranscriptRef.current = meta;
        setNote("Проверьте текст и отправьте");
        window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
        return;
      }
      const combined = input.trim() ? `${input.trim()} ${text}` : text;
      void sendMessage(combined, attachments, "voice", meta);
    }
  });
  const messagesRef = useRef<HTMLElement | null>(null);
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(false);
  const userPausedAutoScrollRef = useRef(false);
  const stickToBottomConversationRef = useRef<string | null>(null);
  const stickToBottomTimerRef = useRef<number | null>(null);
  const resizingSidebarRef = useRef(false);
  const hasComposerContent = input.trim().length > 0 || attachments.length > 0;
  const showComposerSendButton = isLoading || isRecording || hasComposerContent;
  const showComposerMicButton = !isRecording && !isLoading;
  const hasMessages = messages.length > 0;
  const pinComposerToBottom = true;
  const isUploadingFiles = attachments.some((file) => file.status === "uploading");
  const showChatIndicator =
    isLoading &&
    (streamingAssistantText === null || streamingAssistantText.length === 0);
  const showCompactIndicator = isUploadingFiles || isTranscribing;
  const matchCount = countMatchesInMessages(messages, highlightTerm);
  const bootstrappedRef = useRef(false);
  const prefsHydratedRef = useRef(false);
  const loadMessagesSeqRef = useRef(0);
  const messagesCacheRef = useRef<Map<string, ChatMessage[]>>(new Map());
  const messagesAbortRef = useRef<AbortController | null>(null);
  const creatingChatRef = useRef(false);
  const pendingNewChatProjectIdRef = useRef<string | number | null>(null);
  const generalConversations = sortConversationsForSidebar(
    conversations.filter((conversation) => !conversation.project_id)
  );
  const activeConversation = conversations.find(
    (conversation) => String(conversation.id) === String(activeConversationId)
  );
  const activeProject = projects.find(
    (project) => activeProjectId != null && String(project.id) === String(activeProjectId)
  );
  const projectConversations =
    activeProjectId != null
      ? sortConversationsForSidebar(
          conversations.filter(
            (conversation) => String(conversation.project_id) === String(activeProjectId)
          )
        )
      : [];
  const isActiveConversationPinned = activeConversation
    ? isConversationPinned(activeConversation)
    : false;
  const allProjectsExpanded =
    projects.length > 0 &&
    projects.every((project) => expandedProjectIds[String(project.id)] === true);
  const showProjectView = activeProjectId != null && !activeConversationId;
  const showWelcomeEmpty =
    !hasMessages &&
    !showProjectView &&
    !libraryView &&
    !(isLoadingHistory && activeConversationId != null);
  const showHistoryEmptyState =
    !hasMessages &&
    !showProjectView &&
    !libraryView &&
    activeConversationId != null &&
    (isLoadingHistory || historyLoadError != null);
  const messagesSurfaceKey = hasMessages
    ? String(activeConversationId ?? activeProjectId ?? "chat")
    : "empty-welcome";
  const activeChatTitle = activeConversation
    ? (() => {
        const list = activeConversation.project_id
          ? conversations.filter(
              (item) => String(item.project_id) === String(activeConversation.project_id)
            )
          : generalConversations;
        const index = list.findIndex((item) => String(item.id) === String(activeConversation.id));
        return conversationTitle(activeConversation, list, Math.max(index, 0));
      })()
    : DEFAULT_CHAT_TITLE;

  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
    } else {
      navigator.serviceWorker?.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => {
          void registration.unregister();
        });
      });
    }

    const isMobile = isMobileViewport();
    setSidebarCollapsed(
      isMobile ? false : window.localStorage.getItem("sidebarCollapsed") === "true"
    );
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
    if (Number.isFinite(savedWidth)) {
      setSidebarWidth(clampSidebarWidth(savedWidth));
    }

    setReviewVoiceBeforeSend(window.localStorage.getItem(VOICE_REVIEW_PREF_KEY) === "true");
    const savedChatMode = window.localStorage.getItem(CHAT_MODE_PREF_KEY);
    if (savedChatMode === "fast" || savedChatMode === "smart" || savedChatMode === "analytics") {
      setChatMode(savedChatMode);
    }

    prefsHydratedRef.current = true;
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!input.trim()) {
      pendingVoiceTranscriptRef.current = null;
    }
  }, [input]);

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
    if (
      pendingChatRenameRef.current != null &&
      String(pendingChatRenameRef.current.conversationId) === String(activeConversationId)
    ) {
      const pending = pendingChatRenameRef.current;
      pendingChatRenameRef.current = null;
      setRenameChatValue(pending.title);
      setIsRenamingChat(true);
      return;
    }

    setIsRenamingChat(false);
    setRenameChatValue("");
  }, [activeConversationId]);

  useEffect(() => {
    if (!mobileRenameChat) {
      mobileRenameOpenedRef.current = false;
      return;
    }
    if (mobileRenameOpenedRef.current) return;
    mobileRenameOpenedRef.current = true;

    const handle = window.setTimeout(() => {
      mobileRenameInputRef.current?.focus();
      mobileRenameInputRef.current?.select();
    }, 40);
    return () => window.clearTimeout(handle);
  }, [mobileRenameChat]);

  useEffect(() => {
    setActivityPhase((current) => {
      if (isTranscribing) return "transcription";
      return current === "transcription" ? null : current;
    });
  }, [isTranscribing]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const update = () => {
      setPullToRefreshEnabled(
        mediaQuery.matches && typeof window !== "undefined" && "ontouchstart" in window
      );
    };
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (activeConversationId == null) return;
    messagesCacheRef.current.set(String(activeConversationId), messages);
  }, [messages, activeConversationId]);

  useEffect(() => {
    if (!isRenamingChat) return;
    renameBlurGuardRef.current = true;
    const guardHandle = window.setTimeout(() => {
      renameBlurGuardRef.current = false;
    }, 450);
    chatRenameInputRef.current?.focus();
    chatRenameInputRef.current?.select();
    return () => window.clearTimeout(guardHandle);
  }, [isRenamingChat]);

  useEffect(() => {
    if (!shouldAutoScrollRef.current || userPausedAutoScrollRef.current) return;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, streamingAssistantText]);

  useEffect(() => {
    const node = messagesRef.current;
    if (!node || !hasMessages || showProjectView) {
      setShowScrollToBottom(false);
      return;
    }

    const updateScrollToBottomVisibility = () => {
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      const atBottom = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD;
      const canScroll = node.scrollHeight > node.clientHeight + 8;
      setShowScrollToBottom(canScroll && !atBottom);
      return atBottom;
    };

    const onScroll = () => {
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      const atBottom = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD;
      if (!atBottom) {
        shouldAutoScrollRef.current = false;
        userPausedAutoScrollRef.current = true;
        if (stickToBottomConversationRef.current === String(activeConversationId)) {
          stickToBottomConversationRef.current = null;
        }
      } else if (!isLoading && streamingAssistantText === null) {
        userPausedAutoScrollRef.current = false;
      }
      updateScrollToBottomVisibility();
    };

    node.addEventListener("scroll", onScroll, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollToBottomVisibility);
    resizeObserver.observe(node);

    updateScrollToBottomVisibility();

    return () => {
      node.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  }, [
    hasMessages,
    showProjectView,
    isLoading,
    streamingAssistantText,
    messages.length,
    activeConversationId
  ]);

  useEffect(() => {
    if (!activeConversationId) return;
    if (stickToBottomConversationRef.current !== String(activeConversationId)) return;
    scrollMessagesToBottom(true);
  }, [messages, activeConversationId]);

  useEffect(() => {
    if (!highlightTerm || matchCount === 0) return;
    const active = messagesRef.current?.querySelector(".search-highlight.active");
    active?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeMatchIndex, highlightTerm, matchCount, messages]);

  useEffect(() => {
    if (!prefsHydratedRef.current) return;
    window.localStorage.setItem("sidebarCollapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!sidebarOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  useEffect(() => {
    if (!sidebarOpen || !isMobileViewport()) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const onChange = () => {
      if (!media.matches) {
        setSidebarOpen(false);
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!prefsHydratedRef.current) return;
    window.localStorage.setItem("expandedProjectIds", JSON.stringify(expandedProjectIds));
    if (projects.length > 0) {
      const everyExpanded = projects.every(
        (project) => expandedProjectIds[String(project.id)] === true
      );
      window.localStorage.setItem("projectsExpanded", String(everyExpanded));
    }
  }, [expandedProjectIds, projects]);

  useEffect(() => {
    if (!prefsHydratedRef.current) return;
    window.localStorage.setItem("recentCollapsed", String(recentCollapsed));
  }, [recentCollapsed]);

  useEffect(() => {
    if (!prefsHydratedRef.current) return;
    window.localStorage.setItem("sidebarWidth", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (activeMatchIndex >= matchCount) {
      setActiveMatchIndex(Math.max(0, matchCount - 1));
    }
  }, [activeMatchIndex, matchCount]);

  async function bootstrap() {
    bootstrappedRef.current = true;
    const chatFromUrl = new URLSearchParams(window.location.search).get("chat");
    if (chatFromUrl) {
      openConversation(chatFromUrl);
    } else {
      resetToNewChat();
    }
    void Promise.all([loadRecentConversations(), loadProjects()]);
  }

  async function loadProjects() {
    try {
      const response = await authFetch("/api/projects");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось загрузить проекты");
      const loaded = (data.projects ?? []) as Project[];
      setProjects(loaded);

      if (loaded.length > 0 && window.localStorage.getItem("projectsExpanded") === "true") {
        setExpandedProjectIds((current) => {
          const next = { ...current };
          for (const project of loaded) {
            next[String(project.id)] = true;
          }
          return next;
        });
      }
    } catch {
      setProjects([]);
    }
  }

  function focusComposer() {
    window.requestAnimationFrame(() => {
      composerTextareaRef.current?.focus();
      window.setTimeout(() => composerTextareaRef.current?.focus(), 150);
    });
  }

  function applyQuickActionPrompt(prompt: string) {
    // TODO: later replace static cards with personalized prompts from memory usage.
    setInput(prompt);
    setNote("Подсказка добавлена в поле ввода");
    window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
  }

  function openCreatedProjectChat(projectId: string | number, conversationId: string | number) {
    pendingNewChatProjectIdRef.current = null;
    creatingChatRef.current = false;
    cancelPendingMessageLoad();
    shouldAutoScrollRef.current = false;
    resetMessagesScroll();
    setShowChatFilesPanel(false);
    setLibraryView(null);
    setPreviewImage(null);
    setMessages([]);
    setInput("");
    setAttachments([]);
    setSearch("");
    setSearchResults([]);
    setHighlightTerm("");
    setActiveMatchIndex(0);
    setExpandedProjectIds((current) => ({ ...current, [String(projectId)]: true }));
    setProjectsCollapsed(false);
    setActiveProjectId(null);
    setActiveConversationId(conversationId);
    activeConversationIdRef.current = conversationId;
    window.localStorage.setItem("activeConversationId", String(conversationId));
    syncChatQueryParam(conversationId);
    setNote(DEFAULT_CHAT_TITLE);
    closeSidebarIfMobile();
    setSidebarOpen(false);
    focusComposer();
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
      const response = await authFetch("/api/projects", {
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
        setSidebarOpen(false);
        closeSidebarIfMobile();
      } else {
        const conversationId = await createConversation(project.id);
        if (!conversationId) {
          setNote("Не удалось создать чат в проекте");
          return project;
        }
        openCreatedProjectChat(project.id, conversationId);
      }

      return project;
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось создать проект");
      return null;
    }
  }

  function openChatContextMenuAt(
    conversationId: string | number,
    x: number,
    y: number
  ) {
    setChatContextMenu({ conversationId, x, y });
  }

  function openChatContextMenu(event: ReactMouseEvent, conversationId: string | number) {
    event.preventDefault();
    event.stopPropagation();
    openChatContextMenuAt(conversationId, event.clientX, event.clientY);
  }

  function openChatContextMenuFromLongPress(
    conversationId: string | number,
    point: { x: number; y: number }
  ) {
    openChatContextMenuAt(conversationId, point.x, point.y);
  }

  function beginChatRenameForConversation(conversationId: string | number) {
    const conversation = conversations.find(
      (item) => String(item.id) === String(conversationId)
    );
    if (!conversation) return;

    const title = normalizeConversationTitle(conversation.title);

    if (isMobileViewport()) {
      setMobileRenameChat({ conversationId, value: title });
      return;
    }

    if (String(activeConversationId) === String(conversationId)) {
      setRenameChatValue(title);
      setIsRenamingChat(true);
      return;
    }

    pendingChatRenameRef.current = { conversationId, title };
    openConversation(conversationId);
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

  function toggleAllProjectsExpanded() {
    if (projects.length === 0) return;

    if (allProjectsExpanded) {
      setExpandedProjectIds({});
      window.localStorage.setItem("projectsExpanded", "false");
      return;
    }

    const next: Record<string, boolean> = {};
    for (const project of projects) {
      next[String(project.id)] = true;
    }
    setExpandedProjectIds(next);
    window.localStorage.setItem("projectsExpanded", "true");
    setProjectsCollapsed(false);
  }

  async function renameProject(projectId: string | number, title: string) {
    const project = projects.find((item) => String(item.id) === String(projectId));
    const trimmed = title.trim();
    if (!trimmed || trimmed === project?.title) {
      setOpenMenuProjectId(null);
      return;
    }

    try {
      const response = await authFetch(`/api/projects/${projectId}`, {
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
      const response = await authFetch(`/api/projects/${projectId}`, { method: "DELETE" });
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

  async function deleteChatById(conversationId: string | number) {
    const conversation = conversations.find((item) => String(item.id) === String(conversationId));
    const title = conversationTitle(
      conversation ?? { title: null },
      conversations,
      0
    );

    if (
      !window.confirm(
        `Удалить чат «${title}»? Сообщения будут удалены без возможности восстановления.`
      )
    ) {
      return;
    }

    try {
      const response = await authFetch(`/api/conversations/${conversationId}`, {
        method: "DELETE"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось удалить чат");

      messagesCacheRef.current.delete(String(conversationId));
      setConversations((current) =>
        current.filter((item) => String(item.id) !== String(conversationId))
      );
      setSearchResults((current) =>
        current.filter((item) => String(item.conversationId) !== String(conversationId))
      );

      if (String(activeConversationId) === String(conversationId)) {
        resetToNewChat();
      }

      setChatContextMenu(null);
      setNote("Чат удалён");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось удалить чат");
    }
  }

  function beginChatRename() {
    if (!activeConversationId || !activeConversation) return;
    setRenameChatValue(normalizeConversationTitle(activeConversation.title));
    setIsRenamingChat(true);
  }

  function cancelChatRename() {
    setIsRenamingChat(false);
    setRenameChatValue("");
  }

  async function persistChatTitle(conversationId: string | number, rawTitle: string) {
    const conversation = conversations.find(
      (item) => String(item.id) === String(conversationId)
    );
    const trimmed = rawTitle.trim().slice(0, 80);
    const currentTitle = normalizeConversationTitle(conversation?.title ?? null);
    if (!trimmed || trimmed === currentTitle) return;

    try {
      const response = await authFetch(`/api/conversations/${conversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось переименовать чат");

      const updated = data.conversation as Conversation;
      setConversations((current) =>
        current.map((item) =>
          String(item.id) === String(conversationId) ? { ...item, ...updated } : item
        )
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось переименовать чат");
    }
  }

  async function submitMobileChatRename() {
    if (!mobileRenameChat) return;
    const { conversationId, value } = mobileRenameChat;
    setMobileRenameChat(null);
    await persistChatTitle(conversationId, value);
  }

  async function submitChatRename() {
    if (!activeConversationId) {
      cancelChatRename();
      return;
    }

    const trimmed = renameChatValue.trim().slice(0, 80);
    setIsRenamingChat(false);
    setRenameChatValue("");
    await persistChatTitle(activeConversationId, trimmed);
  }

  async function toggleConversationPin() {
    if (!activeConversationId || !activeConversation) return;

    const nextPinned = !isConversationPinned(activeConversation);

    try {
      const response = await authFetch(`/api/conversations/${activeConversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: nextPinned })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Не удалось закрепить чат");

      const updated = data.conversation as Conversation;
      setConversations((current) =>
        current.map((conversation) =>
          String(conversation.id) === String(activeConversationId)
            ? { ...conversation, ...updated }
            : conversation
        )
      );
      setNote(nextPinned ? "Чат закреплён" : "Чат откреплён");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось закрепить чат");
    }
  }

  async function moveConversationToProject(
    conversationId: string | number,
    projectId: string | number | null
  ) {
    try {
      const response = await authFetch(`/api/conversations/${conversationId}`, {
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

  function openSidebar() {
    setSidebarCollapsed(false);
    if (isMobileViewport()) {
      setSidebarOpen(true);
    }
  }

  function toggleSidebar() {
    if (!isMobileViewport()) return;

    if (sidebarOpen) {
      setSidebarOpen(false);
    } else {
      setSidebarCollapsed(false);
      setSidebarOpen(true);
    }
  }

  function closeSidebarIfMobile() {
    if (isMobileViewport()) {
      setSidebarOpen(false);
    }
  }

  function expandProjectFromSearch(projectId: string | number) {
    setExpandedProjectIds((current) => ({ ...current, [String(projectId)]: true }));
    setProjectsCollapsed(false);
    openSidebar();
  }

  async function loadRecentConversations() {
    try {
      const response = await authFetch("/api/conversations?search=");
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
      const response = await authFetch(`/api/conversations?search=${encodeURIComponent(trimmed)}`);
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

  function cancelPendingMessageLoad() {
    messagesAbortRef.current?.abort();
    messagesAbortRef.current = null;
    loadMessagesSeqRef.current += 1;
    setIsLoadingHistory(false);
  }

  async function loadMessages(conversationId: string | number) {
    cancelPendingMessageLoad();
    const requestSeq = loadMessagesSeqRef.current;
    const controller = new AbortController();
    messagesAbortRef.current = controller;
    setIsLoadingHistory(true);
    setHistoryLoadError(null);

    const maxAttempts = 2;

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (requestSeq !== loadMessagesSeqRef.current) return;

        try {
          const response = await authFetch(`/api/conversations/${conversationId}/messages`, {
            signal: controller.signal
          });
          const data = await response.json();
          if (requestSeq !== loadMessagesSeqRef.current) return;

          if (!response.ok) {
            const message = data.error ?? "Не удалось загрузить сообщения";
            if (attempt + 1 < maxAttempts && response.status >= 500) {
              await new Promise((resolve) => window.setTimeout(resolve, 800));
              continue;
            }
            throw new Error(message);
          }

          setMessages((previous) =>
            mergeLoadedChatMessages(
              previous,
              (data.messages ?? []) as Array<{
                role: "user" | "assistant";
                content: string;
                attachments?: Array<Record<string, unknown>>;
                imageUrl?: string | null;
                metadata?: Record<string, unknown>;
              }>
            )
          );
          shouldAutoScrollRef.current = true;
          beginStickToBottom(conversationId);
          window.localStorage.setItem("activeConversationId", String(conversationId));
          setSidebarOpen(false);
          return;
        } catch (error) {
          if (requestSeq !== loadMessagesSeqRef.current) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (attempt + 1 < maxAttempts) {
            await new Promise((resolve) => window.setTimeout(resolve, 800));
            continue;
          }
          setMessages([]);
          setHistoryLoadError(
            error instanceof Error ? error.message : "Не удалось загрузить сообщения"
          );
          setNote(
            error instanceof Error ? error.message : "Не удалось загрузить сообщения"
          );
        }
      }
    } finally {
      if (requestSeq === loadMessagesSeqRef.current) {
        setIsLoadingHistory(false);
        messagesAbortRef.current = null;
      }
    }
  }

  const refreshAppData = useCallback(async () => {
    setNote("Обновление...");
    try {
      await Promise.all([
        loadRecentConversations(),
        loadProjects(),
        activeConversationId != null
          ? loadMessages(activeConversationId)
          : Promise.resolve()
      ]);
      setNote("Обновлено");
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось обновить");
    }
  }, [activeConversationId]);

  const pullToRefreshActive =
    pullToRefreshEnabled && !isLoading && !isRecording && !isTranscribing;

  const messagesPull = usePullToRefresh({
    enabled: pullToRefreshActive,
    onRefresh: refreshAppData,
    targetRef: messagesRef
  });

  const sidebarPull = usePullToRefresh({
    enabled: pullToRefreshActive && sidebarOpen,
    onRefresh: refreshAppData,
    targetRef: sidebarScrollRef
  });

  function resetToNewChat() {
    cancelPendingMessageLoad();
    pendingVoiceTranscriptRef.current = null;
    pendingNewChatProjectIdRef.current = null;
    creatingChatRef.current = false;
    shouldAutoScrollRef.current = false;
    resetMessagesScroll();
    setActiveConversationId(null);
    setMessages([]);
    setInput("");
    setAttachments([]);
    setSearch("");
    setSearchResults([]);
    setSidebarOpen(false);
    setLibraryView(null);
    setReplyTo(null);
    setNote(DEFAULT_CHAT_TITLE);
    setHistoryLoadError(null);
    setIsLoadingHistory(false);
    window.localStorage.removeItem("activeConversationId");
    syncChatQueryParam(null);
  }

  function toggleReviewVoiceBeforeSend() {
    setReviewVoiceBeforeSend((current) => {
      const next = !current;
      window.localStorage.setItem(VOICE_REVIEW_PREF_KEY, String(next));
      setNote(next ? "Голос будет вставляться для проверки" : "Голос отправляется сразу");
      return next;
    });
  }

  function handleChatModeChange(nextValue: string) {
    if (nextValue !== "fast" && nextValue !== "smart" && nextValue !== "analytics") return;
    setChatMode(nextValue);
    window.localStorage.setItem(CHAT_MODE_PREF_KEY, nextValue);
    const option = CHAT_MODE_OPTIONS.find((item) => item.value === nextValue);
    setNote(`Режим: ${option?.label ?? nextValue}`);
  }

  async function copyChatLink(conversationId: string | number) {
    const url = buildChatUrl(conversationId);
    const result = await shareOrCopyText(url, "Ссылка на чат");

    if (result === "copied") {
      setNote("Ссылка на чат скопирована");
      return;
    }
    if (result === "shared") {
      setNote("Ссылка отправлена");
      return;
    }
    if (result === "cancelled") return;

    setNote(`Не удалось скопировать. Ссылка: ${url}`);
  }

  async function createConversation(projectId?: string | number | null) {
    try {
      const body =
        projectId != null && projectId !== "" ? { projectId } : {};
      const response = await authFetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
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
      return conversation.id;
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Не удалось создать чат");
      return null;
    }
  }

  async function startNewChat() {
    const projectId = activeProjectId ?? activeConversation?.project_id ?? null;
    if (projectId != null) {
      if (creatingChatRef.current) return;

      creatingChatRef.current = true;
      pendingNewChatProjectIdRef.current = projectId;
      const previousProjectId = activeProjectId;
      cancelPendingMessageLoad();

      shouldAutoScrollRef.current = false;
      resetMessagesScroll();
      setActiveProjectId(null);
      setActiveConversationId(null);
      setShowChatFilesPanel(false);
      setMessages([]);
      setInput("");
      setAttachments([]);
      setPreviewImage(null);
      setLibraryView(null);
      setSearch("");
      setSearchResults([]);
      setHighlightTerm("");
      setActiveMatchIndex(0);
      setNote("Создаю чат...");
      closeSidebarIfMobile();

      try {
        const conversationId = await createConversation(projectId);
        if (!conversationId) {
          if (previousProjectId != null) setActiveProjectId(previousProjectId);
          return;
        }

        setExpandedProjectIds((current) => ({ ...current, [String(projectId)]: true }));
        setProjectsCollapsed(false);
        setActiveConversationId(conversationId);
        window.localStorage.setItem("activeConversationId", String(conversationId));
        syncChatQueryParam(conversationId);
        setNote(DEFAULT_CHAT_TITLE);
        focusComposer();
      } finally {
        pendingNewChatProjectIdRef.current = null;
        creatingChatRef.current = false;
      }
      return;
    }

    resetToNewChat();
    closeSidebarIfMobile();
  }

  function openProject(
    projectId: string | number,
    tab: "chats" | "files" | "images" = "chats"
  ) {
    cancelPendingMessageLoad();
    pendingNewChatProjectIdRef.current = null;
    creatingChatRef.current = false;
    shouldAutoScrollRef.current = false;
    resetMessagesScroll();
    setProjectNavigatorTab(tab);
    setActiveProjectId(projectId);
    setExpandedProjectIds((current) => ({ ...current, [String(projectId)]: true }));
    setActiveConversationId(null);
    setMessages([]);
    setLibraryView(null);
    setShowChatFilesPanel(false);
    setInput("");
    setAttachments([]);
    closeSidebarIfMobile();
    window.history.replaceState({}, "", "/");
  }

  function closeProjectView() {
    setActiveProjectId(null);
    setProjectNavigatorTab("chats");
  }

  function openChatFilesPanel(kind: "files" | "images" = "files") {
    if (!activeConversationId) return;
    setChatFilesPanelKind(kind);
    setShowChatFilesPanel(true);
    closeSidebarIfMobile();
  }

  function handleOpenNavFile(file: FileNavItem) {
    void openFileAttachment(file);
  }

  function handleDownloadNavFile(file: FileNavItem) {
    void downloadAttachment(
      normalizeClientAttachment(file as unknown as Record<string, unknown>)
    );
  }

  async function downloadAttachment(attachment: FileAttachment) {
    try {
      setNote(`Скачиваю ${attachment.fileName}...`);
      await downloadClientAttachment(
        normalizeClientAttachment(attachment as unknown as Record<string, unknown>),
        { authFetch, authUrl }
      );
      setNote("Файл скачан");
    } catch {
      setNote("Не удалось скачать файл");
    }
  }

  async function openFileAttachment(attachment: {
    id?: string | number;
    fileName: string;
    fileType: string;
    fileSize?: number;
    fullUrl?: string | null;
    previewUrl?: string | null;
    metadata?: Record<string, unknown>;
    conversationId?: string | number | null;
  }) {
    if (isImageAttachment(attachment as FileAttachment)) {
      const normalized = normalizeClientAttachment(attachment as unknown as Record<string, unknown>);
      if (resolveAttachmentPreviewUrl(normalized)) {
        setPreviewImage(normalized);
        return;
      }
    }

    const normalized = normalizeClientAttachment(attachment as unknown as Record<string, unknown>);
    if (resolveAttachmentDownloadSources(normalized).length === 0) {
      if (attachment.conversationId != null) {
        setActiveProjectId(null);
        setShowChatFilesPanel(false);
        openConversation(attachment.conversationId);
        setNote("Файл недоступен для скачивания, открыт исходный чат");
        return;
      }
      setNote("Не удалось открыть файл");
      return;
    }

    const inline = canOpenDocumentInline(normalized.fileName, normalized.fileType);

    try {
      if (inline && !isMobileViewport() && normalized.id != null) {
        setNote("Открываю файл...");
        const url = authUrl(buildDocumentDownloadUrl(normalized.id, true));
        await downloadDocumentViaBlob(url, normalized.fileName, true, authFetch);
        setNote("Файл открыт");
        return;
      }

      setNote(`Скачиваю ${normalized.fileName}...`);
      await downloadClientAttachment(normalized, { authFetch, authUrl });
      setNote("Файл скачан");
    } catch {
      setNote("Не удалось скачать файл");
    }
  }

  function openConversation(conversationId: string | number | null | undefined) {
    if (!conversationId || String(conversationId) === "legacy") return;

    const conversation = conversations.find(
      (item) => String(item.id) === String(conversationId)
    );

    pendingNewChatProjectIdRef.current = null;
    creatingChatRef.current = false;
    userPausedAutoScrollRef.current = false;
    shouldAutoScrollRef.current = true;
    beginStickToBottom(conversationId);
    setShowChatFilesPanel(false);
    setLibraryView(null);
    setPreviewImage(null);
    setMessages(messagesCacheRef.current.get(String(conversationId)) ?? []);

    if (conversation?.project_id != null) {
      setActiveProjectId(conversation.project_id);
      setExpandedProjectIds((current) => ({
        ...current,
        [String(conversation.project_id)]: true
      }));
    } else {
      setActiveProjectId(null);
    }

    setActiveConversationId(conversationId);
    window.localStorage.setItem("activeConversationId", String(conversationId));
    syncChatQueryParam(conversationId);
    void loadMessages(conversationId);
    closeSidebarIfMobile();
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

  function beginStickToBottom(conversationId: string | number) {
    stickToBottomConversationRef.current = String(conversationId);
    if (stickToBottomTimerRef.current) {
      window.clearTimeout(stickToBottomTimerRef.current);
    }
    stickToBottomTimerRef.current = window.setTimeout(() => {
      if (stickToBottomConversationRef.current === String(conversationId)) {
        stickToBottomConversationRef.current = null;
      }
      stickToBottomTimerRef.current = null;
    }, 3500);
  }

  function shouldStickToBottom() {
    return (
      activeConversationId != null &&
      stickToBottomConversationRef.current === String(activeConversationId)
    );
  }

  function isNearBottom(node?: HTMLDivElement | null) {
    const target = node ?? messagesRef.current;
    if (!target) return true;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    return distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD;
  }

  function handleConversationMediaLoad() {
    if (userPausedAutoScrollRef.current) return;
    if (shouldStickToBottom() || shouldAutoScrollRef.current) {
      scrollMessagesToBottom(false);
    }
  }

  function resetMessagesScroll() {
    if (messagesRef.current) messagesRef.current.scrollTop = 0;
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    setShowScrollToBottom(false);
  }

  function scrollMessagesToBottom(followLayout = false) {
    const node = messagesRef.current;
    if (!node) return;

    const apply = () => {
      node.scrollTop = node.scrollHeight;
      setShowScrollToBottom(false);
    };

    apply();
    requestAnimationFrame(apply);
    window.setTimeout(apply, 0);
    window.setTimeout(apply, 60);
    window.setTimeout(apply, 180);

    if (!followLayout) return;

    const started = performance.now();
    const observer = new ResizeObserver(() => {
      if (userPausedAutoScrollRef.current) return;
      if (!shouldStickToBottom() && !shouldAutoScrollRef.current) return;
      apply();
      if (performance.now() - started > 3500) {
        observer.disconnect();
      }
    });
    observer.observe(node);
    window.setTimeout(() => observer.disconnect(), 3500);
  }

  function scrollToChatBottom() {
    userPausedAutoScrollRef.current = false;
    shouldAutoScrollRef.current = true;
    endRef.current?.scrollIntoView({ behavior: "smooth" });
    const node = messagesRef.current;
    if (!node) return;
    window.setTimeout(() => {
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      setShowScrollToBottom(distanceFromBottom > SCROLL_BOTTOM_THRESHOLD);
    }, 350);
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
    if (result.type === "document" || result.type === "image") {
      void openSearchDocument(result);
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

  async function openSearchDocument(result: SearchResult) {
    const documentId = result.documentId ?? result.id;
    try {
      const response = await authFetch(`/api/documents/${documentId}`);
      const data = await response.json();
      if (response.ok && data.file) {
        await openFileAttachment({
          ...data.file,
          conversationId: result.conversationId ?? null
        });
        closeSidebarIfMobile();
        return;
      }
    } catch {
      // Fall back to opening the source chat below.
    }

    if (result.conversationId) {
      openConversation(result.conversationId);
      closeSidebarIfMobile();
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

  function stopGeneration() {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    void streamReaderRef.current?.cancel().catch(() => undefined);
    streamReaderRef.current = null;
    setStreamingAssistantText(null);
    setIsLoading(false);
    setActivityPhase(null);
    setMessages((current) => {
      const last = current[current.length - 1];
      if (last?.role === "assistant" && !last.content && !last.imageUrl) {
        return current.slice(0, -1);
      }
      return current;
    });
    setNote("Остановлено");
  }

  async function sendMessage(
    text: string,
    files = attachments,
    source: MessageSubmitSource = "form",
    voiceTranscript?: VoiceTranscriptMeta
  ) {
    const trimmed = text.trim();
    if ((!trimmed && files.length === 0) || isLoading || submitInFlightRef.current) {
      if (submitInFlightRef.current) {
        logClientEvent("MESSAGE_SUBMIT_BLOCKED", {
          reason: "in_flight",
          source,
          conversationId: activeConversationIdRef.current
        });
      }
      return;
    }
    if (files.some((file) => file.status === "uploading")) {
      if (source === "voice" && trimmed) {
        setInput((current) => (current.trim() ? `${current.trim()} ${trimmed}` : trimmed));
        if (voiceTranscript) {
          pendingVoiceTranscriptRef.current = voiceTranscript;
        }
        setNote("Голос распознан. Дождитесь загрузки файла и отправьте сообщение.");
        window.requestAnimationFrame(() => composerTextareaRef.current?.focus());
        return;
      }
      setNote("Дождитесь загрузки файла");
      return;
    }

    setLibraryView(null);

    if (creatingChatRef.current || pendingNewChatProjectIdRef.current != null) {
      setNote("Создаю чат...");
      return;
    }

    submitInFlightRef.current = true;
    const submitId = createRuntimeId();

    let resolvedVoiceTranscript = voiceTranscript;
    if (!resolvedVoiceTranscript && pendingVoiceTranscriptRef.current) {
      resolvedVoiceTranscript = pendingVoiceTranscriptRef.current;
    }

    let conversationId = activeConversationId;
    if (!conversationId) {
      const projectId =
        activeProjectId ?? activeConversation?.project_id ?? pendingNewChatProjectIdRef.current;
      conversationId = await createConversation(projectId ?? undefined);
      if (conversationId) {
        setActiveConversationId(conversationId);
        activeConversationIdRef.current = conversationId;
        window.localStorage.setItem("activeConversationId", String(conversationId));
        syncChatQueryParam(conversationId);
      }
    }
    if (!conversationId) {
      submitInFlightRef.current = false;
      setNote("Не удалось создать чат. Проверьте подключение к Supabase.");
      return;
    }

    if (resolvedVoiceTranscript && !voiceTranscript) {
      pendingVoiceTranscriptRef.current = null;
    }

    const readyFiles = files.filter((file) => file.status === "ready" && file.id);
    const readyDocumentIds = readyFiles.map((file) => file.id);
    const displayText = trimmed || files.map((file) => file.fileName).join(", ");
    const hasImageAttachment = readyFiles.some((file) => isImageAttachment(file));
    const imageIntent =
      shouldGenerateImage(trimmed) || (hasImageAttachment && shouldEditImage(trimmed));
    const activeReply = replyTo;

    logClientEvent("MESSAGE_SUBMIT", {
      submitId,
      source,
      conversationId,
      textLength: displayText.length,
      replyToRole: activeReply?.role ?? null
    });

    userPausedAutoScrollRef.current = false;
    shouldAutoScrollRef.current = isNearBottom();
    const clientRecentMessages = messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-12)
      .map((message) => ({
        role: message.role,
        content: message.content
      }));

    setMessages((current) => [
      ...current,
      {
        role: "user",
        content: displayText,
        attachments: readyFiles.map((file) =>
          normalizeClientAttachment(file as unknown as Record<string, unknown>)
        ),
        replyTo: activeReply ?? undefined
      },
      { role: "assistant", content: "" }
    ]);
    setStreamingAssistantText("");
    setInput("");
    setAttachments([]);
    setReplyTo(null);
    setIsLoading(true);
    setActivityPhase(imageIntent ? "image" : "thinking");
    setNote(imageIntent ? "Создаю изображение… обычно до минуты" : "Готово");

    const abortController = new AbortController();
    activeRequestRef.current = abortController;

    try {
      const response = await authFetch(imageIntent ? "/api/images" : "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify(
          imageIntent
            ? { prompt: trimmed, documentIds: readyDocumentIds, conversationId }
            : {
                message: trimmed || "Посмотри прикреплённые файлы.",
                documentIds: readyDocumentIds,
                conversationId,
                chatMode,
                recentMessages: clientRecentMessages,
                replyTo: activeReply ?? undefined,
                ...(resolvedVoiceTranscript
                  ? {
                      voiceTranscript: {
                        rawTranscript: resolvedVoiceTranscript.rawTranscript,
                        cleanedTranscript: resolvedVoiceTranscript.cleanedTranscript,
                        transcriptStatus: resolvedVoiceTranscript.transcriptStatus
                      }
                    }
                  : {})
              }
        )
      });

      if (!response.ok) throw new Error(await readError(response));

      if (imageIntent) {
        const data = await response.json();
        setMessages((current) =>
          replaceLastAssistantMessage(current, data.answer ?? "Готово.", {
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
          })
        );
      } else {
        await streamAssistantMessage(response, abortController.signal);
      }

      setNote("Готово");
      void loadRecentConversations();
      void loadMessages(conversationId);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setNote("Остановлено");
        setMessages((current) => {
          const last = current[current.length - 1];
          if (last?.role === "assistant" && !last.content && !last.imageUrl) {
            return current.slice(0, -1);
          }
          return current;
        });
        return;
      }

      setStreamingAssistantText(null);
      setMessages((current) => {
        const last = current[current.length - 1];
        const withoutEmptyAssistant =
          last?.role === "assistant" && !last.content && !last.imageUrl
            ? current.slice(0, -1)
            : current;
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
      activeRequestRef.current = null;
      streamReaderRef.current = null;
      submitInFlightRef.current = false;
      setIsLoading(false);
      setStreamingAssistantText(null);
      setActivityPhase(null);
    }
  }

  async function streamAssistantMessage(response: Response, signal?: AbortSignal) {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Ответ пришёл без stream body.");

    streamReaderRef.current = reader;

    const decoder = new TextDecoder();
    let fullText = "";

    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel();
          throw new DOMException("The operation was aborted.", "AbortError");
        }

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
    } finally {
      if (streamReaderRef.current === reader) {
        streamReaderRef.current = null;
      }
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

  function handleComposerSubmit(source: MessageSubmitSource) {
    if (isRecording) {
      stopRecording("send");
      return;
    }
    if (isTranscribing) return;
    void sendMessage(input, attachments, source);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    handleComposerSubmit("form");
  }

  async function onFilesSelected(fileList: FileList | null) {
    if (!fileList?.length) return;
    const selectedFiles = Array.from(fileList);
    const tooLarge = selectedFiles.find((file) => file.size > 4.5 * 1024 * 1024);
    if (tooLarge) {
      setNote(`Файл «${tooLarge.name}» слишком большой. Максимум 4.5 МБ.`);
      return;
    }

    const batchId = createRuntimeId();
    const pendingAttachments: FileAttachment[] = selectedFiles.map((file) => {
      const fileType = file.type || inferClientFileType(file.name);
      const canPreview = isImageAttachment({ fileName: file.name, fileType });
      return {
        batchId,
        fileName: file.name,
        fileType,
        fileSize: file.size,
        previewUrl: canPreview ? URL.createObjectURL(file) : undefined,
        status: "uploading"
      };
    });

    setAttachments((current) => [...current, ...pendingAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setActivityPhase("file");
    setNote(selectedFiles.length > 1 ? "Загружаю файлы..." : "Загружаю файл...");

    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append("files", file));
    const uploadProjectId = getUploadProjectId();
    if (uploadProjectId) formData.append("projectId", String(uploadProjectId));

    try {
      const response = await authFetch("/api/files", {
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
          if (attachment.previewUrl?.startsWith("blob:")) {
            const normalized = normalizeClientAttachment({
              ...(document as unknown as Record<string, unknown>),
              batchId,
              status: "ready"
            });
            const serverPreview = normalized.previewUrl;
            const keepBlob =
              !serverPreview ||
              (!serverPreview.startsWith("data:") && serverPreview.startsWith("/api/"));
            return {
              ...normalized,
              previewUrl: keepBlob ? attachment.previewUrl : serverPreview
            };
          }
          return normalizeClientAttachment({
            ...(document as unknown as Record<string, unknown>),
            batchId,
            status: "ready"
          });
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

      <section
        className={`chat-shell ${pinComposerToBottom ? "with-messages" : "empty"} ${
          activeConversationId || showProjectView ? "has-active-chat" : ""
        } ${showProjectView ? "has-project-view" : ""}`}
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
          <button
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? "Закрыть меню" : "Открыть меню"}
            className="mobile-menu-button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleSidebar();
            }}
            type="button"
          >
            {sidebarOpen ? <X size={20} /> : <PanelLeftOpen size={20} />}
          </button>
          <div className="brand">
            <div className="brand-title">
              <strong>
                <span className="brand-accent">T</span>Brain
              </strong>
              <span>
                {showProjectView && activeProject ? (
                  activeProject.title
                ) : activeConversationId ? (
                  isRenamingChat ? (
                    <input
                      aria-label="Название чата"
                      className="chat-title-rename-input"
                      maxLength={80}
                      onBlur={() => {
                        if (renameBlurGuardRef.current) return;
                        void submitChatRename();
                      }}
                      onChange={(event) => setRenameChatValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void submitChatRename();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelChatRename();
                        }
                      }}
                      ref={chatRenameInputRef}
                      value={renameChatValue}
                    />
                  ) : (
                    <span
                      className="chat-title-label"
                      onDoubleClick={beginChatRename}
                      title="Дважды нажмите, чтобы переименовать"
                    >
                      {activeChatTitle}
                    </span>
                  )
                ) : null}
              </span>
            </div>
          </div>
          <div className="top-bar-actions">
            <label className="chat-model-select-wrap" title="Режим модели ответа">
              <span className="chat-model-select-label">Режим</span>
              <select
                aria-label="Режим ответа"
                className="chat-model-select"
                onChange={(event) => handleChatModeChange(event.target.value)}
                value={chatMode}
              >
                {CHAT_MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-label="Проверять голос перед отправкой"
              aria-pressed={reviewVoiceBeforeSend}
              className={`chat-share-button chat-voice-review-toggle ${
                reviewVoiceBeforeSend ? "is-active" : ""
              }`}
              onClick={toggleReviewVoiceBeforeSend}
              title={
                reviewVoiceBeforeSend
                  ? "Голос вставляется для проверки"
                  : "Проверять голос перед отправкой"
              }
              type="button"
            >
              <TextCursorInput size={18} />
            </button>
            <button
              aria-label={isActiveConversationPinned ? "Открепить чат" : "Закрепить чат"}
              aria-pressed={isActiveConversationPinned}
              className={`chat-share-button chat-pin-button ${
                isActiveConversationPinned ? "is-pinned" : ""
              }`}
              disabled={!activeConversationId}
              onClick={() => {
                void toggleConversationPin();
              }}
              title={isActiveConversationPinned ? "Открепить чат" : "Закрепить чат"}
              type="button"
            >
              <Pin size={18} />
            </button>
            <button
              aria-label="Файлы чата"
              className="chat-share-button"
              disabled={!activeConversationId}
              onClick={() => openChatFilesPanel("files")}
              title="Файлы чата"
              type="button"
            >
              <FileText size={18} />
            </button>
            <button
              aria-label="Изображения чата"
              className="chat-share-button"
              disabled={!activeConversationId}
              onClick={() => openChatFilesPanel("images")}
              title="Изображения чата"
              type="button"
            >
              <ImageIcon size={18} />
            </button>
            <button
              aria-label="Копировать ссылку на чат"
              className="chat-share-button"
              disabled={!activeConversationId}
              onClick={() => {
                if (!activeConversationId) return;
                void copyChatLink(activeConversationId);
              }}
              title="Копировать ссылку на чат"
              type="button"
            >
              <Link2 size={18} />
            </button>
          </div>
        </header>

        <div className="messages-pull-host">
          <PullToRefreshIndicator
            isRefreshing={messagesPull.isRefreshing}
            pullDistance={messagesPull.pullDistance}
          />
          <section
            className={`messages ${hasMessages ? "" : "empty"} ${showProjectView ? "project-view" : ""} ${
              messagesPull.isActive ? "is-pulling" : ""
            } ${messagesPull.isRefreshing ? "is-refreshing" : ""}`}
            key={messagesSurfaceKey}
            ref={messagesRef}
            aria-live="polite"
            style={
              messagesPull.isActive
                ? ({ "--pull-offset": `${messagesPull.pullDistance}px` } as CSSProperties)
                : undefined
            }
          >
          {showProjectView && activeProject ? (
            <ProjectNavigator
              conversations={projectConversations}
              initialTab={projectNavigatorTab}
              onBack={closeProjectView}
              onNewChat={() => {
                void startNewChat();
              }}
              onOpenConversation={openConversation}
              onOpenFile={handleOpenNavFile}
              onDownloadFile={handleDownloadNavFile}
              projectId={activeProject.id}
              projectTitle={activeProject.title}
            />
          ) : null}
          {!hasMessages && !showProjectView && libraryView === "settings" ? (
            <div className="empty-state">
              <div>
                <h1>Настройки</h1>
                <p>Раздел настроек скоро появится.</p>
              </div>
            </div>
          ) : null}
          {showWelcomeEmpty ? (
            <div className="empty-state">
              <WelcomeRotatingText />
              <div className="quick-actions">
                {QUICK_ACTION_PROMPTS.map((prompt) => (
                  <button
                    className="quick-action-card"
                    key={prompt}
                    onClick={() => applyQuickActionPrompt(prompt)}
                    type="button"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {showHistoryEmptyState ? (
            <div className="empty-state history-loading-state">
              {isLoadingHistory ? (
                <>
                  <Loader2 aria-hidden="true" className="spin history-loading-spinner" size={28} />
                  <p>Загрузка истории...</p>
                </>
              ) : historyLoadError ? (
                <>
                  <p>{historyLoadError}</p>
                  <button
                    className="history-retry-button"
                    onClick={() => void loadMessages(activeConversationId)}
                    type="button"
                  >
                    Повторить
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
          {hasMessages && !showProjectView ? (
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
                {message.role === "user" ? (
                  <div className="message-stack message-stack-user">
                    <div className="bubble">
                      {message.replyTo ? (
                        <div className="message-reply-quote">
                          <span className="message-reply-quote-label">
                            {message.replyTo.role === "assistant" ? "TBrain" : "Вы"}
                          </span>
                          <p className="message-reply-quote-text">
                            {message.replyTo.content.slice(0, 220)}
                            {message.replyTo.content.length > 220 ? "…" : ""}
                          </p>
                        </div>
                      ) : null}
                      {displayContent ? (
                        <div>
                          {renderMessageContent(displayContent, {
                            highlight: {
                              term: highlightTerm,
                              activeMatchIndex,
                              startIndex: countMatchesInMessages(messages.slice(0, index), highlightTerm)
                            },
                            onCopyNotify: setNote
                          })}
                        </div>
                      ) : null}
                      {visibleAttachments.length ? (
                        <MessageAttachments
                          accessToken={accessToken}
                          attachments={visibleAttachments}
                          authFetch={authFetch}
                          onDownload={(attachment) => void downloadAttachment(attachment)}
                          onOpen={(attachment) => void openFileAttachment(attachment)}
                        />
                      ) : null}
                      {generatedImageUrl ? (
                        <img
                          className="generated-image"
                          decoding="async"
                          loading={index >= messages.length - 2 ? "eager" : "lazy"}
                          onLoad={handleConversationMediaLoad}
                          src={generatedImageUrl}
                          alt="Generated result"
                        />
                      ) : null}
                    </div>
                    {displayContent ? (
                      <div className="message-actions message-actions-user">
                        <MessageCopyButton
                          copyLabel="Копировать сообщение"
                          notifyMessage="Сообщение скопировано"
                          onNotify={setNote}
                          text={displayContent}
                        />
                        <MessageReplyButton
                          label="Ответить на своё сообщение"
                          onReply={() => {
                            beginReplyToMessage(
                              message,
                              () => composerTextareaRef.current?.focus(),
                              setReplyTo,
                              setNote
                            );
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : (
                <div className="bubble">
                  {message.replyTo ? (
                    <div className="message-reply-quote">
                      <span className="message-reply-quote-label">
                        {message.replyTo.role === "assistant" ? "TBrain" : "Вы"}
                      </span>
                      <p className="message-reply-quote-text">
                        {message.replyTo.content.slice(0, 220)}
                        {message.replyTo.content.length > 220 ? "…" : ""}
                      </p>
                    </div>
                  ) : null}
                  {displayContent ? (
                    <div>
                      {renderMessageContent(displayContent, {
                        highlight: {
                          term: highlightTerm,
                          activeMatchIndex,
                          startIndex: countMatchesInMessages(messages.slice(0, index), highlightTerm)
                        },
                        onCopyNotify: setNote
                      })}
                    </div>
                  ) : null}
                  {visibleAttachments.length ? (
                    <MessageAttachments
                      accessToken={accessToken}
                      attachments={visibleAttachments}
                      authFetch={authFetch}
                      onDownload={(attachment) => void downloadAttachment(attachment)}
                      onOpen={(attachment) => void openFileAttachment(attachment)}
                    />
                  ) : null}
                  {generatedImageUrl ? (
                    <img
                      className="generated-image"
                      decoding="async"
                      loading={index >= messages.length - 2 ? "eager" : "lazy"}
                      onLoad={handleConversationMediaLoad}
                      src={generatedImageUrl}
                      alt="Generated result"
                    />
                  ) : null}
                  {displayContent && !isStreamingBubble ? (
                    <div className="message-actions">
                      <MessageReplyButton
                        onReply={() => {
                          beginReplyToMessage(
                            { ...message, content: displayContent },
                            () => composerTextareaRef.current?.focus(),
                            setReplyTo,
                            setNote
                          );
                        }}
                      />
                      <MessageCopyButton onNotify={setNote} text={displayContent} />
                    </div>
                  ) : null}
                </div>
                )}
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
        </div>

        {!showProjectView ? (
        <div className={`composer-wrap ${pinComposerToBottom ? "" : "empty"}`}>
          {hasMessages ? (
            <button
              aria-label="Перейти в конец чата"
              className={`scroll-to-bottom-button ${showScrollToBottom ? "is-visible" : ""}`}
              onClick={scrollToChatBottom}
              title="Перейти в конец чата"
              type="button"
            >
              <ChevronDown size={20} />
            </button>
          ) : null}
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
          <VoiceRecordingPanel
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            onDelete={() => {
              void deletePendingRecording();
            }}
            onRetry={() => {
              void retryTranscription();
            }}
            pendingRecording={pendingRecording}
            recordingDurationLabel={recordingDurationLabel}
            recordingSizeLabel={recordingSizeLabel}
            recordingSizeStatus={recordingSizeStatus}
            transcriptionError={transcriptionError}
          />
          {attachments.length > 0 ? (
            <div className="attachments" aria-live="polite">
              {attachments.map((attachment, index) => (
                <UploadAttachmentCard
                  attachment={attachment}
                  authFetch={authFetch}
                  key={`${attachment.fileName}-${index}`}
                  onRemove={() =>
                    setAttachments((current) =>
                      current.filter((item, currentIndex) => {
                        if (currentIndex !== index) return true;
                        if (item.previewUrl?.startsWith("blob:")) {
                          URL.revokeObjectURL(item.previewUrl);
                        }
                        return false;
                      })
                    )
                  }
                />
              ))}
            </div>
          ) : null}
          {replyTo ? (
            <ComposerReplyBanner
              content={replyTo.content}
              onCancel={() => setReplyTo(null)}
              role={replyTo.role}
            />
          ) : null}
          <form
            className={`composer ${isRecording ? "is-recording" : ""} ${
              isTranscribing ? "is-transcribing" : ""
            } ${transcriptionError && !isRecording && !isTranscribing ? "has-voice-error" : ""}`}
            onSubmit={onSubmit}
          >
            <input
              accept=".pdf,.docx,.txt,.md,.csv,.json,.xlsx,.xls,.png,.jpg,.jpeg,.webp"
              disabled={isLoading || isRecording || isTranscribing}
              id="composer-file-input"
              ref={fileInputRef}
              className="file-input"
              multiple
              onChange={(event) => void onFilesSelected(event.target.files)}
              type="file"
            />
            {isRecording ? (
              <button
                aria-label="Отменить запись"
                className="icon-button cancel-action composer-side-action"
                disabled={isLoading}
                onClick={() => stopRecording("cancel")}
                title="Отменить запись"
                type="button"
              >
                <Square size={20} />
              </button>
            ) : (
              <label
                aria-label="Добавить файл"
                className={`icon-button composer-tool composer-side-action file-attach-label ${
                  isLoading ? "disabled" : ""
                }`}
                htmlFor="composer-file-input"
                title="Добавить файл"
              >
                <Paperclip size={20} />
              </label>
            )}
            <ComposerTextarea
              disabled={isLoading || isRecording || isTranscribing}
              onChange={setInput}
              onSubmit={() => {
                handleComposerSubmit("enter");
              }}
              ref={composerTextareaRef}
              value={input}
            />
            <div className="composer-actions">
              {showComposerMicButton ? (
                <button
                  aria-label={
                    isTranscribing
                      ? "Распознавание речи"
                      : transcriptionError
                        ? "Ошибка распознавания"
                        : "Начать запись"
                  }
                  className={`composer-mic-button ${
                    isTranscribing ? "is-transcribing" : ""
                  } ${transcriptionError && !isTranscribing ? "has-error" : ""}`}
                  disabled={isLoading || isTranscribing}
                  onClick={() => {
                    void startRecording();
                  }}
                  title={
                    isTranscribing
                      ? "Распознавание..."
                      : transcriptionError
                        ? "Ошибка распознавания"
                        : "Микрофон"
                  }
                  type="button"
                >
                  {isTranscribing ? (
                    <Loader2 className="composer-mic-spinner" size={20} />
                  ) : (
                    <Mic size={20} />
                  )}
                </button>
              ) : null}
              {showComposerSendButton ? (
                <button
                  aria-label={isLoading ? "Остановить генерацию" : isRecording ? "Отправить запись" : "Отправить"}
                  className={`icon-button primary composer-send-button ${isLoading ? "stop-generation" : ""}`}
                  disabled={!isLoading && (isRecording ? false : !hasComposerContent)}
                  onClick={isLoading ? stopGeneration : undefined}
                  title={isLoading ? "Остановить" : isRecording ? "Отправить запись" : "Отправить"}
                  type={isLoading ? "button" : "submit"}
                >
                  {isLoading ? <Square size={18} fill="currentColor" /> : <Send size={20} />}
                </button>
              ) : null}
            </div>
          </form>
          {note && note !== "Готово" && !showChatIndicator && !showCompactIndicator ? (
            <div className="composer-note">{note}</div>
          ) : null}
        </div>
        ) : null}
      </section>

      <aside aria-label="Навигация" className="sidebar">
        <div className="sidebar-fixed">
          <div className="sidebar-header">
            <div className="sidebar-brand">
              <span className="brand-accent">T</span>Brain
            </div>
            <button
              aria-label="Свернуть или закрыть меню"
              className="sidebar-close"
              onClick={() => {
                if (isMobileViewport()) {
                  setSidebarOpen(false);
                } else {
                  setSidebarCollapsed(true);
                }
              }}
              type="button"
            >
              <span aria-hidden className="sidebar-close-desktop">
                <PanelLeftClose size={18} />
              </span>
              <span aria-hidden className="sidebar-close-mobile">
                <X size={18} />
              </span>
            </button>
          </div>

          <div className="sidebar-actions">
            <button
              className="sidebar-action sidebar-action-new-chat"
              onClick={() => {
                void startNewChat();
              }}
              type="button"
            >
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
          </div>

          <div aria-hidden="true" className="sidebar-divider" />
        </div>

        <div className="sidebar-scroll-host">
          <PullToRefreshIndicator
            isRefreshing={sidebarPull.isRefreshing}
            pullDistance={sidebarPull.pullDistance}
          />
          <div
            className={`sidebar-scroll ${sidebarPull.isActive ? "is-pulling" : ""} ${
              sidebarPull.isRefreshing ? "is-refreshing" : ""
            }`}
            ref={sidebarScrollRef}
            style={
              sidebarPull.isActive
                ? ({ "--pull-offset": `${sidebarPull.pullDistance}px` } as CSSProperties)
                : undefined
            }
          >
          <div className="sidebar-section-header">
            <button
              className="sidebar-section-toggle sidebar-section-toggle-main"
              onClick={() => setProjectsCollapsed((current) => !current)}
              type="button"
            >
              {projectsCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              <span className="sidebar-section-label">
                Проекты
                <span className="sidebar-section-count">({projects.length})</span>
              </span>
            </button>
            {!projectsCollapsed && projects.length > 0 ? (
              <button
                aria-label={allProjectsExpanded ? "Свернуть все проекты" : "Развернуть все проекты"}
                className="projects-expand-all-button"
                onClick={toggleAllProjectsExpanded}
                title={allProjectsExpanded ? "Свернуть все" : "Развернуть все"}
                type="button"
              >
                {allProjectsExpanded ? <ChevronsUp size={15} /> : <ChevronsDown size={15} />}
              </button>
            ) : null}
          </div>

          {!projectsCollapsed ? (
            <ProjectFolderList
              activeConversationId={activeConversationId}
              conversations={conversations}
              conversationTitle={conversationTitle}
              draggingConversationId={draggingConversationId}
              dropTargetProjectId={dropTargetProjectId}
              expandedProjectIds={expandedProjectIds}
              onCloseMenu={() => setOpenMenuProjectId(null)}
              onCreateProject={(title) => void createProject({ title })}
              onConversationContextMenu={openChatContextMenu}
              onConversationLongPress={openChatContextMenuFromLongPress}
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
              onOpenProjectFiles={(projectId) => openProject(projectId, "files")}
              onOpenProjectImages={(projectId) => openProject(projectId, "images")}
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
                      <SidebarConversationItem
                        active={String(conversation.id) === String(activeConversationId)}
                        conversationId={conversation.id}
                        dragging={String(draggingConversationId) === String(conversation.id)}
                        key={conversation.id}
                        onContextMenu={(event) => openChatContextMenu(event, conversation.id)}
                        onDragEnd={handleConversationDragEnd}
                        onDragStart={() => handleConversationDragStart(conversation.id)}
                        onLongPress={(point) =>
                          openChatContextMenuFromLongPress(conversation.id, point)
                        }
                        onOpen={() => openConversation(conversation.id)}
                        pinned={isConversationPinned(conversation)}
                        title={conversationTitle(conversation, generalConversations, index)}
                      />
                    ))
                  ) : (
                    <p className="sidebar-empty">Пока нет чатов</p>
                  )}
                </nav>
              ) : null}
            </>
          ) : null}

          {search.trim() ? (
            <SearchResultsList
              onSelect={openSearchResult}
              query={search}
              results={searchResults}
            />
          ) : null}
        </div>
        </div>

        <SidebarUserProfile
          onNotify={setNote}
          onSettings={() => {
            setLibraryView("settings");
            closeSidebarIfMobile();
          }}
        />

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

      {previewImage ? (
        <ImagePreviewModal
          attachment={previewImage}
          authFetch={authFetch}
          onClose={() => setPreviewImage(null)}
          onDownload={downloadAttachment}
        />
      ) : null}

      {showChatFilesPanel && activeConversationId ? (
        <ChatFilesPanel
          conversationId={activeConversationId}
          conversationTitle={activeChatTitle}
          kind={chatFilesPanelKind}
          onClose={() => setShowChatFilesPanel(false)}
          onDownloadFile={handleDownloadNavFile}
          onOpenFile={handleOpenNavFile}
        />
      ) : null}

      {chatContextMenu ? (
        <ChatContextMenu
          onClose={() => setChatContextMenu(null)}
          onCopyLink={() => void copyChatLink(chatContextMenu.conversationId)}
          onCreateProject={() => createProjectFromChat(chatContextMenu.conversationId)}
          onDelete={() => void deleteChatById(chatContextMenu.conversationId)}
          onOpenFiles={() => {
            openConversation(chatContextMenu.conversationId);
            openChatFilesPanel("files");
          }}
          onRename={() => beginChatRenameForConversation(chatContextMenu.conversationId)}
          x={chatContextMenu.x}
          y={chatContextMenu.y}
        />
      ) : null}

      {mobileRenameChat ? (
        <div aria-labelledby="mobile-rename-chat-title" aria-modal="true" className="mobile-rename-sheet" role="dialog">
          <button
            aria-label="Закрыть"
            className="mobile-rename-sheet-backdrop"
            onClick={() => setMobileRenameChat(null)}
            type="button"
          />
          <form
            className="mobile-rename-sheet-panel"
            onSubmit={(event) => {
              event.preventDefault();
              void submitMobileChatRename();
            }}
          >
            <h2 id="mobile-rename-chat-title">Переименовать чат</h2>
            <input
              aria-label="Название чата"
              className="mobile-rename-sheet-input"
              maxLength={80}
              onChange={(event) =>
                setMobileRenameChat((current) =>
                  current ? { ...current, value: event.target.value } : current
                )
              }
              ref={mobileRenameInputRef}
              value={mobileRenameChat.value}
            />
            <div className="mobile-rename-sheet-actions">
              <button
                onClick={() => setMobileRenameChat(null)}
                type="button"
              >
                Отмена
              </button>
              <button className="mobile-rename-sheet-submit" type="submit">
                Сохранить
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function replaceLastAssistantMessage(
  messages: ChatMessage[],
  content: string,
  extras: Partial<ChatMessage> = {}
) {
  const next = [...messages];
  const last = next[next.length - 1];
  if (last?.role === "assistant") {
    next[next.length - 1] = { ...last, content, ...extras };
  }
  return next;
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

  const metadata = message.metadata ?? {};
  const previewUrl =
    typeof metadata.image_preview_url === "string" ? metadata.image_preview_url : null;
  if (previewUrl) return previewUrl;

  if (typeof metadata.generated_document_id === "string" || typeof metadata.generated_document_id === "number") {
    return buildDocumentDownloadUrl(metadata.generated_document_id, true);
  }

  const generated = message.attachments?.find(
    (attachment) => attachment.metadata?.kind === "generated_image"
  );
  return (
    generated?.previewUrl ??
    generated?.fullUrl ??
    (generated?.id != null ? buildDocumentDownloadUrl(generated.id, true) : undefined)
  );
}

function normalizeConversationTitle(title: string | null) {
  const trimmed = title?.trim();
  if (!trimmed) return DEFAULT_CHAT_TITLE;
  if (trimmed === "История") return "Старые сообщения";
  return trimmed;
}

function canOpenDocumentInline(fileName: string, fileType: string) {
  const lowerName = fileName.toLowerCase();
  const lowerType = fileType.toLowerCase();
  return (
    lowerName.endsWith(".pdf") ||
    lowerType === "application/pdf" ||
    lowerName.endsWith(".txt") ||
    lowerName.endsWith(".md") ||
    lowerType.startsWith("text/")
  );
}

function buildDocumentDownloadUrl(documentId: string | number, inline: boolean) {
  const suffix = inline ? "?inline=1" : "";
  return `/api/documents/${documentId}/download${suffix}`;
}

async function downloadDocumentViaBlob(
  url: string,
  fileName: string,
  inline: boolean,
  fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch
) {
  const response = await fetchFn(url);
  if (!response.ok) {
    throw new Error("Download failed");
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  if (inline) {
    window.location.assign(blobUrl);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    return;
  }

  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = sanitizeDownloadFileName(fileName);
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

function mergeLoadedChatMessages(
  previous: ChatMessage[],
  loaded: Array<{
    role: "user" | "assistant";
    content: string;
    attachments?: Array<Record<string, unknown>>;
    imageUrl?: string | null;
    metadata?: Record<string, unknown>;
  }>
): ChatMessage[] {
  return loaded.map((message, index) => {
    let attachments = (message.attachments ?? []).map((attachment) =>
      normalizeClientAttachment(attachment)
    );

    if (attachments.length === 0 && message.role === "user") {
      const previousMatch = [...previous]
        .reverse()
        .find(
          (item) =>
            item.role === "user" &&
            item.content === message.content &&
            (item.attachments?.length ?? 0) > 0
        );
      if (previousMatch?.attachments?.length) {
        attachments = previousMatch.attachments.map((attachment) =>
          normalizeClientAttachment(attachment as unknown as Record<string, unknown>)
        );
      }
    }

    attachments = attachments.map((attachment) => {
      if (resolveAttachmentPreviewUrl(attachment)) return attachment;

      const previousMessage = previous[index];
      const previousAttachment = previousMessage?.attachments?.find(
        (item) =>
          (item.id != null && item.id === attachment.id) ||
          item.fileName === attachment.fileName
      );
      if (!previousAttachment?.previewUrl) return attachment;

      return {
        ...attachment,
        previewUrl: previousAttachment.previewUrl,
        fullUrl: attachment.fullUrl ?? previousAttachment.fullUrl
      };
    });

    return {
      role: message.role,
      content: message.content,
      attachments,
      imageUrl: message.imageUrl ?? undefined,
      metadata: message.metadata ?? undefined,
      replyTo: readReplyFromMetadata(message.metadata)
    };
  });
}

function MessageAttachments({
  attachments,
  accessToken,
  authFetch,
  onOpen,
  onDownload
}: {
  attachments: FileAttachment[];
  accessToken?: string | null;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  onOpen: (attachment: FileAttachment) => void;
  onDownload: (attachment: FileAttachment) => void;
}) {
  return (
    <div className="message-attachments">
      {attachments.map((attachment) => {
        const previewUrl = resolveAttachmentPreviewUrl(attachment);
        const canDownload = resolveAttachmentDownloadSources(attachment).length > 0;

        return previewUrl ? (
          <div
            className="message-attachment-row"
            key={`${attachment.id ?? attachment.fileName}-${accessToken ?? "anon"}`}
          >
            <button
              className="message-image-attachment"
              onClick={() => onOpen(attachment)}
              type="button"
            >
              <AuthenticatedImage
                alt={attachment.fileName}
                authFetch={authFetch}
                className="message-image-attachment-img"
                fallback={
                  <div className="message-image-attachment-fallback">
                    <ImageIcon size={22} />
                  </div>
                }
                src={previewUrl}
              />
              <span>{attachment.fileName}</span>
            </button>
            {canDownload ? (
              <button
                aria-label={`Скачать ${attachment.fileName}`}
                className="message-attachment-download"
                onClick={(event) => {
                  event.stopPropagation();
                  onDownload(attachment);
                }}
                title="Скачать"
                type="button"
              >
                <Download size={16} />
              </button>
            ) : null}
          </div>
        ) : (
          <div className="message-attachment-row" key={attachment.id ?? attachment.fileName}>
            <button
              className="message-file-attachment"
              onClick={() => onOpen(attachment)}
              title="Открыть файл"
              type="button"
            >
              <div className="message-file-icon">{iconForAttachment(attachment)}</div>
              <div className="message-file-meta">
                <strong>{spreadsheetDisplayName(attachment)}</strong>
                <span>{attachmentDetails(attachment)}</span>
              </div>
            </button>
            {canDownload ? (
              <button
                aria-label={`Скачать ${attachment.fileName}`}
                className="message-attachment-download"
                onClick={(event) => {
                  event.stopPropagation();
                  onDownload(attachment);
                }}
                title="Скачать"
                type="button"
              >
                <Download size={16} />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function UploadAttachmentCard({
  attachment,
  onRemove,
  authFetch
}: {
  attachment: FileAttachment;
  onRemove: () => void;
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  const previewUrl = resolveAttachmentPreviewUrl(attachment);

  return (
    <div className={`attachment-card ${attachment.status ?? "ready"} ${previewUrl ? "has-image-preview" : ""}`}>
      {previewUrl ? (
        <div className="attachment-image-preview">
          <AuthenticatedImage alt="" authFetch={authFetch} src={previewUrl} />
        </div>
      ) : (
        <div className="attachment-file-icon">{iconForAttachment(attachment)}</div>
      )}
      <div className="attachment-meta">
        <div className="attachment-name">{spreadsheetDisplayName(attachment)}</div>
        <div className="attachment-status">
          {statusText(attachment)}
          {attachment.status === "ready" && isSpreadsheet(attachment)
            ? ` · ${attachmentDetails(attachment)}`
            : attachment.status !== "uploading"
              ? ` · ${formatFileSize(attachment.fileSize)}`
              : ""}
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
  if (isImageAttachment(attachment)) return <ImageIcon size={18} />;
  if (isSpreadsheet(attachment)) return <FileSpreadsheet size={18} />;
  return <FileText size={18} />;
}

function statusText(attachment: FileAttachment) {
  if (attachment.status === "uploading") return "Загрузка...";
  if (attachment.status === "ready") return "Файл загружен";
  return attachment.error ?? "Ошибка загрузки";
}

function spreadsheetDisplayName(attachment: FileAttachment) {
  return isSpreadsheet(attachment) ? `📊 ${attachment.fileName}` : attachment.fileName;
}

function attachmentDetails(attachment: FileAttachment) {
  const metadata = attachment.metadata ?? {};
  const parts: string[] = [];

  if (isSpreadsheet(attachment)) {
    if (typeof metadata.sheet_count === "number") parts.push(`${metadata.sheet_count} лист.`);
    if (typeof metadata.row_count === "number") parts.push(`${metadata.row_count} строк`);
    if (parts.length === 0) parts.push(formatFileSize(attachment.fileSize));
    return parts.join(" · ");
  }

  parts.push(formatFileSize(attachment.fileSize));

  if (attachment.fileType === "application/pdf" && typeof metadata.page_count === "number") {
    parts.push(`${metadata.page_count} стр.`);
  }

  return parts.join(" · ");
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} Б`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
  return `${(size / 1024 / 1024).toFixed(1)} МБ`;
}

function isSpreadsheet(attachment: FileAttachment) {
  const metadata = attachment.metadata ?? {};
  return (
    metadata.kind === "spreadsheet" ||
    metadata.file_type === "csv" ||
    attachment.fileType.includes("spreadsheet") ||
    attachment.fileType.includes("excel") ||
    attachment.fileType === "text/csv" ||
    attachment.fileType === "application/csv" ||
    attachment.fileName.toLowerCase().endsWith(".xlsx") ||
    attachment.fileName.toLowerCase().endsWith(".xls") ||
    attachment.fileName.toLowerCase().endsWith(".csv")
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
  if (/Could not upload file to storage|Bucket not found|fetch failed|Failed to fetch|network/i.test(message)) {
    return "Не удалось загрузить файл в облако. Попробуйте ещё раз или выберите файл поменьше.";
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
