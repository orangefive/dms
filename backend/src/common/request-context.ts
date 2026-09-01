import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * 基于 AsyncLocalStorage 的请求上下文，供审计日志等服务获取 IP / UA。
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContextData>();

export function getRequestContext(): RequestContextData {
  return requestContextStorage.getStore() ?? {};
}
