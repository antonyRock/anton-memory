import {
  VOICE_RECORDING_DB_NAME,
  VOICE_RECORDING_STORE_NAME,
  buildRecordingFileName
} from "@/lib/voice-recording";
import { createRuntimeId } from "@/lib/id";

export type PendingVoiceRecording = {
  id: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  createdAt: number;
  fileName: string;
  sizeBytes: number;
};

function openVoiceRecordingDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(VOICE_RECORDING_DB_NAME, 1);

    request.onerror = () => {
      reject(request.error ?? new Error("Не удалось открыть локальное хранилище записи"));
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VOICE_RECORDING_STORE_NAME)) {
        db.createObjectStore(VOICE_RECORDING_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
  });
}

function runStoreRequest<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
  return openVoiceRecordingDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(VOICE_RECORDING_STORE_NAME, mode);
        const store = transaction.objectStore(VOICE_RECORDING_STORE_NAME);
        const request = fn(store);

        request.onerror = () => {
          reject(request.error ?? new Error("Ошибка IndexedDB"));
        };

        request.onsuccess = () => resolve(request.result as T);

        transaction.oncomplete = () => db.close();
        transaction.onerror = () => {
          reject(transaction.error ?? new Error("Ошибка транзакции IndexedDB"));
        };
      })
  );
}

export async function savePendingVoiceRecording(input: {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}) {
  await clearAllPendingVoiceRecordings();

  const recording: PendingVoiceRecording = {
    id: createRuntimeId(),
    blob: input.blob,
    mimeType: input.mimeType,
    durationMs: input.durationMs,
    createdAt: Date.now(),
    fileName: buildRecordingFileName(input.mimeType),
    sizeBytes: input.blob.size
  };

  await runStoreRequest("readwrite", (store) => store.put(recording));
  return recording;
}

export async function getLatestPendingVoiceRecording() {
  const recordings = await runStoreRequest<PendingVoiceRecording[]>("readonly", (store) =>
    store.getAll()
  );

  if (!recordings.length) return null;

  return recordings.sort((left, right) => right.createdAt - left.createdAt)[0] ?? null;
}

export async function clearPendingVoiceRecording(id: string) {
  await runStoreRequest("readwrite", (store) => store.delete(id));
}

export async function clearAllPendingVoiceRecordings() {
  await runStoreRequest("readwrite", (store) => store.clear());
}
