import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';

import { auth } from '@/context/AuthContext';
import { waitForIdentityReady } from '@/services/backendIdentity';

/**
 * Backend base URL. Production builds MUST configure EXPO_PUBLIC_API_URL:
 * silently falling back to a developer-LAN address would send authenticated
 * health traffic to the wrong server, so non-dev builds fail fast instead.
 */
const API_URL = (() => {
  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured) {
    const dev = typeof __DEV__ !== 'undefined' && __DEV__;
    if (!dev && !/^https:\/\//i.test(configured.trim())) {
      throw new Error(
        'EXPO_PUBLIC_API_URL must use https:// in production builds.',
      );
    }
    return configured;
  }
  if (typeof __DEV__ !== 'undefined' && __DEV__) return 'http://10.22.93.11:8000';
  throw new Error(
    'EXPO_PUBLIC_API_URL is not configured. Production builds require the backend URL.',
  );
})();

if (__DEV__) console.log('[MedGraph] API_URL:', API_URL);

// ── Temporary structured logging for upload/poll tracing ──────────────
// Remove after diagnosing the Network Error.
const _reqSeq = { n: 0 };


/**
 * Axios configuration.
 */
const client = axios.create({
  baseURL: API_URL,
  // Generous default: the agent/chat pipeline (multi-step LLM tool calls +
  // structured synthesis) routinely takes longer than 15s. A short timeout
  // aborts the request client-side while the backend keeps running and later
  // returns 200 — which surfaces as a bogus "encountered an error" in the UI.
  timeout: 120000,
});

/**
 * Prevent an infinite retry loop.
 */
type RetryableRequestConfig =
  InternalAxiosRequestConfig & {
    _retry?: boolean;
  };

/**
 * Attach the current Firebase ID token.
 *
 * Firebase Auth is responsible for refreshing the token.
 * We do NOT maintain a separate refresh-token system here.
 */
client.interceptors.request.use(
  async (
    config: InternalAxiosRequestConfig
  ) => {
    const seq = ++_reqSeq.n;
    (config as any).__seq = seq;
    // Dev-only request timing (perfLog gate keeps production untouched).
    (config as any).__t0 = Date.now();
    if (__DEV__) console.log(
      `[HTTP] #${seq} → ${String(config.method ?? '??').toUpperCase()} ${config.baseURL ?? ''}${config.url ?? ''}`,
    );
    try {
      // Wait for backend identity sync to complete (max 3s) before
      // attaching token. This prevents 403 errors when the Patient
      // row hasn't been created yet. The Dashboard UI is not blocked —
      // only this specific request waits.
      await waitForIdentityReady();

      const currentUser = auth.currentUser;

      if (currentUser) {
        const token =
          await currentUser.getIdToken();

        if (token && config.headers) {
          config.headers.Authorization =
            `Bearer ${token}`;
        }
      } else {
        console.warn(`[HTTP] #${seq} ⚠ No Firebase currentUser — sending WITHOUT auth header`);
      }
    } catch (error) {
      console.error(
        `[HTTP] #${seq} ✖ Failed to obtain Firebase ID token:`,
        error
      );
    }

    return config;
  },
  (error) =>
    Promise.reject(error)
);

/**
 * Handle authentication failures.
 *
 * Firebase refreshes its own ID token.
 * We force-refresh once and retry the request once.
 *
 * No backend refresh endpoint is used; Firebase owns token refresh.
 */
client.interceptors.response.use(
  (response) => {
    const seq = (response.config as any).__seq ?? '?';
    const t0 = (response.config as any).__t0 as number | undefined;
    const dur = typeof t0 === 'number' ? ` ms=${Date.now() - t0}` : '';
    if (__DEV__) console.log(
      `[HTTP] #${seq} ← ${response.status} ${String(response.config.method ?? '??').toUpperCase()} ${response.config.url ?? ''}${dur}`,
    );
    return response;
  },

  async (error) => {
    const seq = (error.config as any)?.__seq ?? '?';
    const t0 = (error.config as any)?.__t0 as number | undefined;
    const dur = typeof t0 === 'number' ? ` ms=${Date.now() - t0}` : '';
    // Suppress 404 logging — these are expected for resources that don't exist yet
    // (e.g., daily check-in for a date with no entry)
    const is404 = error.response?.status === 404;
    if (!is404) {
      console.error(
        `[HTTP] #${seq} ✖ ${String(error.config?.method ?? '??').toUpperCase()} ${error.config?.url ?? ''}${dur}`,
        `code=${error.code} message=${error.message}`,
        error.response ? `status=${error.response.status}` : 'NO_RESPONSE',
      );
    }
    const originalRequest =
      error.config as RetryableRequestConfig | undefined;

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry
    ) {
      return Promise.reject(error);
    }

    const currentUser =
      auth.currentUser;

    if (!currentUser) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      /**
       * Force Firebase to refresh the ID token.
       */
      const freshToken =
        await currentUser.getIdToken(true);

      if (originalRequest.headers) {
        originalRequest.headers.Authorization =
          `Bearer ${freshToken}`;
      }

      return client.request(
        originalRequest
      );
    } catch (refreshError) {
      console.error(
        '[MedGraph] Firebase token refresh failed:',
        refreshError
      );

      return Promise.reject(
        refreshError
      );
    }
  }
);

/**
 * API service.
 */
class ApiService {
  async get<T>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response =
      await client.get<T>(
        url,
        config
      );

    return response.data;
  }

  async post<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response =
      await client.post<T>(
        url,
        data,
        config
      );

    return response.data;
  }

  async put<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response =
      await client.put<T>(
        url,
        data,
        config
      );

    return response.data;
  }

  async patch<T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response =
      await client.patch<T>(
        url,
        data,
        config
      );

    return response.data;
  }

  async delete<T>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response =
      await client.delete<T>(
        url,
        config
      );

    return response.data;
  }

  getClient(): AxiosInstance {
    return client;
  }
}

export const api =
  new ApiService();

/** Absolute API base URL (for non-Axios transfers like file downloads). */
export function getApiBaseUrl(): string {
  return API_URL;
}

export default api;
