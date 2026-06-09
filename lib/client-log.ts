type ClientLogPayload = Record<string, unknown>;

export function logClientEvent(event: string, payload: ClientLogPayload = {}) {
  console.info(`[${event}]`, payload);
}
