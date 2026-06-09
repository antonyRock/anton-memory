export type RequestProfileTimings = {
  memoryRetrievalMs: number;
  openAiRequestMs: number;
  databaseWriteMs: number;
  totalMs: number;
};

export type RequestProfileContext = {
  conversationId?: string | number | null;
  route?: string;
};

export function createRequestProfiler() {
  const startedAt = performance.now();
  const timings: RequestProfileTimings = {
    memoryRetrievalMs: 0,
    openAiRequestMs: 0,
    databaseWriteMs: 0,
    totalMs: 0
  };

  async function measure<T>(
    key: Exclude<keyof RequestProfileTimings, "totalMs">,
    fn: () => Promise<T>
  ): Promise<T> {
    const phaseStartedAt = performance.now();
    try {
      return await fn();
    } finally {
      timings[key] += performance.now() - phaseStartedAt;
    }
  }

  function finish(context: RequestProfileContext = {}): RequestProfileTimings {
    timings.totalMs = performance.now() - startedAt;
    logRequestProfile(timings, context);
    return { ...timings };
  }

  return { measure, finish, timings };
}

export function logRequestProfile(
  timings: RequestProfileTimings,
  context: RequestProfileContext = {}
) {
  const route = context.route ?? "chat";
  const conversation =
    context.conversationId != null && context.conversationId !== ""
      ? String(context.conversationId)
      : "unknown";

  console.log(
    [
      `[tBrain profile] route=${route} conversation=${conversation}`,
      `  Memory retrieval: ${formatMs(timings.memoryRetrievalMs)}`,
      `  OpenAI request: ${formatMs(timings.openAiRequestMs)}`,
      `  Database write: ${formatMs(timings.databaseWriteMs)}`,
      `  Total request: ${formatMs(timings.totalMs)}`
    ].join("\n")
  );
}

export function logBackgroundMemoryExtractionStarted(
  context: RequestProfileContext = {}
) {
  console.log(
    `[tBrain background] memory extraction started conversation=${formatConversationId(context.conversationId)}`
  );
}

export function logBackgroundMemoryExtractionFinished(
  durationMs: number,
  context: RequestProfileContext = {}
) {
  console.log(
    `[tBrain background] memory extraction finished: ${formatMs(durationMs)} conversation=${formatConversationId(context.conversationId)}`
  );
}

export function logBackgroundMemoryExtractionFailed(
  error: unknown,
  context: RequestProfileContext = {}
) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(
    `[tBrain background] memory extraction failed: ${message} conversation=${formatConversationId(context.conversationId)}`
  );
}

function formatConversationId(conversationId?: string | number | null) {
  return conversationId != null && conversationId !== ""
    ? String(conversationId)
    : "unknown";
}

function formatMs(value: number) {
  return `${Math.round(value)} ms`;
}
