import { getOpenAI, transcriptCleanupModel } from "@/lib/openai";
import { CLEANUP_SYSTEM_PROMPT } from "@/lib/transcript-prompt";

export type TranscriptStatus = "raw" | "cleaned" | "cleanup_failed";

export type TranscriptCleanupResult = {
  cleanedTranscript: string | null;
  appliedCorrections: string[];
  transcriptStatus: Exclude<TranscriptStatus, "raw">;
};

type CleanupJsonResponse = {
  text?: string;
  appliedCorrections?: unknown;
};

function normalizeCorrections(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function parseCleanupResponse(raw: string, fallback: string): TranscriptCleanupResult {
  try {
    const parsed = JSON.parse(raw) as CleanupJsonResponse;
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (!text) {
      return {
        cleanedTranscript: null,
        appliedCorrections: [],
        transcriptStatus: "cleanup_failed"
      };
    }

    return {
      cleanedTranscript: text,
      appliedCorrections: normalizeCorrections(parsed.appliedCorrections),
      transcriptStatus: "cleaned"
    };
  } catch {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === fallback) {
      return {
        cleanedTranscript: trimmed || null,
        appliedCorrections: [],
        transcriptStatus: trimmed ? "cleaned" : "cleanup_failed"
      };
    }

    return {
      cleanedTranscript: trimmed,
      appliedCorrections: [],
      transcriptStatus: "cleaned"
    };
  }
}

export function logTranscriptQuality(payload: {
  rawTranscript: string;
  cleanedTranscript: string | null;
  appliedCorrections: string[];
  transcriptStatus: TranscriptStatus;
  model?: string;
}) {
  console.info(
    "[TRANSCRIPT_QUALITY]",
    JSON.stringify(
      {
        transcriptStatus: payload.transcriptStatus,
        model: payload.model ?? null,
        rawTranscript: payload.rawTranscript,
        cleanedTranscript: payload.cleanedTranscript,
        appliedCorrections: payload.appliedCorrections
      },
      null,
      2
    )
  );
}

export async function cleanupTranscript(rawTranscript: string): Promise<TranscriptCleanupResult> {
  const trimmed = rawTranscript.trim();
  if (!trimmed) {
    return { cleanedTranscript: null, appliedCorrections: [], transcriptStatus: "cleanup_failed" };
  }

  try {
    const result = await getOpenAI().chat.completions.create({
      model: transcriptCleanupModel,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CLEANUP_SYSTEM_PROMPT },
        { role: "user", content: trimmed }
      ]
    });

    const content = result.choices[0]?.message.content?.trim();
    if (!content) {
      return { cleanedTranscript: null, appliedCorrections: [], transcriptStatus: "cleanup_failed" };
    }

    const parsed = parseCleanupResponse(content, trimmed);
    return parsed;
  } catch (error) {
    console.error("Transcript cleanup failed:", error);
    return { cleanedTranscript: null, appliedCorrections: [], transcriptStatus: "cleanup_failed" };
  }
}
