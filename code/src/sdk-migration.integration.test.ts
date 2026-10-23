import { Worker } from 'node:worker_threads';
import { gzipSync } from 'node:zlib';
import {
  AirSyncEvent,
  createMockEvent,
  createTestExtractionAdapter,
  EventType,
  Mappers,
  MockServer,
} from '@devrev/airsync-sdk';
import path from 'path';

import { initialState } from '@functions/extraction';
import { filterAlreadyMappedAttachments } from '@utils/data-helpers';
import { resolveExternalId } from '@utils/loading-helpers';

type SavedState = {
  stateVersion: number;
  connectorState: typeof initialState;
  sdkState: Record<string, unknown>;
};

type Callback = {
  event_type: string;
  event_data: { delay?: number; error?: { message: string }; reports?: unknown[] };
};

const bootstrap = `
  const { workerData } = require('node:worker_threads');
  require('ts-node/register/transpile-only');
  require('tsconfig-paths/register');
  require('@devrev/airsync-sdk');
  const axios = require('axios');
  const create = axios.create.bind(axios);
  axios.create = (config) => create({
    ...config,
    ...(config?.baseURL === 'https://app.asana.com/api/1.0'
      ? { baseURL: workerData.asanaUrl } : {}),
  });
  require(workerData.workerPath);
`;

const targetMapperPath = '/internal/airdrop.sync-mapper-record.get-by-target';
const externalMapperPath = '/internal/airdrop.sync-mapper-record.get-by-external-id';
const fieldsPath = '/api/1.0/projects/project/custom_field_settings';
const sectionsPath = '/api/1.0/projects/project/sections';
const usersPath = '/api/1.0/users';

jest.setTimeout(15000);

describe('SDK v2 migration over HTTP', () => {
  const server = new MockServer(0);

  beforeAll(() => server.start());
  afterAll(() => server.stop());
  beforeEach(() => {
    server.resetRoutes();
    seedState({ ...structuredClone(initialState), snapInVersionId: 'test_snap_in_version_id' });
  });

  function event(eventType = EventType.StartExtractingData): AirSyncEvent {
    return createMockEvent(server.baseUrl, {
      payload: {
        event_type: eventType,
        connection_data: { key: 'synthetic-asana-token', org_id: 'workspace' },
        event_context: { external_sync_unit_id: 'project' },
      },
    });
  }

  function seedState(state: unknown) {
    const objects = Object.fromEntries(Object.keys(initialState).map((key) => [key, { extract: key === 'users' }]));
    server.setRoute({
      method: 'GET', path: '/worker_data_url.get', status: 200,
      body: { state: JSON.stringify(state), objects: JSON.stringify(objects) },
    });
  }

  async function runWorker(workerName: string, input = event(), pauseOn?: string) {
    const phase = workerName.startsWith('load-') ? 'loading' : 'extraction';
    const worker = new Worker(bootstrap, {
      eval: true, stdout: true, stderr: true,
      workerData: {
        event: input, initialState: structuredClone(initialState), asanaUrl: `${server.baseUrl}/api/1.0`,
        workerPath: path.join(__dirname, 'functions', phase, 'workers', `${workerName}.ts`),
      },
    });
    const logs: string[] = [];
    worker.on('message', (message) => {
      if (message.subject === 'log') logs.push(message.payload.stringifiedArgs);
    });
    worker.stderr?.on('data', (data: Buffer) => logs.push(data.toString()));
    let pauseTimer: ReturnType<typeof setInterval> | undefined;
    if (pauseOn) {
      pauseTimer = setInterval(() => {
        if (server.getRequestCount('GET', pauseOn) > 0) {
          worker.postMessage({ subject: 'exit' });
          clearInterval(pauseTimer);
        }
      }, 5);
    }
    const deadline = setTimeout(() => void worker.terminate(), 12000);
    try {
      await new Promise<void>((resolve, reject) => {
        worker.once('error', reject);
        worker.once('exit', () => resolve());
      });
      const callbacks = server.getCallbackRequests();
      if (callbacks.length !== 1) throw new Error(`Expected one callback, got ${callbacks.length}: ${logs.slice(-5).join('\n')}`);
      const updates = server.getRequests('POST', '/worker_data_url.update');
      const state = updates.length
        ? JSON.parse((updates[updates.length - 1].body as { state: string }).state) as SavedState : undefined;
      return { callback: callbacks[0].body as Callback, state };
    } finally {
      clearTimeout(deadline);
      clearInterval(pauseTimer);
    }
  }

  function serveLoaderFile(data: Record<string, unknown> = { name: 'Migrated task' }) {
    const item = { id: { devrev: 'task-devrev' }, data };
    server.setRoute({ method: 'GET', path: '/internal/airdrop.artifacts.download-url', status: 200,
      body: { download_url: `${server.baseUrl}/loader-file` } });
    server.setRoute({ method: 'GET', path: '/loader-file', status: 200,
      bodyBuffer: gzipSync(`${JSON.stringify(item)}\n`) });
    seedState({
      ...structuredClone(initialState), snapInVersionId: 'test_snap_in_version_id',
      fromDevRev: { filesToLoad: [{ id: 'batch', file_name: 'tasks.jsonl', itemType: 'tasks', count: 1,
        lineToProcess: 0, completed: false }] },
    });
  }

  it('preserves Asana request parameters and 5xx retries after the baseline upgrade', async () => {
    server.setRoute({ method: 'GET', path: usersPath, status: 200, body: { data: [] },
      retry: { failureCount: 1, errorStatus: 500 } });
    const { callback } = await runWorker('data-extraction');
    expect(callback.event_type).toBe('DATA_EXTRACTION_DONE');
    const requests = server.getRequests('GET', usersPath);
    expect(requests).toHaveLength(2);
    const url = new URL(requests[0].url, server.baseUrl);
    expect(url.searchParams.get('workspace')).toBe('workspace');
    expect(url.searchParams.get('limit')).toBe('100');
    expect(url.searchParams.get('opt_fields')).toContain('email');
  });

  it.each([[403, 'METADATA_EXTRACTION_ERROR'], [429, 'METADATA_EXTRACTION_DELAYED']])(
    'propagates metadata HTTP %i and stops before later enrichment', async (status, expected) => {
      server.setRoute({ method: 'GET', path: fieldsPath, status,
        headers: { 'Retry-After': '37' }, body: { errors: [{ message: 'Metadata unavailable' }] } });
      const { callback } = await runWorker('metadata-extraction', event(EventType.StartExtractingMetadata));
      expect(callback.event_type).toBe(expected);
      if (status === 429) expect(callback.event_data.delay).toBe(37);
      else expect(callback.event_data.error?.message).toBe('ERROR_CODE=EXTERNAL_SYSTEM_NO_PERMISSION');
      expect(server.getRequestCount('GET', fieldsPath)).toBe(1);
      expect(server.getRequestCount('GET', sectionsPath)).toBe(0);
      expect(server.getRequestCount('POST', '/file-upload-url')).toBe(0);
    }
  );

  it('uses the SDK metadata timeout default and emits exactly one progress callback', async () => {
    server.setRoute({ method: 'GET', path: fieldsPath, status: 200, body: { data: [] }, delay: 100 });
    server.setRoute({ method: 'GET', path: sectionsPath, status: 200, body: { data: [] } });
    const { callback, state } = await runWorker('metadata-extraction', event(EventType.StartExtractingMetadata), fieldsPath);
    expect(callback.event_type).toBe('METADATA_EXTRACTION_PROGRESS');
    expect(state?.stateVersion).toBe(2);
  });

  it.each([['120', 120], [undefined, 60], ['invalid', 60]])(
    'preserves Retry-After %s as %i seconds without retrying in process', async (retryAfter, expected) => {
      server.setRoute({ method: 'GET', path: usersPath, status: 429,
        headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter }, body: { errors: [] } });
      const { callback, state } = await runWorker('data-extraction');
      expect(callback.event_type).toBe('DATA_EXTRACTION_DELAYED');
      expect(callback.event_data.delay).toBe(expected);
      expect(server.getRequestCount('GET', usersPath)).toBe(1);
      expect(state?.connectorState.users).toEqual(initialState.users);
    }
  );

  it('migrates flat v1 state, saves the timeout cursor, and resumes on the next page', async () => {
    server.setRoute({ method: 'GET', path: usersPath, status: 200, delay: 100,
      body: { data: [{ gid: 'user-1', name: 'First user' }], next_page: { offset: 'page-2' } } });
    const paused = await runWorker('data-extraction', event(), usersPath);
    expect(paused.callback.event_type).toBe('DATA_EXTRACTION_PROGRESS');
    expect(paused.state?.stateVersion).toBe(2);
    expect(paused.state?.connectorState.users).toEqual({ completed: false, offset: 'page-2', total: 1 });
    expect(paused.state?.connectorState).not.toHaveProperty('snapInVersionId');
    expect(paused.state?.sdkState.snapInVersionId).toBe('test_snap_in_version_id');
    server.resetRoutes();
    seedState(paused.state);
    server.setRoute({ method: 'GET', path: usersPath, status: 200,
      body: { data: [{ gid: 'user-2', name: 'Second user' }] } });
    const resumed = await runWorker('data-extraction', event(EventType.ContinueExtractingData));
    expect(resumed.callback.event_type).toBe('DATA_EXTRACTION_DONE');
    expect(resumed.state?.connectorState.users).toEqual({ completed: true, offset: '', total: 2 });
    const requests = server.getRequests('GET', usersPath);
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0].url, server.baseUrl).searchParams.get('offset')).toBe('page-2');
  });

  it('keeps ESU rate limits as phase errors with the retry hint', async () => {
    server.setRoute({ method: 'GET', path: '/api/1.0/workspaces/workspace/projects', status: 429,
      headers: { 'Retry-After': '41' }, body: { errors: [] } });
    const { callback } = await runWorker('external-sync-units-extraction', event(EventType.StartExtractingExternalSyncUnits));
    expect(callback.event_type).toBe('EXTERNAL_SYNC_UNIT_EXTRACTION_ERROR');
    expect(callback.event_data.error?.message).toContain('Retry in 41 seconds');
  });

  it.each([['mapped', 200], ['missing', 404], ['failed', 403]])(
    'resolves reverse IDs and suppresses duplicate attachments for %s mapper lookups', async (_label, status) => {
      const record = { sync_mapper_record: { id: 'mapper-1', external_ids: ['12345'] } };
      server.setRoute({ method: 'GET', path: targetMapperPath, status, body: record });
      server.setRoute({ method: 'GET', path: externalMapperPath, status, body: record });
      const mappers = new Mappers({ event: event() });
      expect(await resolveExternalId(mappers, 'test_sync_unit', 'task-devrev')).toBe(status === 200 ? '12345' : null);
      const adapter = createTestExtractionAdapter({ event: event(), initialState: structuredClone(initialState) });
      const attachments = [{ gid: 'file-1', name: 'attachment.txt' }];
      expect(await filterAlreadyMappedAttachments(attachments, adapter)).toEqual(status === 200 ? [] : attachments);
      expect(server.getRequestCount('GET', targetMapperPath)).toBe(1);
      expect(server.getRequestCount('GET', externalMapperPath)).toBe(1);
    }
  );

  it.each([[404, 'POST', '/api/1.0/tasks'], [200, 'PUT', '/api/1.0/tasks/12345']])(
    'loads through the real SDK create/update branch for mapper HTTP %i', async (status, method, route) => {
      serveLoaderFile();
      server.setRoute({ method: 'GET', path: targetMapperPath, status,
        body: { sync_mapper_record: { id: 'mapper-1', external_ids: ['12345'] } } });
      server.setRoute({ method, path: route, status: 200,
        body: { data: { gid: '12345', modified_at: '2026-10-15T07:00:00Z' } } });
      const { callback, state } = await runWorker('load-data', event(EventType.ContinueLoadingData));
      expect(callback.event_type).toBe('DATA_LOADING_DONE');
      expect(server.getRequestCount(method, route)).toBe(1);
      const action = status === 404 ? 'create' : 'update';
      const writes = server.getRequests('POST', `/internal/airdrop.sync-mapper-record.${action}`);
      expect(writes).toHaveLength(1);
      expect(writes[0].body).toMatchObject(status === 404 ? { external_ids: ['12345'] } : { external_ids: { add: ['12345'] } });
      expect(state?.sdkState.fromDevRev).toMatchObject({ filesToLoad: [{ lineToProcess: 1, completed: true }] });
    }
  );

  it.each([[404, 'POST', '/api/1.0/tasks'], [200, 'PUT', '/api/1.0/tasks/12345']])(
    'preserves reverse assignee and dates through the SDK for mapper HTTP %i', async (status, method, route) => {
      serveLoaderFile({ name: 'Assigned task', assignee: { external: '67890' },
        due_date: '2031-04-20T00:00:00Z', start_date: '2031-04-19T00:00:00Z' });
      server.setRoute({ method: 'GET', path: targetMapperPath, status,
        body: { sync_mapper_record: { id: 'mapper-1', external_ids: ['12345'] } } });
      server.setRoute({ method, path: route, status: 200,
        body: { data: { gid: '12345', modified_at: '2026-10-15T07:00:00Z' } } });
      const { callback } = await runWorker('load-data', event(EventType.ContinueLoadingData));
      expect(callback.event_type).toBe('DATA_LOADING_DONE');
      expect(server.getRequests(method, route)[0].body).toMatchObject({ data: {
        assignee: '67890', due_on: '2031-04-20', start_on: '2031-04-19',
      } });
    }
  );

  it('does not clear unmapped fields during a reverse title update', async () => {
    serveLoaderFile({ name: 'Title only' });
    server.setRoute({ method: 'GET', path: targetMapperPath, status: 200,
      body: { sync_mapper_record: { id: 'mapper-1', external_ids: ['12345'] } } });
    server.setRoute({ method: 'PUT', path: '/api/1.0/tasks/12345', status: 200,
      body: { data: { gid: '12345' } } });
    const { callback } = await runWorker('load-data', event(EventType.ContinueLoadingData));
    expect(callback.event_type).toBe('DATA_LOADING_DONE');
    expect(server.getRequests('PUT', '/api/1.0/tasks/12345')[0].body).toEqual({ data: { name: 'Title only' } });
  });

  it('propagates a loader callback rate limit and retains the item cursor', async () => {
    serveLoaderFile();
    server.setRoute({ method: 'GET', path: targetMapperPath, status: 404 });
    server.setRoute({ method: 'POST', path: '/api/1.0/tasks', status: 429,
      headers: { 'Retry-After': '23' }, body: { errors: [] } });
    const { callback, state } = await runWorker('load-data', event(EventType.ContinueLoadingData));
    expect(callback.event_type).toBe('DATA_LOADING_DELAYED');
    expect(callback.event_data.delay).toBe(23);
    expect(state?.sdkState.fromDevRev).toMatchObject({ filesToLoad: [{ lineToProcess: 0, completed: false }] });
    expect(server.getRequestCount('POST', '/internal/airdrop.sync-mapper-record.create')).toBe(0);
  });

  it('fails the loading phase on mapper HTTP failure without writing to Asana', async () => {
    serveLoaderFile();
    server.setRoute({ method: 'GET', path: targetMapperPath, status: 403 });
    const { callback, state } = await runWorker('load-data', event(EventType.ContinueLoadingData));
    expect(callback.event_type).toBe('DATA_LOADING_ERROR');
    expect(state?.sdkState.fromDevRev).toMatchObject({ filesToLoad: [{ lineToProcess: 0, completed: false }] });
    expect(server.getRequestCount('POST', '/api/1.0/tasks')).toBe(0);
  });
  it.each([401, 403])('permission failure metadata HTTP %i', async (status) => {
    server.setRoute({ method: 'GET', path: fieldsPath, status, body: { errors: [{ message: 'Auth audit rejection' }] } });
    const { callback } = await runWorker('metadata-extraction', event(EventType.StartExtractingMetadata));
    expect(callback.event_type).toBe('METADATA_EXTRACTION_ERROR');
    expect(callback.event_data.error?.message).toBe(`ERROR_CODE=${status === 401 ? 'EXTERNAL_SYSTEM_NO_ACCESS' : 'EXTERNAL_SYSTEM_NO_PERMISSION'}`);
  });
  it.each([401, 403])('permission failure data HTTP %i', async (status) => {
    server.setRoute({ method: 'GET', path: usersPath, status, body: { errors: [{ message: 'Auth audit rejection' }] } });
    const { callback } = await runWorker('data-extraction');
    expect(callback.event_type).toBe('DATA_EXTRACTION_ERROR');
    expect(callback.event_data.error?.message).toBe(`ERROR_CODE=${status === 401 ? 'EXTERNAL_SYSTEM_NO_ACCESS' : 'EXTERNAL_SYSTEM_NO_PERMISSION'}`);
  });
  it.each([401, 403])('permission failure ESU HTTP %i', async (status) => {
    server.setRoute({ method: 'GET', path: '/api/1.0/workspaces/workspace/projects', status, body: { errors: [{ message: 'Auth audit rejection' }] } });
    const { callback } = await runWorker('external-sync-units-extraction', event(EventType.StartExtractingExternalSyncUnits));
    expect(callback.event_type).toBe('EXTERNAL_SYNC_UNIT_EXTRACTION_ERROR');
    expect(callback.event_data.error?.message).toBe(`ERROR_CODE=${status === 401 ? 'EXTERNAL_SYSTEM_NO_ACCESS' : 'EXTERNAL_SYSTEM_NO_PERMISSION'}`);
  });
  it.each([401, 403])('permission failure reverse data HTTP %i', async (status) => {
    serveLoaderFile();
    server.setRoute({ method: 'GET', path: targetMapperPath, status: 404 });
    server.setRoute({ method: 'POST', path: '/api/1.0/tasks', status, body: { errors: [{ message: 'Auth audit rejection' }] } });
    const { callback } = await runWorker('load-data', event(EventType.ContinueLoadingData));
    expect(server.getRequestCount('POST', '/api/1.0/tasks')).toBe(1);
    expect(callback.event_type).toBe('DATA_LOADING_ERROR');
    expect(callback.event_data.error?.message).toBe(`ERROR_CODE=${status === 401 ? 'EXTERNAL_SYSTEM_NO_ACCESS' : 'EXTERNAL_SYSTEM_NO_PERMISSION'}`);
  });
  it.each([401, 403])('permission failure extraction attachments HTTP %i', async (status) => {
    const attachment = { id: 'auth-file', parent_id: 'task', file_name: 'auth.txt', url: 'https://unused.invalid' };
    server.setRoute({ method: 'GET', path: '/internal/airdrop.artifacts.download-url', status: 200, body: { download_url: `${server.baseUrl}/auth-metadata` } });
    server.setRoute({ method: 'GET', path: '/auth-metadata', status: 200, bodyBuffer: gzipSync(`${JSON.stringify(attachment)}\n`) });
    server.setRoute({ method: 'GET', path: '/api/1.0/attachments/auth-file', status, body: { errors: [{ message: 'Auth audit rejection' }] } });
    seedState({ ...structuredClone(initialState), snapInVersionId: 'test_snap_in_version_id', toDevRev: { deferredSsorArtifacts: [], attachmentsMetadata: { artifactIds: ['metadata'], lastProcessed: 0, lastProcessedAttachmentsIdsList: [] } } });
    const { callback } = await runWorker('attachments-extraction', event(EventType.StartExtractingAttachments));
    expect(server.getRequestCount('GET', '/api/1.0/attachments/auth-file')).toBe(1);
    expect(callback.event_type).toBe('ATTACHMENT_EXTRACTION_ERROR');
    expect(callback.event_data.error?.message).toBe(`ERROR_CODE=${status === 401 ? 'EXTERNAL_SYSTEM_NO_ACCESS' : 'EXTERNAL_SYSTEM_NO_PERMISSION'}`);
  });
  it.each([401, 403])('permission failure reverse attachments HTTP %i', async (status) => {
    const item = { id: { devrev: 'attachment-devrev' }, parent_reference_id: 'parent-devrev', file_name: 'auth.txt', url: `${server.baseUrl}/auth-file` };
    server.setRoute({ method: 'GET', path: '/internal/airdrop.artifacts.download-url', status: 200, body: { download_url: `${server.baseUrl}/auth-loader-file` } });
    server.setRoute({ method: 'GET', path: '/auth-loader-file', status: 200, bodyBuffer: gzipSync(`${JSON.stringify(item)}\n`) });
    server.setRoute({ method: 'GET', path: '/auth-file', status: 200, bodyBuffer: Buffer.from('synthetic') });
    server.setRoute({ method: 'GET', path: targetMapperPath, status: 200, body: { sync_mapper_record: { id: 'mapper-parent', external_ids: ['12345'] } } });
    server.setRoute({ method: 'POST', path: '/api/1.0/attachments', status, body: { errors: [{ message: 'Auth audit rejection' }] } });
    seedState({ ...structuredClone(initialState), snapInVersionId: 'test_snap_in_version_id', fromDevRev: { filesToLoad: [{ id: 'batch', file_name: 'attachments.jsonl', itemType: 'attachment', count: 1, lineToProcess: 0, completed: false }] } });
    const { callback } = await runWorker('load-attachments', event(EventType.ContinueLoadingAttachments));
    expect(server.getRequestCount('POST', '/api/1.0/attachments')).toBe(1);
    expect(callback.event_type).toBe('ATTACHMENT_LOADING_ERROR');
    expect(callback.event_data.error?.message).toBe(`ERROR_CODE=${status === 401 ? 'EXTERNAL_SYSTEM_NO_ACCESS' : 'EXTERNAL_SYSTEM_NO_PERMISSION'}`);
  });

  it.each([401, 403])('preserves access errors from task section assignment HTTP %i', async (status) => {
    serveLoaderFile({ name: 'Task', section: '123' });
    server.setRoute({ method: 'GET', path: targetMapperPath, status: 404 });
    server.setRoute({ method: 'POST', path: '/api/1.0/tasks', status: 200,
      body: { data: { gid: '456' } } });
    server.setRoute({ method: 'POST', path: '/api/1.0/sections/123/addTask', status,
      body: { errors: [{ message: 'No section access' }] } });
    const { callback } = await runWorker('load-data', event(EventType.ContinueLoadingData));
    expect(server.getRequestCount('POST', '/api/1.0/sections/123/addTask')).toBe(1);
    expect(callback.event_type).toBe('DATA_LOADING_ERROR');
    expect(callback.event_data.error?.message).toBe(`ERROR_CODE=${status === 401 ? 'EXTERNAL_SYSTEM_NO_ACCESS' : 'EXTERNAL_SYSTEM_NO_PERMISSION'}`);
  });

  it('keeps an ordinary task loading error recoverable', async () => {
    serveLoaderFile();
    server.setRoute({ method: 'GET', path: targetMapperPath, status: 404 });
    server.setRoute({ method: 'POST', path: '/api/1.0/tasks', status: 404 });
    const { callback } = await runWorker('load-data', event(EventType.ContinueLoadingData));
    expect(callback.event_type).toBe('DATA_LOADING_DONE');
    expect(callback.event_data.reports).toEqual([{ item_type: 'tasks', failed: 1 }]);
  });

  it.each([401, 403])('preserves access errors from workspace role checks HTTP %i', async (status) => {
    server.setRoute({ method: 'GET', path: '/api/1.0/users/me/workspace_memberships', status });
    const { callback } = await runWorker('external-sync-units-extraction', event(EventType.StartExtractingExternalSyncUnits));
    expect(callback.event_type).toBe('EXTERNAL_SYNC_UNIT_EXTRACTION_ERROR');
    expect(callback.event_data.error?.message).toBe(`ERROR_CODE=${status === 401 ? 'EXTERNAL_SYSTEM_NO_ACCESS' : 'EXTERNAL_SYSTEM_NO_PERMISSION'}`);
    expect(server.getRequestCount('GET', '/api/1.0/workspaces/workspace/projects')).toBe(0);
  });

  it.each([['asana', 404], ['download', 403]])('skips an individual attachment %s HTTP %i failure', async (source, status) => {
    const attachment = { id: 'recoverable', parent_id: 'task', file_name: 'file.txt', url: 'https://unused.invalid' };
    server.setRoute({ method: 'GET', path: '/internal/airdrop.artifacts.download-url', status: 200,
      body: { download_url: `${server.baseUrl}/attachment-metadata` } });
    server.setRoute({ method: 'GET', path: '/attachment-metadata', status: 200,
      bodyBuffer: gzipSync(`${JSON.stringify(attachment)}\n`) });
    server.setRoute({ method: 'GET', path: '/api/1.0/attachments/recoverable', status: source === 'asana' ? status as number : 200,
      body: { data: { download_url: `${server.baseUrl}/expired-download` } } });
    server.setRoute({ method: 'GET', path: '/expired-download', status: status as number });
    seedState({ ...structuredClone(initialState), snapInVersionId: 'test_snap_in_version_id',
      toDevRev: { deferredSsorArtifacts: [], attachmentsMetadata: { artifactIds: ['metadata'], lastProcessed: 0, lastProcessedAttachmentsIdsList: [] } } });
    const { callback } = await runWorker('attachments-extraction', event(EventType.StartExtractingAttachments));
    expect(callback.event_type).toBe('ATTACHMENT_EXTRACTION_DONE');
    expect(callback.event_data.error).toBeUndefined();
  });

});
