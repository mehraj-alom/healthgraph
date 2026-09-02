import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';

import { auth } from '@/context/AuthContext';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  'http://10.210.149.11:8000';

console.log('[MedGraph] API_URL:', API_URL);

// ── Temporary structured logging for upload/poll tracing ──────────────
// Remove after diagnosing the Network Error.
const _reqSeq = { n: 0 };


/**
 * Axios configuration.
 */
const client = axios.create({
  baseURL: API_URL,
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
    console.log(
      `[HTTP] #${seq} → ${String(config.method ?? '??').toUpperCase()} ${config.baseURL ?? ''}${config.url ?? ''}`,
    );
    try {
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
    console.log(
      `[HTTP] #${seq} ← ${response.status} ${String(response.config.method ?? '??').toUpperCase()} ${response.config.url ?? ''}`,
    );
    return response;
  },

  async (error) => {
    const seq = (error.config as any)?.__seq ?? '?';
    console.error(
      `[HTTP] #${seq} ✖ ${String(error.config?.method ?? '??').toUpperCase()} ${error.config?.url ?? ''}`,
      `code=${error.code} message=${error.message}`,
      error.response ? `status=${error.response.status}` : 'NO_RESPONSE',
    );
    if (error.response) {
      console.error(`[HTTP] #${seq} response body:`, error.response.data);
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

export default api;
