import { AsyncLocalStorage } from "async_hooks";
import "server-only";

type RequestContext = {
  userId: string;
  email?: string | null;
};

const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestUserId() {
  return requestContext.getStore()?.userId;
}

export function getRequestUserEmail() {
  return requestContext.getStore()?.email ?? null;
}

export function runWithRequestUser<T>(
  userId: string,
  fn: () => T | Promise<T>,
  email?: string | null
): Promise<T> {
  return new Promise((resolve, reject) => {
    requestContext.run({ userId, email }, () => {
      Promise.resolve(fn()).then(resolve).catch(reject);
    });
  });
}
