type ServerLogPayload = Record<string, unknown>;

export function logServerEvent(event: string, payload: ServerLogPayload = {}) {
  console.info(`[${event}]`, payload);
}
