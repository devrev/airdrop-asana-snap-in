import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { serializeError } from './serialize-error';

function createMockConfig(
  method: string,
  url: string,
  baseURL?: string
): InternalAxiosRequestConfig {
  return {
    method,
    url,
    baseURL,
    headers: {},
  } as InternalAxiosRequestConfig;
}

function createMockResponse<T>(
  status: number,
  statusText: string,
  data: T
): AxiosResponse<T> {
  return {
    status,
    statusText,
    data,
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  };
}

describe('serializeError', () => {
  describe('Axios errors', () => {
    it('should serialize a basic Axios error with request details', () => {
      const config = createMockConfig('get', '/api/tasks', 'https://api.asana.com');
      const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config);

      const result = serializeError(error);

      expect(result).toContain('Request failed');
      expect(result).toContain('request: GET https://api.asana.com/api/tasks');
      expect(result).toContain('code: ERR_BAD_REQUEST');
    });

    it('should serialize Axios error with response status', () => {
      const config = createMockConfig('get', '/api/tasks/123', 'https://api.asana.com');
      const error = new AxiosError('Not Found', 'ERR_BAD_REQUEST', config);
      error.response = createMockResponse(404, 'Not Found', { message: 'Task not found' });

      const result = serializeError(error);

      expect(result).toContain('status: 404 Not Found');
      expect(result).toContain('response: {"message":"Task not found"}');
    });

    it('should handle Axios error without baseURL', () => {
      const config = createMockConfig('post', 'https://api.example.com/endpoint');
      const error = new AxiosError('Request failed', 'ERR_NETWORK', config);

      const result = serializeError(error);

      expect(result).toContain('request: POST https://api.example.com/endpoint');
    });

    it('should handle Axios error with missing config', () => {
      const error = new AxiosError('Network Error');

      const result = serializeError(error);

      expect(result).toContain('Network Error');
      expect(result).toContain('request: UNKNOWN UNKNOWN');
    });

    it('should handle Axios error with baseURL trailing slash', () => {
      const config = createMockConfig('get', '/api/tasks', 'https://api.asana.com/');
      const error = new AxiosError('Request failed', undefined, config);

      const result = serializeError(error);

      expect(result).toContain('request: GET https://api.asana.com/api/tasks');
    });

    it('should handle Axios error with URL without leading slash', () => {
      const config = createMockConfig('get', 'api/tasks', 'https://api.asana.com');
      const error = new AxiosError('Request failed', undefined, config);

      const result = serializeError(error);

      expect(result).toContain('request: GET https://api.asana.com/api/tasks');
    });

    it('should handle Axios error with empty response data', () => {
      const config = createMockConfig('get', '/api/tasks', 'https://api.asana.com');
      const error = new AxiosError('Server Error', undefined, config);
      error.response = createMockResponse(500, 'Internal Server Error', null);

      const result = serializeError(error);

      expect(result).toContain('status: 500 Internal Server Error');
      expect(result).not.toContain('response:');
    });
  });

  describe('standard Error objects', () => {
    it('should serialize a standard Error', () => {
      const error = new Error('Something went wrong');

      const result = serializeError(error);

      expect(result).toBe('Something went wrong');
    });

    it('should serialize a TypeError', () => {
      const error = new TypeError('Cannot read property of undefined');

      const result = serializeError(error);

      expect(result).toBe('Cannot read property of undefined');
    });

    it('should serialize a RangeError', () => {
      const error = new RangeError('Maximum call stack size exceeded');

      const result = serializeError(error);

      expect(result).toBe('Maximum call stack size exceeded');
    });

    it('should serialize an Error with a cause', () => {
      const cause = new Error('Root cause');
      const error = new Error('Wrapper error') as Error & { cause?: unknown };
      error.cause = cause;

      const result = serializeError(error);

      expect(result).toBe('Wrapper error | cause: Root cause');
    });

    it('should serialize nested error causes', () => {
      const rootCause = new Error('Root cause');
      const middleCause = new Error('Middle cause') as Error & { cause?: unknown };
      middleCause.cause = rootCause;
      const error = new Error('Top error') as Error & { cause?: unknown };
      error.cause = middleCause;

      const result = serializeError(error);

      expect(result).toBe('Top error | cause: Middle cause | cause: Root cause');
    });

    it('should handle Error with empty message', () => {
      const error = new Error('');

      const result = serializeError(error);

      expect(result).toBe('Error');
    });
  });

  describe('string errors', () => {
    it('should return string errors as-is', () => {
      const result = serializeError('Simple error message');

      expect(result).toBe('Simple error message');
    });

    it('should handle empty string', () => {
      const result = serializeError('');

      expect(result).toBe('Empty string error');
    });
  });

  describe('unknown error types', () => {
    it('should serialize object errors as JSON', () => {
      const error = { code: 'ERR_CUSTOM', details: 'Custom error' };

      const result = serializeError(error);

      expect(result).toBe('{"code":"ERR_CUSTOM","details":"Custom error"}');
    });

    it('should serialize number errors', () => {
      const result = serializeError(42);

      expect(result).toBe('42');
    });

    it('should serialize zero', () => {
      const result = serializeError(0);

      expect(result).toBe('0');
    });

    it('should serialize boolean true', () => {
      const result = serializeError(true);

      expect(result).toBe('true');
    });

    it('should serialize boolean false', () => {
      const result = serializeError(false);

      expect(result).toBe('false');
    });

    it('should serialize null as JSON', () => {
      const result = serializeError(null);

      expect(result).toBe('null');
    });

    it('should serialize undefined', () => {
      const result = serializeError(undefined);

      expect(result).toBe('undefined');
    });

    it('should serialize array errors as JSON', () => {
      const error = ['error1', 'error2'];

      const result = serializeError(error);

      expect(result).toBe('["error1","error2"]');
    });
  });

  describe('circular references and edge cases', () => {
    it('should handle circular reference in object', () => {
      const obj: Record<string, unknown> = { name: 'test' };
      obj.self = obj;

      const result = serializeError(obj);

      expect(result).toBe('[object Object]');
    });

    it('should handle Axios error with circular response data', () => {
      const config = createMockConfig('get', '/api/tasks', 'https://api.asana.com');
      const error = new AxiosError('Request failed', 'ERR_BAD_REQUEST', config);
      const circularData: Record<string, unknown> = { message: 'error' };
      circularData.self = circularData;
      error.response = createMockResponse(500, 'Server Error', circularData);

      const result = serializeError(error);

      expect(result).toContain('Request failed');
      expect(result).toContain('status: 500 Server Error');
      expect(result).toContain('response: [object Object]');
    });

    it('should handle Axios error with cause', () => {
      const config = createMockConfig('get', '/api/tasks', 'https://api.asana.com');
      const cause = new Error('Connection refused');
      const error = new AxiosError('Network Error', 'ERR_NETWORK', config);
      error.cause = cause;

      const result = serializeError(error);

      expect(result).toContain('Network Error');
      expect(result).toContain('cause: Connection refused');
    });

    it('should handle Axios error with empty message', () => {
      const config = createMockConfig('get', '/api/tasks', 'https://api.asana.com');
      const error = new AxiosError('', 'ERR_BAD_REQUEST', config);

      const result = serializeError(error);

      expect(result).toContain('Axios error');
      expect(result).toContain('request: GET https://api.asana.com/api/tasks');
    });
  });

  describe('real-world scenarios', () => {
    it('should handle Asana API rate limit error', () => {
      const config = createMockConfig('get', '/api/1.0/tasks', 'https://app.asana.com');
      const error = new AxiosError('Rate Limit Exceeded', 'ERR_BAD_REQUEST', config);
      error.response = createMockResponse(429, 'Too Many Requests', {
        errors: [{ message: 'Rate limit exceeded', help: 'Retry after 60 seconds' }],
      });

      const result = serializeError(error);

      expect(result).toContain('Rate Limit Exceeded');
      expect(result).toContain('status: 429 Too Many Requests');
      expect(result).toContain('Rate limit exceeded');
    });

    it('should handle authentication error', () => {
      const config = createMockConfig('get', '/api/1.0/users/me', 'https://app.asana.com');
      const error = new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config);
      error.response = createMockResponse(401, 'Unauthorized', {
        errors: [{ message: 'Invalid token' }],
      });

      const result = serializeError(error);

      expect(result).toContain('status: 401 Unauthorized');
      expect(result).toContain('Invalid token');
    });
  });
});
