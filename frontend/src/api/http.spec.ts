import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import axios from 'axios';

vi.mock('element-plus', () => ({
  ElMessage: { error: vi.fn() },
}));

import { ElMessage } from 'element-plus';
import { api, apiBlob, http, setAccessToken } from './http';

const originalLocation = window.location;

/** 构造一个 axios 风格的 401 响应，交给响应拦截器处理 */
function reject401(config: InternalAxiosRequestConfig): Promise<never> {
  const response = {
    data: { success: false, error: { code: 'AUTH_INVALID_CREDENTIALS', message: '登录已失效' } },
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
  } as unknown as AxiosResponse;
  return Promise.reject({
    isAxiosError: true,
    message: 'Request failed with status code 401',
    config,
    response,
  });
}

function ok(config: InternalAxiosRequestConfig, data: unknown, headers: Record<string, string> = {}): Promise<AxiosResponse> {
  return Promise.resolve({
    data: { success: true, data },
    status: 200,
    statusText: 'OK',
    headers,
    config,
  } as unknown as AxiosResponse);
}

/** 二进制下载不使用 { success, data } 信封，直接返回原始字节 */
function raw(config: InternalAxiosRequestConfig, data: unknown, headers: Record<string, string> = {}): Promise<AxiosResponse> {
  return Promise.resolve({
    data,
    status: 200,
    statusText: 'OK',
    headers,
    config,
  } as unknown as AxiosResponse);
}

function setAdapter(fn: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse>): void {
  http.defaults.adapter = fn as never;
}

function authHeader(config: InternalAxiosRequestConfig): string {
  const headers = config.headers as unknown as Record<string, string>;
  return String(headers?.Authorization ?? '');
}

describe('响应拦截器：401 自动刷新', () => {
  beforeEach(() => {
    // 固定为登录页路径，避免 jsdom 真实跳转
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { pathname: '/login', search: '', href: '' },
    });
    setAccessToken('');
  });

  afterAll(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it('并发多个 401 只触发一次刷新（单飞），重放后全部成功', async () => {
    const refreshSpy = vi
      .spyOn(axios, 'post')
      .mockResolvedValue({ data: { success: true, data: { accessToken: 'fresh' } } } as never);

    let adapterCalls = 0;
    setAdapter((config) => {
      adapterCalls += 1;
      if (authHeader(config) === 'Bearer fresh') {
        return ok(config, { url: config.url });
      }
      return reject401(config);
    });

    const results = await Promise.all([
      api<{ url: string }>({ url: '/records/a' }),
      api<{ url: string }>({ url: '/records/b' }),
      api<{ url: string }>({ url: '/records/c' }),
    ]);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledWith('/api/v1/auth/refresh', {}, { withCredentials: true });
    expect(results.map((r) => r.url)).toEqual(['/records/a', '/records/b', '/records/c']);
    // 3 次首次请求 + 3 次带新令牌的重放
    expect(adapterCalls).toBe(6);
  });

  it('刷新失败时请求被拒绝，只尝试一次刷新并跳转登录页', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { pathname: '/projects', search: '?page=2', href: '' },
    });
    const refreshSpy = vi.spyOn(axios, 'post').mockRejectedValue(new Error('refresh failed'));
    let adapterCalls = 0;
    setAdapter((config) => {
      adapterCalls += 1;
      return reject401(config);
    });

    await expect(api({ url: '/records/a' })).rejects.toBeTruthy();

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    // 没有重放请求，说明不会陷入「401 → 刷新 → 再 401」的死循环
    expect(adapterCalls).toBe(1);
    expect(window.location.href).toBe('/login?redirect=%2Fprojects%3Fpage%3D2');
  });

  it('登录接口的 401 不触发刷新也不弹全局提示（由登录页自行提示）', async () => {
    const refreshSpy = vi.spyOn(axios, 'post');
    setAdapter((config) => reject401(config));

    await expect(api({ url: '/auth/login', method: 'post' })).rejects.toBeTruthy();

    expect(refreshSpy).not.toHaveBeenCalled();
    expect(ElMessage.error).not.toHaveBeenCalled();
  });
});

describe('响应拦截器：成功响应解包', () => {
  it('自动剥离 { success, data } 信封', async () => {
    setAdapter((config) => ok(config, { id: 'r1', name: '记录' }));
    await expect(api<{ id: string }>({ url: '/records/r1' })).resolves.toEqual({ id: 'r1', name: '记录' });
  });

  it('二进制导出保留完整响应，并解析 UTF-8 文件名', async () => {
    setAdapter((config) =>
      raw(config, new Blob(['xlsx']), {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': "attachment; filename*=UTF-8''%E5%AF%BC%E5%87%BA-%E8%AE%B0%E5%BD%95.xlsx",
      }),
    );

    const { blob, filename } = await apiBlob({ url: '/export/t1' });

    expect(blob).toBeInstanceOf(Blob);
    expect(filename).toBe('导出-记录.xlsx');
  });

  it('无 filename* 时回退到普通 filename', async () => {
    setAdapter((config) =>
      raw(config, new Blob(['xlsx']), {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': 'attachment; filename="records.xlsx"',
      }),
    );

    await expect(apiBlob({ url: '/export/t1' })).resolves.toMatchObject({ filename: 'records.xlsx' });
  });
});
