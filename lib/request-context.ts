import { AsyncLocalStorage } from "async_hooks";
import "server-only";

type RequestContext = {
  userId: string;
};

const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestUserId() {
  return requestContext.getStore()?.userId;
}

export function runWithRequestUser<T>(userId: string, fn: () => T): T {
  return requestContext.run({ userId }, fn);
}
