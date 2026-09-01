import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string; details?: unknown };
}

let accessToken = '';
let refreshing: Promise<string | null> | null = null;

export function setAccessToken(token: string): void {
  accessToken = token;
}

export function clearAccessToken(): void {
  accessToken = '';
}

const http = axios.create({
  baseURL: '/api/v1',
  timeout: 60_000,
  withCredentials: true,
});

http.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

/** 刷新 Access Token（Refresh Token 在 httpOnly Cookie 中） */
async function tryRefresh(): Promise<string | null> {
  if (refreshing) {
    return refreshing;
  }
  refreshing = (async () => {
    try {
      const res = await axios.post<ApiEnvelope<{ accessToken: string }>>(
        '/api/v1/auth/refresh',
        {},
        { withCredentials: true },
      );
      if (res.data.success && res.data.data.accessToken) {
        setAccessToken(res.data.data.accessToken);
        return res.data.data.accessToken;
      }
      return null;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

let redirecting = false;

function redirectToLogin(): void {
  if (redirecting) {
    return;
  }
  redirecting = true;
  clearAccessToken();
  const current = window.location.pathname + window.location.search;
  if (!window.location.pathname.startsWith('/login')) {
    window.location.href = `/login?redirect=${encodeURIComponent(current)}`;
  } else {
    redirecting = false;
  }
}

http.interceptors.response.use(
  (response) => {
    // 文件流（xlsx）直接返回
    const contentType = String(response.headers['content-type'] ?? '');
    if (contentType.includes('spreadsheetml') || response.config.responseType === 'blob') {
      return response;
    }
    const body = response.data as ApiEnvelope<unknown>;
    if (body && typeof body === 'object' && 'success' in body) {
      return body.data as never;
    }
    return response.data as never;
  },
  async (error: AxiosError<ApiEnvelope<unknown>>) => {
    const config = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const status = error.response?.status;
    const url = config?.url ?? '';

    // 401 → 尝试刷新一次后重放
    if (
      status === 401 &&
      config &&
      !config._retried &&
      !url.includes('/auth/login') &&
      !url.includes('/auth/refresh')
    ) {
      config._retried = true;
      const token = await tryRefresh();
      if (token) {
        config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
        return http.request(config);
      }
      redirectToLogin();
      return Promise.reject(error);
    }

    if (status === 401 && !config?._retried && !url.includes('/auth/login')) {
      redirectToLogin();
    }

    const message = error.response?.data?.error?.message ?? error.message ?? '请求失败';
    if (!url.includes('/auth/login')) {
      ElMessage.error(message);
    }
    return Promise.reject(error);
  },
);

/** 统一请求：响应拦截器已解包 { success, data }，这里直接返回 data */
export async function api<T>(config: AxiosRequestConfig): Promise<T> {
  const result = await http.request(config);
  return result as unknown as T;
}

/** 导出类请求（二进制），返回 Blob 与文件名（来自 Content-Disposition） */
export async function apiBlob(config: AxiosRequestConfig): Promise<{ blob: Blob; filename: string }> {
  const result = await http.request({ ...config, responseType: 'blob' });
  const response = result as unknown as { data: Blob; headers: Record<string, string> };
  let filename = 'export.xlsx';
  const disposition = response.headers?.['content-disposition'] ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (match?.[1]) {
    filename = decodeURIComponent(match[1]);
  } else {
    const plain = /filename="?([^";]+)"?/i.exec(disposition);
    if (plain?.[1]) {
      filename = plain[1];
    }
  }
  return { blob: response.data, filename };
}

export { http };
