export function createRuntimeId() {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();

  const randomPart = Math.random().toString(36).slice(2, 10);
  return `id_${Date.now().toString(36)}_${randomPart}`;
}
