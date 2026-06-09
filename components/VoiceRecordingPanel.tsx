"use client";

import { Mic, RotateCcw, Trash2 } from "lucide-react";
import {
  formatAudioSize,
  formatRecordingDuration,
  isAudioTooLarge
} from "@/lib/voice-recording";
import type { PendingVoiceRecording } from "@/lib/voice-recording-storage";

type VoiceRecordingPanelProps = {
  isRecording: boolean;
  recordingDurationLabel: string;
  recordingSizeLabel: string;
  recordingSizeStatus: "ok" | "near" | "critical" | "over";
  isTranscribing: boolean;
  pendingRecording: PendingVoiceRecording | null;
  transcriptionError: string | null;
  onRetry: () => void;
  onDelete: () => void;
};

export function VoiceRecordingPanel({
  isRecording,
  recordingDurationLabel,
  recordingSizeLabel,
  recordingSizeStatus,
  isTranscribing,
  pendingRecording,
  transcriptionError,
  onRetry,
  onDelete
}: VoiceRecordingPanelProps) {
  if (isRecording) {
    return (
      <div
        aria-live="polite"
        className={`recording-pill recording-pill-size-${recordingSizeStatus}`}
      >
        <span className="recording-dot" />
        <span className="recording-label">Запись</span>
        <span className="recording-timer">{recordingDurationLabel}</span>
        <span className="recording-size">{recordingSizeLabel}</span>
        {recordingSizeStatus === "near" ? (
          <span className="recording-size-hint">Близко к лимиту OpenAI</span>
        ) : null}
        {recordingSizeStatus === "critical" ? (
          <span className="recording-size-hint is-critical">Почти лимит — завершите запись</span>
        ) : null}
        <div className="recording-bars" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (!pendingRecording) return null;

  const pendingDurationSeconds = Math.max(1, Math.round(pendingRecording.durationMs / 1000));
  const pendingTooLarge = isAudioTooLarge(pendingRecording.sizeBytes);

  return (
    <div aria-live="polite" className="voice-pending-banner">
      <div className="voice-pending-main">
        <Mic aria-hidden size={16} />
        <div className="voice-pending-copy">
          <strong>
            {isTranscribing
              ? "Распознаём голосовую запись..."
              : "Есть несохранённая голосовая запись"}
          </strong>
          <span>
            {formatRecordingDuration(pendingDurationSeconds)} ·{" "}
            {formatAudioSize(pendingRecording.sizeBytes)}
          </span>
          {transcriptionError ? (
            <span className="voice-pending-error">{transcriptionError}</span>
          ) : null}
        </div>
      </div>
      <div className="voice-pending-actions">
        <button
          className="voice-pending-button"
          disabled={isTranscribing || pendingTooLarge}
          onClick={onRetry}
          title={pendingTooLarge ? "Файл превышает лимит OpenAI (25 МБ)" : undefined}
          type="button"
        >
          <RotateCcw size={14} />
          Повторить
        </button>
        <button
          className="voice-pending-button voice-pending-button-danger"
          disabled={isTranscribing}
          onClick={onDelete}
          type="button"
        >
          <Trash2 size={14} />
          Удалить
        </button>
      </div>
    </div>
  );
}
