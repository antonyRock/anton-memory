"use client";

import { Mic, RotateCcw, Trash2 } from "lucide-react";
import {
  formatAudioSize,
  formatRecordingDuration
} from "@/lib/voice-recording";
import type { PendingVoiceRecording } from "@/lib/voice-recording-storage";

type VoiceRecordingPanelProps = {
  isRecording: boolean;
  recordingDurationLabel: string;
  isTranscribing: boolean;
  pendingRecording: PendingVoiceRecording | null;
  transcriptionError: string | null;
  onRetry: () => void;
  onDelete: () => void;
};

export function VoiceRecordingPanel({
  isRecording,
  recordingDurationLabel,
  isTranscribing,
  pendingRecording,
  transcriptionError,
  onRetry,
  onDelete
}: VoiceRecordingPanelProps) {
  if (isRecording) {
    return (
      <div aria-live="polite" className="recording-pill">
        <span className="recording-dot" />
        <span className="recording-label">Запись</span>
        <span className="recording-timer">{recordingDurationLabel}</span>
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
          disabled={isTranscribing}
          onClick={onRetry}
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
