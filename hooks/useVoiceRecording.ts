"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearAllPendingVoiceRecordings,
  clearPendingVoiceRecording,
  getLatestPendingVoiceRecording,
  savePendingVoiceRecording,
  type PendingVoiceRecording
} from "@/lib/voice-recording-storage";
import {
  MAX_AUDIO_BYTES,
  MAX_RECORDING_MS,
  formatAudioSize,
  formatRecordingDuration,
  pickRecordingMimeType
} from "@/lib/voice-recording";

type UseVoiceRecordingOptions = {
  disabled?: boolean;
  onNote: (message: string) => void;
  onTranscript: (text: string) => void;
  onTranscriptReady?: () => void;
};

export function useVoiceRecording({
  disabled = false,
  onNote,
  onTranscript,
  onTranscriptReady
}: UseVoiceRecordingOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [pendingRecording, setPendingRecording] = useState<PendingVoiceRecording | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordingActionRef = useRef<"send" | "cancel">("send");
  const recordingStartedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const maxDurationTimerRef = useRef<number | null>(null);
  const transcribeRequestRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (maxDurationTimerRef.current != null) {
      window.clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const transcribeRecording = useCallback(
    async (recording: PendingVoiceRecording) => {
      if (recording.sizeBytes > MAX_AUDIO_BYTES) {
        const message = `Запись слишком большая (${formatAudioSize(recording.sizeBytes)}). Максимум ${formatAudioSize(MAX_AUDIO_BYTES)}. Сократите запись или разделите её на части.`;
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

        const response = await fetch("/api/transcribe", {
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
        onTranscript(data.text.trim());
        onTranscriptReady?.();
        onNote("Текст распознан — проверьте и отправьте");
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
    [onNote, onTranscript, onTranscriptReady]
  );

  const persistAndTranscribe = useCallback(
    async (blob: Blob, mimeType: string, durationMs: number) => {
      const recording = await savePendingVoiceRecording({
        blob,
        mimeType,
        durationMs
      });
      setPendingRecording(recording);
      await transcribeRecording(recording);
    },
    [transcribeRecording]
  );

  const finalizeRecording = useCallback(async () => {
    const recorder = recorderRef.current;
    const mimeType = recorder?.mimeType || "audio/webm";
    const durationMs = Math.max(0, Date.now() - recordingStartedAtRef.current);
    const blob = new Blob(chunksRef.current, { type: mimeType });
    chunksRef.current = [];

    if (blob.size === 0) {
      onNote("Пустая запись — попробуйте ещё раз");
      return;
    }

    await persistAndTranscribe(blob, mimeType, durationMs);
  }, [onNote, persistAndTranscribe]);

  const stopRecording = useCallback(
    (action: "send" | "cancel") => {
      recordingActionRef.current = action;
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
    },
    []
  );

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

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        clearTimers();
        stopStream();
        recorderRef.current = null;
        setIsRecording(false);
        setRecordingSeconds(0);

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
      }, 1000);

      maxDurationTimerRef.current = window.setTimeout(() => {
        onNote("Достигнут лимит 3 минуты — запись остановлена");
        stopRecording("send");
      }, MAX_RECORDING_MS);
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
    stopRecording,
    stopStream
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
