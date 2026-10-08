import axios from 'axios';
import { toast } from 'sonner';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('lmis_token');
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let toastShown = false;

apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    let normalizedError = {
      message: 'An unexpected network error occurred.',
      status: 500,
      code: 'UNKNOWN_ERROR',
    };

    if (error.response) {
      normalizedError = {
        message: error.response.data?.error?.message || error.response.statusText,
        status: error.response.status,
        code: error.response.data?.error?.code || 'API_ERROR',
      };
    } else if (error.request) {
      normalizedError.message = 'Unable to connect to the server.';
      normalizedError.code = 'NETWORK_ERROR';
    } else {
      normalizedError.message = error.message;
    }

    if (!toastShown) {
      toast.error(`API Error: ${normalizedError.message}`);
      toastShown = true;
      setTimeout(() => { toastShown = false; }, 5000);
    }

    return Promise.reject(normalizedError);
  }
);
