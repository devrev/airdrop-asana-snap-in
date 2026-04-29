import axios from 'axios';

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Serialize any error type into a human-readable string with request/response details. */
export function serializeError(error: unknown): string {
  if (error === null) {
    return 'null';
  }
  if (error === undefined) {
    return 'undefined';
  }

  if (axios.isAxiosError(error)) {
    const { config } = error;
    const method = config?.method?.toUpperCase() || 'UNKNOWN';
    const baseURL = config?.baseURL || '';
    const url = config?.url || '';
    const fullUrl = baseURL
      ? `${baseURL.replace(/\/$/, '')}${url.startsWith('/') ? url : `/${url}`}`
      : url || 'UNKNOWN';

    const parts = [
      error.message || 'Axios error',
      `request: ${method} ${fullUrl}`,
      error.response?.status && `status: ${error.response.status} ${error.response.statusText || ''}`.trim(),
      error.code && `code: ${error.code}`,
      error.response?.data && `response: ${safeStringify(error.response.data)}`,
      error.cause && `cause: ${serializeError(error.cause)}`,
    ].filter(Boolean);

    return parts.join(' | ');
  }

  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const parts = [
      error.message || error.name || 'Unknown error',
      cause && `cause: ${serializeError(cause)}`,
    ].filter(Boolean);
    return parts.join(' | ');
  }

  if (typeof error === 'string') {
    return error || 'Empty string error';
  }

  if (typeof error === 'number' || typeof error === 'boolean') {
    return String(error);
  }

  return safeStringify(error) || 'Unknown error';
}
