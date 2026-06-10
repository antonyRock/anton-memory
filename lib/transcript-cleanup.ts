import { getOpenAI, transcriptCleanupModel } from "@/lib/openai";
import { CLEANUP_SYSTEM_PROMPT } from "@/lib/transcript-prompt";

export type TranscriptStatus = "raw" | "cleaned" | "cleanup_failed";

export type TranscriptCleanupResult = {
  cleanedTranscript: string | null;
  appliedCorrections: string[];
  transcriptStatus: Exclude<TranscriptStatus, "raw">;
};

function parseCleanupResponse(raw: string, fallback: string): TranscriptCleanupResult {
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

export function logTranscriptQuality(payload: {
  rawTranscriptLength: number;
  cleanedTranscriptLength: number | null;
  appliedCorrectionsCount: number;
  transcriptStatus: TranscriptStatus;
  model?: string;
}) {
  console.info(
    "[TRANSCRIPT_QUALITY]",
    JSON.stringify(
      {
        transcriptStatus: payload.transcriptStatus,
        model: payload.model ?? null,
        rawTranscriptLength: payload.rawTranscriptLength,
        cleanedTranscriptLength: payload.cleanedTranscriptLength,
        appliedCorrectionsCount: payload.appliedCorrectionsCount
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
