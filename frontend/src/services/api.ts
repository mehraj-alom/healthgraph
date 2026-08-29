import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  InternalAxiosRequestConfig,
} from 'axios';

import { auth } from '@/context/AuthContext';

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  'http://localhost:8000';

/**
 * Axios configuration.
 */
const client = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
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
    try {
      const currentUser = auth.currentUser;

      if (currentUser) {
        const token =
          await currentUser.getIdToken();

        if (token && config.headers) {
          config.headers.Authorization =
            `Bearer ${token}`;
        }
      }
    } catch (error) {
      console.error(
        '[MedGraph] Failed to obtain Firebase ID token:',
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
  (response) => response,

  async (error) => {
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
