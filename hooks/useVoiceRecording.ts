"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearAllPendingVoiceRecordings,
  clearPendingVoiceRecording,
  getLatestPendingVoiceRecording,
  savePendingVoiceRecording,
  type PendingVoiceRecording
} from "@/lib/voice-recording-storage";
import { logClientEvent } from "@/lib/client-log";
import {
  MAX_AUDIO_BYTES,
  formatAudioSize,
  formatRecordingDuration,
  getRecordingPartsSize,
  getRecordingSizeStatus,
  pickRecordingMimeType,
  recordingSizeApproachingMessage,
  recordingSizeCriticalMessage,
  recordingSizeLimitMessage,
  recordingStoppedAtSizeLimitMessage,
  type RecordingSizeStatus
} from "@/lib/voice-recording";

type UseVoiceRecordingOptions = {
  disabled?: boolean;
  authFetch?: typeof fetch;
  getConversationId?: () => string | number | null | undefined;
  onNote: (message: string) => void;
  onTranscript?: (text: string) => void;
  onTranscriptReady?: (text: string) => void;
};

export function useVoiceRecording({
  disabled = false,
  authFetch = fetch,
  getConversationId,
  onNote,
  onTranscript,
  onTranscriptReady
}: UseVoiceRecordingOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingSizeBytes, setRecordingSizeBytes] = useState(0);
  const [recordingSizeStatus, setRecordingSizeStatus] = useState<RecordingSizeStatus>("ok");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [pendingRecording, setPendingRecording] = useState<PendingVoiceRecording | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordingActionRef = useRef<"send" | "cancel">("send");
  const recordingStartedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const transcribeRequestRef = useRef(0);
  const sizeWarnShownNearRef = useRef(false);
  const sizeWarnShownCriticalRef = useRef(false);
  const sizeLimitStopTriggeredRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetRecordingSizeTracking = useCallback(() => {
    setRecordingSizeBytes(0);
    setRecordingSizeStatus("ok");
    sizeWarnShownNearRef.current = false;
    sizeWarnShownCriticalRef.current = false;
    sizeLimitStopTriggeredRef.current = false;
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const updateRecordingSize = useCallback(
    (bytes: number) => {
      const status = getRecordingSizeStatus(bytes);
      setRecordingSizeBytes(bytes);
      setRecordingSizeStatus(status);

      if (status === "near" && !sizeWarnShownNearRef.current) {
        sizeWarnShownNearRef.current = true;
        onNote(recordingSizeApproachingMessage(bytes));
      }

      if (status === "critical" && !sizeWarnShownCriticalRef.current) {
        sizeWarnShownCriticalRef.current = true;
        onNote(recordingSizeCriticalMessage(bytes));
      }

      if (status === "over" && !sizeLimitStopTriggeredRef.current) {
        sizeLimitStopTriggeredRef.current = true;
        recordingActionRef.current = "send";
        onNote(recordingStoppedAtSizeLimitMessage(bytes));
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== "inactive") {
          recorder.stop();
        }
      }
    },
    [onNote]
  );

  const transcribeRecording = useCallback(
    async (recording: PendingVoiceRecording) => {
      if (recording.sizeBytes > MAX_AUDIO_BYTES) {
        const message = recordingSizeLimitMessage(recording.sizeBytes);
        setTranscriptionError(message);
        onNote(message);
        return;
      }

      const requestId = ++transcribeRequestRef.current;
      setIsTranscribing(true);
      setTranscriptionError(null);
      onNote("Распознавание речи...");

      try {
        const formData = new FormData();
        formData.append("audio", recording.blob, recording.fileName);

        const response = await authFetch("/api/transcribe", {
          method: "POST",
          body: formData
        });

        let data: { text?: string; error?: string };
        try {
          data = (await response.json()) as { text?: string; error?: string };
        } catch {
          throw new Error("Сервер вернул некорректный ответ.");
        }

        if (requestId !== transcribeRequestRef.current) return;

        if (!response.ok) {
          throw new Error(data.error ?? "Не удалось распознать аудио");
        }

        if (!data.text?.trim()) {
          throw new Error("Пустой результат распознавания");
        }

        await clearPendingVoiceRecording(recording.id);
        setPendingRecording(null);
        setTranscriptionError(null);
        const transcript = data.text.trim();
        logClientEvent("VOICE_TRANSCRIBE_SUCCESS", {
          conversationId: getConversationId?.() ?? null,
          recordingId: recording.id,
          textLength: transcript.length
        });
        onTranscript?.(transcript);
        onTranscriptReady?.(transcript);
      } catch (error) {
        if (requestId !== transcribeRequestRef.current) return;

        const message =
          error instanceof Error ? error.message : "Ошибка распознавания";
        setTranscriptionError(message);
        onNote(`Ошибка распознавания: ${message}`);
      } finally {
        if (requestId === transcribeRequestRef.current) {
          setIsTranscribing(false);
        }
      }
    },
    [authFetch, getConversationId, onNote, onTranscript, onTranscriptReady]
  );

  const persistAndTranscribe = useCallback(
    async (blob: Blob, mimeType: string, durationMs: number) => {
      const recording = await savePendingVoiceRecording({
        blob,
        mimeType,
        durationMs
      });
      setPendingRecording(recording);

      if (recording.sizeBytes > MAX_AUDIO_BYTES) {
        const message = recordingSizeLimitMessage(recording.sizeBytes);
        setTranscriptionError(message);
        setIsTranscribing(false);
        onNote(message);
        return;
      }

      await transcribeRecording(recording);
    },
    [onNote, transcribeRecording]
  );

  const finalizeRecording = useCallback(async () => {
    setIsTranscribing(true);
    const recorder = recorderRef.current;
    const mimeType = recorder?.mimeType || "audio/webm";
    const durationMs = Math.max(0, Date.now() - recordingStartedAtRef.current);
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];

    if (blob.size === 0) {
      setIsTranscribing(false);
      onNote("Пустая запись — попробуйте ещё раз");
      return;
    }

    try {
      await persistAndTranscribe(blob, mimeType, durationMs);
    } catch {
      setIsTranscribing(false);
    }
  }, [onNote, persistAndTranscribe]);

  const stopRecording = useCallback((action: "send" | "cancel") => {
    recordingActionRef.current = action;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (disabled || isRecording || isTranscribing) return;

    if (!window.isSecureContext) {
      onNote(
        "Микрофон с iPhone по HTTP (192.168…) недоступен. Используйте HTTPS или tbrain.vercel.app."
      );
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      onNote("Браузер не поддерживает запись голоса.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType = pickRecordingMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      recordingActionRef.current = "send";
      recordingStartedAtRef.current = Date.now();
      resetRecordingSizeTracking();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          updateRecordingSize(getRecordingPartsSize(chunksRef.current));
        }
      };

      recorder.onstop = () => {
        clearTimers();
        stopStream();
        recorderRef.current = null;
        setIsRecording(false);
        setRecordingSeconds(0);
        resetRecordingSizeTracking();

        if (recordingActionRef.current === "cancel") {
          chunksRef.current = [];
          onNote("Запись отменена");
          return;
        }

        void finalizeRecording();
      };

      recorder.onerror = () => {
        onNote("Ошибка записи. Попробуйте ещё раз.");
        stopRecording("cancel");
      };

      recorderRef.current = recorder;
      recorder.start(1000);
      setIsRecording(true);
      setRecordingSeconds(0);
      onNote("Идёт запись — нажмите Send, когда закончите");

      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((current) => current + 1);
        updateRecordingSize(getRecordingPartsSize(chunksRef.current));
      }, 1000);
    } catch (error) {
      stopStream();
      onNote(
        error instanceof Error
          ? `Микрофон: ${error.message}`
          : "Браузер не дал доступ к микрофону"
      );
    }
  }, [
    clearTimers,
    disabled,
    finalizeRecording,
    isRecording,
    isTranscribing,
    onNote,
    resetRecordingSizeTracking,
    stopRecording,
    stopStream,
    updateRecordingSize
  ]);

  const retryTranscription = useCallback(async () => {
    if (!pendingRecording || isTranscribing) return;
    await transcribeRecording(pendingRecording);
  }, [isTranscribing, pendingRecording, transcribeRecording]);

  const deletePendingRecording = useCallback(async () => {
    transcribeRequestRef.current += 1;
    setIsTranscribing(false);
    setTranscriptionError(null);

    if (pendingRecording) {
      await clearPendingVoiceRecording(pendingRecording.id);
    } else {
      await clearAllPendingVoiceRecordings();
    }

    setPendingRecording(null);
    onNote("Голосовая запись удалена");
  }, [onNote, pendingRecording]);

  useEffect(() => {
    void getLatestPendingVoiceRecording().then((recording) => {
      if (recording) {
        setPendingRecording(recording);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
      if (recorderRef.current?.state === "recording") {
        recorderRef.current.stop();
      }
      stopStream();
    };
  }, [clearTimers, stopStream]);

  return {
    isRecording,
    recordingSeconds,
    recordingDurationLabel: formatRecordingDuration(recordingSeconds),
    recordingSizeBytes,
    recordingSizeLabel: formatAudioSize(recordingSizeBytes),
    recordingSizeStatus,
    isTranscribing,
    pendingRecording,
    transcriptionError,
    hasPendingRecording: pendingRecording != null,
    startRecording,
    stopRecording,
    retryTranscription,
    deletePendingRecording
  };
}
