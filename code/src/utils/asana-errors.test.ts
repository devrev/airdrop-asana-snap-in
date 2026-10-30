import { AirSyncErrorCode, ExternalSystemItemLoadingParams, TaskResult } from '@devrev/airsync-sdk';
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';

import { AsanaClient } from '@asana/api-client';

import { describeAsanaError, ProjectAccessGuard } from './asana-errors';

function httpError(status: number, retryAfter?: string): AxiosError {
  return new AxiosError('Fixture failure', undefined, undefined, undefined, {
    status, headers: new AxiosHeaders(retryAfter ? { 'retry-after': retryAfter } : {}),
  } as AxiosResponse);
}

describe('Asana common errors', () => {
  it.each([
    [401, 'project', AirSyncErrorCode.EXTERNAL_SYSTEM_NO_ACCESS],
    [402, 'project', AirSyncErrorCode.EXTERNAL_SYSTEM_NO_PERMISSION],
    [403, 'project', AirSyncErrorCode.EXTERNAL_SYSTEM_NO_PERMISSION],
    [404, 'project', AirSyncErrorCode.EXTERNAL_SYNC_UNIT_DELETED],
    [404, 'workspace', AirSyncErrorCode.EXTERNAL_SYSTEM_NO_ACCESS],
    [404, 'request', undefined],
    [400, 'project', undefined],
    [409, 'project', undefined],
    [500, 'project', undefined],
    [503, 'project', undefined],
  ] as const)('maps HTTP %i for %s to %s', (status, scope, code) => {
    const result = describeAsanaError(httpError(status), scope);
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.error.code).toBe(code);
  });

  it.each([undefined, 'invalid', '-1', '0', 'Infinity', 'NaN'])('uses a bounded default for Retry-After %s', (header) => {
    expect(describeAsanaError(httpError(429, header), 'project')).toEqual({ status: 'delay', delaySeconds: 60 });
  });

  it('rounds a positive Retry-After up to whole seconds', () => {
    expect(describeAsanaError(httpError(429, '1.5'), 'project')).toEqual({ status: 'delay', delaySeconds: 2 });
  });

  it.each([new AxiosError('Network error'), new Error('Timeout')])('keeps transient failures uncoded', (error) => {
    expect(describeAsanaError(error, 'project')).toEqual({ status: 'error', error: { message: expect.any(String) } });
  });
});

describe('ProjectAccessGuard', () => {
  const getProject = jest.fn();
  const client = { getProject } as unknown as AsanaClient;
  const params = {} as ExternalSystemItemLoadingParams<object>;

  beforeEach(() => getProject.mockReset().mockResolvedValue({}));

  it('stops before calling the phase if its project is missing', async () => {
    getProject.mockRejectedValue(httpError(404));
    const task = jest.fn();
    const result = await new ProjectAccessGuard(client).run(task);
    expect(task).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'error', error: { code: AirSyncErrorCode.EXTERNAL_SYNC_UNIT_DELETED } });
  });

  it('does not treat an individual missing item as project deletion', async () => {
    const guard = new ProjectAccessGuard(client);
    const itemFailure = { status: 'error' as const, error: { message: 'Task not found' } };
    const load = guard.protectLoading(jest.fn().mockResolvedValue(itemFailure));
    expect(await guard.run(async () => {
      expect(await load(params)).toEqual(itemFailure);
      return { status: 'success' };
    })).toEqual({ status: 'success' });
  });

  it.each([401, 403, 404])('preserves a phase error when project HTTP %i appears during loading', async (status) => {
    getProject.mockResolvedValueOnce({}).mockRejectedValue(httpError(status));
    const guard = new ProjectAccessGuard(client);
    const loadItem = jest.fn().mockResolvedValue({ status: 'error', error: { message: 'Item failed' } });
    const load = guard.protectLoading(loadItem);
    const result = await guard.run(async () => {
      let sdkResult: TaskResult = { status: 'success' };
      try {
        await load(params);
      } catch {
        sdkResult = { status: 'error', error: { message: 'SDK caught the callback error' } };
      }
      await expect(load(params)).rejects.toThrow();
      return sdkResult;
    });
    expect(result).toMatchObject(describeAsanaError(httpError(status), 'project'));
    expect(loadItem).toHaveBeenCalledTimes(1);
  });

  it('keeps an unrelated phase error when the project is accessible', async () => {
    const error: TaskResult = { status: 'error', error: { message: 'Artifact download failed' } };
    expect(await new ProjectAccessGuard(client).run(async () => error)).toEqual(error);
  });

  it('does not probe again when a phase is delayed or times out', async () => {
    for (const result of [{ status: 'delay', delaySeconds: 30 }, { status: 'progress' }] as TaskResult[]) {
      getProject.mockClear();
      expect(await new ProjectAccessGuard(client).run(async () => result)).toEqual(result);
      expect(getProject).toHaveBeenCalledTimes(1);
    }
  });
});
