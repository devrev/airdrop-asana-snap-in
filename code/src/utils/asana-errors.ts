import {
  AirSyncErrorCode,
  ExternalSystemLoadingFunction,
  TaskResult,
} from '@devrev/airsync-sdk';
import axios from 'axios';

import { AsanaClient } from '@asana/api-client';
import { parseRetryAfter } from '@utils/retry-after';
import { serializeError } from '@utils/serialize-error';

export function describeAsanaError(error: unknown, scope: 'project' | 'workspace' | 'request'): Exclude<TaskResult, { status: 'success' | 'progress' }> {
  const status = axios.isAxiosError(error) ? error.response?.status : undefined;
  if (status === 429 && axios.isAxiosError(error)) {
    const retryAfter = parseRetryAfter(error.response?.headers['retry-after']);
    return typeof retryAfter === 'number'
      ? { status: 'delay', delaySeconds: retryAfter }
      : { status: 'error', error: retryAfter.error };
  }

  let code: AirSyncErrorCode | undefined;
  if (status === 401 || (status === 404 && scope === 'workspace')) {
    code = AirSyncErrorCode.EXTERNAL_SYSTEM_NO_ACCESS;
  } else if (status === 402 || status === 403) {
    code = AirSyncErrorCode.EXTERNAL_SYSTEM_NO_PERMISSION;
  } else if (status === 404 && scope === 'project') {
    code = AirSyncErrorCode.EXTERNAL_SYNC_UNIT_DELETED;
  }

  return { status: 'error', error: { message: `Asana ${scope} request failed: ${serializeError(error)}`, ...(code && { code }) } };
}

export class ProjectAccessGuard {
  private failure?: Extract<TaskResult, { status: 'error' }>;

  constructor(private readonly client: AsanaClient) {}

  private async check(): Promise<Exclude<TaskResult, { status: 'success' | 'progress' }> | undefined> {
    try {
      await this.client.getProject();
    } catch (error) {
      return describeAsanaError(error, 'project');
    }
  }

  async run(task: () => Promise<TaskResult>): Promise<TaskResult> {
    const failure = await this.check();
    if (failure) return failure;

    const result = await task();
    if (this.failure) return this.failure;
    if (result.status === 'error' && !result.error.code) {
      const accessFailure = await this.check();
      if (accessFailure?.status === 'error' && accessFailure.error.code) return accessFailure;
    }
    return result;
  }

  protectLoading<Item>(load: ExternalSystemLoadingFunction<Item>): ExternalSystemLoadingFunction<Item> {
    return async (params) => {
      if (this.failure) throw new Error(this.failure.error.message);
      const result = await load(params);
      if (result.status === 'error') {
        const failure = await this.check();
        if (failure?.status === 'error' && failure.error.code) {
          this.failure = failure;
          throw new Error(failure.error.message);
        }
      }
      return result;
    };
  }
}
