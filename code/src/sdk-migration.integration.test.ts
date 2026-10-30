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
    server.setRoute({ method: 'GET', path: '/api/1.0/projects/project', status: 200, body: { data: { gid: 'project' } } });
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

  it.each(['load-data', 'load-attachments'].flatMap((workerName) => [429, 401, 403, 404].map((status) => [workerName, status] as const)))('retains a fresh %s batch when the project preflight returns %s', async (workerName, status) => {
    const attachment = workerName === 'load-attachments';
    const downloadPath = '/internal/airdrop.artifacts.download-url';
    server.setRoute({ method: 'GET', path: downloadPath, status: 200, body: {
      get download_url() {
        return `${server.baseUrl}/${server.getRequestCount('GET', downloadPath) === 1 ? 'stats' : 'batch'}`;
      },
    } });
    server.setRoute({ method: 'GET', path: '/stats', status: 200, bodyBuffer: Buffer.from(JSON.stringify({
      id: 'fresh-batch', file_name: 'batch.jsonl', item_type: attachment ? 'attachment' : 'tasks', count: '1',
    }) + '\n') });
    const item = attachment
      ? { reference_id: 'file-devrev', parent_id: 'task-devrev', file_name: 'file.txt', url: `${server.baseUrl}/file` }
      : { id: { devrev: 'task-devrev' }, data: { name: 'Fresh task' } };
    server.setRoute({ method: 'GET', path: '/batch', status: 200, bodyBuffer: gzipSync(JSON.stringify(item) + '\n') });
    server.setRoute({ method: 'GET', path: '/file', status: 200, bodyBuffer: Buffer.from('file contents') });
    server.setRoute({ method: 'GET', path: '/api/1.0/projects/project', status,
      headers: { 'Retry-After': '17' }, body: { errors: [] } });
    const input = event(attachment ? EventType.StartLoadingAttachments : EventType.StartLoadingData);
    input.payload.event_data = { stats_file: 'stats' };
    const delayed = await runWorker(workerName, input);
    if (status !== 429) {
      expect(delayed.callback.event_type).toBe(attachment ? 'ATTACHMENT_LOADING_ERROR' : 'DATA_LOADING_ERROR');
      const code = status === 401 ? 'EXTERNAL_SYSTEM_NO_ACCESS' : status === 403 ? 'EXTERNAL_SYSTEM_NO_PERMISSION' : 'EXTERNAL_SYNC_UNIT_DELETED';
      expect(delayed.callback.event_data.error?.message).toBe(`ERROR_CODE=${code}`);
      expect(delayed.state?.sdkState.fromDevRev).toMatchObject({ filesToLoad: [{ lineToProcess: 0, completed: false }] });
      expect(server.getRequestCount('POST', attachment ? '/api/1.0/attachments' : '/api/1.0/tasks')).toBe(0);
      return;
    }
    expect(delayed.callback.event_type).toBe(attachment ? 'ATTACHMENT_LOADING_DELAYED' : 'DATA_LOADING_DELAYED');
    expect(delayed.callback.event_data.delay).toBe(17);
    expect(delayed.state?.sdkState.fromDevRev).toMatchObject({ filesToLoad: [{
      id: 'fresh-batch', lineToProcess: 0, completed: false,
    }] });
    expect(server.getRequestCount('POST', attachment ? '/api/1.0/attachments' : '/api/1.0/tasks')).toBe(0);

    seedState(delayed.state);
    (server as unknown as { requests: unknown[] }).requests.length = 0;
    server.setRoute({ method: 'GET', path: downloadPath, status: 200, body: { download_url: `${server.baseUrl}/batch` } });
    server.setRoute({ method: 'GET', path: '/api/1.0/projects/project', status: 200, body: { data: { gid: 'project' } } });
    server.setRoute({ method: 'GET', path: targetMapperPath, status: attachment ? 200 : 404,
      body: { sync_mapper_record: { id: 'mapper', external_ids: ['12345'] } } });
    const writePath = attachment ? '/api/1.0/attachments' : '/api/1.0/tasks';
    server.setRoute({ method: 'POST', path: writePath, status: 200, body: { data: { gid: 'created' } } });
    input.payload.event_type = attachment ? EventType.ContinueLoadingAttachments : EventType.ContinueLoadingData;
    const resumed = await runWorker(workerName, input);
    expect(resumed.callback.event_type).toBe(attachment ? 'ATTACHMENT_LOADING_DONE' : 'DATA_LOADING_DONE');
    expect(resumed.state?.sdkState.fromDevRev).toMatchObject({ filesToLoad: [{ lineToProcess: 1, completed: true }] });
    expect(server.getRequestCount('POST', writePath)).toBe(1);
    expect(server.getRequestCount('GET', '/stats')).toBe(0);
  });

  it.each(['load-data', 'load-attachments'])('does not hide a failed %s batch initialization behind a project delay', async (workerName) => {
    const attachment = workerName === 'load-attachments';
    const input = event(attachment ? EventType.StartLoadingAttachments : EventType.StartLoadingData);
    input.payload.event_data = { stats_file: 'missing-stats' };
    server.setRoute({ method: 'GET', path: '/internal/airdrop.artifacts.download-url', status: 404, body: {} });
    server.setRoute({ method: 'GET', path: '/api/1.0/projects/project', status: 429,
      headers: { 'Retry-After': '17' }, body: { errors: [] } });
    const { callback } = await runWorker(workerName, input);
    expect(callback.event_type).toBe(attachment ? 'ATTACHMENT_LOADING_ERROR' : 'DATA_LOADING_ERROR');
    expect(callback.event_data.error?.message).toContain('Failed to download loader stats file');
  });

  it('resets prior incremental completion before a project rate-limit delay', async () => {
    const previous = { ...structuredClone(initialState), snapInVersionId: 'test_snap_in_version_id' };
    previous.users.completed = true;
    previous.tasks.completed = true;
    previous.users.total = 100;
    seedState(previous);
    server.setRoute({ method: 'GET', path: '/api/1.0/projects/project', status: 429,
      headers: { 'Retry-After': '30' }, body: { errors: [] } });
    const input = event();
    input.payload.event_context.mode = 'INCREMENTAL';
    input.payload.event_context.extract_from = '2026-10-29T00:00:00Z';

    const delayed = await runWorker('data-extraction', input);
    expect(delayed.callback.event_type).toBe('DATA_EXTRACTION_DELAYED');
    expect(delayed.state?.connectorState.users.completed).toBe(false);
    expect(delayed.state?.connectorState.tasks.completed).toBe(false);
    expect(delayed.state?.connectorState.users.total).toBe(0);
    expect(server.getRequestCount('GET', usersPath)).toBe(0);

    seedState(delayed.state);
    (server as unknown as { requests: unknown[] }).requests.length = 0;
    server.setRoute({ method: 'GET', path: '/api/1.0/projects/project', status: 200,
      body: { data: { gid: 'project' } } });
    server.setRoute({ method: 'GET', path: usersPath, status: 200, body: { data: [] } });
    input.payload.event_type = EventType.ContinueExtractingData;
    const resumed = await runWorker('data-extraction', input);
    expect(resumed.callback.event_type).toBe('DATA_EXTRACTION_DONE');
    expect(server.getRequestCount('GET', usersPath)).toBe(1);
    expect(resumed.state?.connectorState.users.completed).toBe(true);
  });

  it('resumes an incremental nested branch after a 429 without replaying a completed root', async () => {
    const tasksPath = '/api/1.0/projects/project/tasks';
    const branchPath = '/api/1.0/tasks/intermediate/subtasks';
    const before = '2024-01-01T00:00:00Z';
    const within = '2024-06-02T00:00:00Z';
    const setup = (state: unknown) => {
      server.setRoute({ method: 'GET', path: '/api/1.0/projects/project', status: 200, body: { data: { gid: 'project' } } });
      server.setRoute({ method: 'GET', path: '/worker_data_url.get', status: 200, body: {
        state: JSON.stringify(state), objects: JSON.stringify({ tasks: { extract: true }, subtasks: { extract: true }, comments: { extract: true }, links: { extract: true } }),
      } });
      const roots = [
        { gid: 'completed-root', name: 'Completed', created_at: before, modified_at: within },
        { gid: 'root', name: 'Unchanged', created_at: before, modified_at: before, num_subtasks: 1 },
      ];
      server.setRoute({ method: 'GET', path: tasksPath, status: 200, body: { data: roots } });
      server.setRoute({ method: 'GET', path: '/api/1.0/tasks', status: 200, body: { data: roots.slice(0, 1) } });
      server.setRoute({ method: 'GET', path: '/api/1.0/tasks/root/subtasks', status: 200, body: { data: [
        { gid: 'intermediate', name: 'Unchanged intermediate', created_at: before, modified_at: before, num_subtasks: 1 },
      ] } });
      for (const gid of ['completed-root', 'root', 'intermediate', 'leaf']) {
        server.setRoute({ method: 'GET', path: `/api/1.0/tasks/${gid}/stories`, status: 200, body: {
          data: gid === 'leaf' ? [{ gid: 'comment', text: 'Deep comment', type: 'comment', created_at: within, target: { gid: 'leaf' } }] : [],
        } });
      }
    };
    setup({ ...structuredClone(initialState), snapInVersionId: 'test_snap_in_version_id' });
    server.setRoute({ method: 'GET', path: branchPath, status: 429, headers: { 'Retry-After': '10' }, body: { errors: [] } });
    const input = event();
    input.payload.event_context.mode = 'INCREMENTAL';
    input.payload.event_context.extract_from = '2024-06-01T00:00:00Z';
    const delayed = await runWorker('data-extraction', input);
    expect(delayed.callback.event_type).toBe('DATA_EXTRACTION_DELAYED');
    expect(delayed.state?.connectorState.tasks).toMatchObject({ total: 1, lastExtractedTaskIndex: 0, completed: false });
    expect(delayed.state?.connectorState.subtasks.total).toBe(0);
    server.resetRoutes();
    setup(delayed.state);
    server.setRoute({ method: 'GET', path: branchPath, status: 200, body: { data: [
      { gid: 'leaf', name: 'Changed leaf', created_at: before, modified_at: within, parent: { gid: 'intermediate' } },
    ] } });
    input.payload.event_type = EventType.ContinueExtractingData;
    const resumed = await runWorker('data-extraction', input);
    expect(resumed.callback.event_type).toBe('DATA_EXTRACTION_DONE');
    expect(resumed.state?.connectorState.tasks).toMatchObject({ total: 1, lastExtractedTaskIndex: -1, completed: true });
    expect(resumed.state?.connectorState.subtasks.total).toBe(1);
    expect(resumed.state?.connectorState.comments.total).toBe(1);
    expect(resumed.state?.connectorState.links.total).toBe(1);
    expect(server.getRequestCount('GET', '/api/1.0/tasks/completed-root/stories')).toBe(0);
    const listing = new URL(server.getRequests('GET', tasksPath).slice(-1)[0].url, server.baseUrl);
    expect(listing.searchParams.has('modified_since')).toBe(false);
  });

  it.each(['INITIAL', 'INCREMENTAL'])('resumes a depth-two traversal after a soft timeout in %s mode', async (mode) => {
    const tasksPath = '/api/1.0/projects/project/tasks';
    const before = '2024-01-01T00:00:00Z';
    const within = '2024-06-02T00:00:00Z';
    const setup = (state: unknown) => {
      server.setRoute({ method: 'GET', path: '/api/1.0/projects/project', status: 200, body: { data: { gid: 'project' } } });
      server.setRoute({ method: 'GET', path: '/worker_data_url.get', status: 200, body: {
        state: JSON.stringify(state), objects: JSON.stringify({ tasks: { extract: true }, subtasks: { extract: true }, comments: { extract: true }, links: { extract: true } }),
      } });
      server.setRoute({ method: 'GET', path: tasksPath, status: 200, body: { data: [
        { gid: 'root', created_at: before, modified_at: within, num_subtasks: 2 },
      ] } });
      server.setRoute({ method: 'GET', path: '/api/1.0/tasks', status: 200, body: { data: [] } });
      server.setRoute({ method: 'GET', path: '/api/1.0/tasks/root/subtasks', status: 200, body: { data: [
        { gid: 'intermediate', created_at: before, modified_at: within, num_subtasks: 2 },
        { gid: 'sibling', created_at: before, modified_at: within },
      ] } });
      server.setRoute({ method: 'GET', path: '/api/1.0/tasks/intermediate/subtasks', status: 200, body: { data: [
        { gid: 'leaf-1', created_at: before, modified_at: within }, { gid: 'leaf-2', created_at: before, modified_at: within },
      ] } });
      for (const gid of ['root', 'intermediate', 'leaf-1', 'leaf-2', 'sibling']) {
        server.setRoute({ method: 'GET', path: `/api/1.0/tasks/${gid}/stories`, status: 200, body: { data: [
          { gid: `comment-${gid}`, type: 'comment', text: gid, created_at: within, target: { gid } },
        ] }, delay: gid === 'leaf-1' ? 100 : undefined });
      }
    };
    setup({ ...structuredClone(initialState), snapInVersionId: 'test_snap_in_version_id' });
    const input = event();
    input.payload.event_context.mode = mode;
    if (mode === 'INCREMENTAL') input.payload.event_context.extract_from = '2024-06-01T00:00:00Z';
    const paused = await runWorker('data-extraction', input, '/api/1.0/tasks/leaf-1/stories');
    expect(paused.callback.event_type).toBe('DATA_EXTRACTION_PROGRESS');
    expect(paused.state?.connectorState.subtasks.total).toBe(2);
    expect(paused.state?.connectorState.comments.total).toBe(3);
    expect(server.getRequestCount('GET', '/api/1.0/tasks/leaf-2/stories')).toBe(0);
    expect(server.getRequestCount('GET', '/api/1.0/tasks/sibling/stories')).toBe(0);
    server.resetRoutes();
    setup(paused.state);
    input.payload.event_type = EventType.ContinueExtractingData;
    const resumed = await runWorker('data-extraction', input);
    expect(resumed.callback.event_type).toBe('DATA_EXTRACTION_DONE');
    expect(resumed.state?.connectorState.tasks.total).toBe(1);
    expect(resumed.state?.connectorState.subtasks.total).toBe(4);
    expect(resumed.state?.connectorState.comments.total).toBe(5);
    expect(resumed.state?.connectorState.links.total).toBe(4);
    expect(resumed.state?.connectorState.tasks.traversal).toBeUndefined();
    for (const gid of ['root', 'intermediate', 'leaf-1']) {
      expect(server.getRequestCount('GET', `/api/1.0/tasks/${gid}/stories`)).toBe(0);
    }
    for (const gid of ['leaf-2', 'sibling']) {
      expect(server.getRequestCount('GET', `/api/1.0/tasks/${gid}/stories`)).toBe(1);
    }
  });

  it('imports moved tasks through the filtered endpoint while still discovering nested changes', async () => {
    const before = '2024-01-01T00:00:00Z';
    const within = '2024-06-02T00:00:00Z';
    const moved = { gid: 'moved', created_at: before, modified_at: before };
    const changed = { gid: 'changed', created_at: before, modified_at: within };
    const root = { gid: 'root', created_at: before, modified_at: before, num_subtasks: 1 };
    const filteredPath = '/api/1.0/tasks';
    server.setRoute({ method: 'GET', path: '/worker_data_url.get', status: 200, body: {
      state: JSON.stringify({ ...structuredClone(initialState), snapInVersionId: 'test_snap_in_version_id' }),
      objects: JSON.stringify({ tasks: { extract: true }, subtasks: { extract: true }, links: { extract: true } }),
    } });
    const secondPage = () => new URL(server.getRequests('GET', filteredPath).slice(-1)[0].url, server.baseUrl).searchParams.has('offset');
    server.setRoute({ method: 'GET', path: filteredPath, status: 200, body: {
      get data() { return secondPage() ? [changed] : [moved]; },
      get next_page() { return secondPage() ? null : { offset: 'moves-2' }; },
    } });
    server.setRoute({ method: 'GET', path: '/api/1.0/projects/project/tasks', status: 200, body: { data: [moved, changed, root] } });
    server.setRoute({ method: 'GET', path: '/api/1.0/tasks/root/subtasks', status: 200, body: { data: [
      { gid: 'leaf', created_at: before, modified_at: within },
    ] } });
    const input = event();
    input.payload.event_context.mode = 'INCREMENTAL';
    input.payload.event_context.extract_from = '2024-06-01T00:00:00Z';
    const { callback, state } = await runWorker('data-extraction', input);
    expect(callback.event_type).toBe('DATA_EXTRACTION_DONE');
    expect(state?.connectorState.tasks.total).toBe(2);
    expect(state?.connectorState.subtasks.total).toBe(1);
    expect(state?.connectorState.links.total).toBe(1);
    const queries = server.getRequests('GET', filteredPath).map((request) => new URL(request.url, server.baseUrl).searchParams);
    expect(queries).toHaveLength(2);
    for (const query of queries) {
      expect(query.get('modified_since')).toBe('2024-06-01T00:00:00Z');
      expect(query.get('project')).toBe('project');
    }
    expect(queries[1].get('offset')).toBe('moves-2');
  });

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

  describe.each([
    ['metadata-extraction', EventType.StartExtractingMetadata, 'METADATA_EXTRACTION'],
    ['data-extraction', EventType.ContinueExtractingData, 'DATA_EXTRACTION'],
    ['attachments-extraction', EventType.ContinueExtractingAttachments, 'ATTACHMENT_EXTRACTION'],
    ['load-data', EventType.ContinueLoadingData, 'DATA_LOADING'],
    ['load-attachments', EventType.ContinueLoadingAttachments, 'ATTACHMENT_LOADING'],
  ] as const)('%s project access failures', (workerName, eventType, phase) => {
    it.each([
      [401, 'EXTERNAL_SYSTEM_NO_ACCESS'],
      [402, 'EXTERNAL_SYSTEM_NO_PERMISSION'],
      [403, 'EXTERNAL_SYSTEM_NO_PERMISSION'],
      [404, 'EXTERNAL_SYNC_UNIT_DELETED'],
    ])('emits the common error for project HTTP %i', async (status, code) => {
      server.setRoute({ method: 'GET', path: '/api/1.0/projects/project', status,
        body: { errors: [{ message: 'Project unavailable' }] } });
      const { callback } = await runWorker(workerName, event(eventType));
      expect(callback.event_type).toBe(`${phase}_ERROR`);
      expect(callback.event_data.error?.message).toBe(`ERROR_CODE=${code}`);
      expect(server.getRequestCount('GET', fieldsPath)).toBe(0);
      expect(server.getRequestCount('GET', usersPath)).toBe(0);
      expect(server.getRequestCount('POST', '/api/1.0/tasks')).toBe(0);
      expect(server.getRequestCount('POST', '/file-upload-url')).toBe(0);
    });

    it('delays on project rate limits without a common error', async () => {
      server.setRoute({ method: 'GET', path: '/api/1.0/projects/project', status: 429,
        headers: { 'Retry-After': '37' }, body: { errors: [] } });
      const { callback } = await runWorker(workerName, event(eventType));
      expect(callback.event_type).toBe(`${phase}_DELAYED`);
      expect(callback.event_data.delay).toBe(37);
      expect(callback.event_data.error).toBeUndefined();
    });
  });

  it.each([
    [401, 'EXTERNAL_SYSTEM_NO_ACCESS'],
    [402, 'EXTERNAL_SYSTEM_NO_PERMISSION'],
    [403, 'EXTERNAL_SYSTEM_NO_PERMISSION'],
    [404, 'EXTERNAL_SYSTEM_NO_ACCESS'],
  ])('emits a common error for workspace project listing HTTP %i', async (status, code) => {
    server.setRoute({ method: 'GET', path: '/api/1.0/workspaces/workspace/projects', status, body: { errors: [] } });
    const { callback } = await runWorker('external-sync-units-extraction', event(EventType.StartExtractingExternalSyncUnits));
    expect(callback.event_type).toBe('EXTERNAL_SYNC_UNIT_EXTRACTION_ERROR');
    expect(callback.event_data.error?.message).toBe(`ERROR_CODE=${code}`);
  });

  it.each([[401, 'EXTERNAL_SYSTEM_NO_ACCESS'], [402, 'EXTERNAL_SYSTEM_NO_PERMISSION'],
    [403, 'EXTERNAL_SYSTEM_NO_PERMISSION']])('emits a common error when required user extraction returns HTTP %i', async (status, code) => {
    server.setRoute({ method: 'GET', path: usersPath, status, body: { errors: [] } });
    const { callback } = await runWorker('data-extraction');
    expect(callback.event_type).toBe('DATA_EXTRACTION_ERROR');
    expect(callback.event_data.error?.message).toBe(`ERROR_CODE=${code}`);
  });

  it('persists the declared task field IDs after metadata extraction', async () => {
    server.setRoute({ method: 'GET', path: fieldsPath, status: 200,
      body: { data: [{ custom_field: { gid: '12345', name: 'Project field', type: 'text' } }] } });
    server.setRoute({ method: 'GET', path: sectionsPath, status: 200, body: { data: [] } });
    const { callback, state } = await runWorker('metadata-extraction', event(EventType.StartExtractingMetadata));
    expect(callback.event_type).toBe('METADATA_EXTRACTION_DONE');
    expect(state?.connectorState.taskFieldIds).toContain('12345');
  });

  it('resumes group extraction through the real SDK after a membership rate limit', async () => {
    const teamPath = '/api/1.0/workspaces/workspace/teams';
    const memberPath = (id: string) => `/api/1.0/teams/${id}/team_memberships`;
    const setup = (state: unknown) => {
      server.setRoute({ method: 'GET', path: '/api/1.0/projects/project', status: 200, body: { data: { gid: 'project' } } });
      server.setRoute({ method: 'GET', path: '/worker_data_url.get', status: 200,
        body: { state: JSON.stringify(state), objects: JSON.stringify({ groups: { extract: true }, group_memberships: { extract: true } }) } });
      server.setRoute({ method: 'GET', path: teamPath, status: 200,
        body: { data: [{ gid: 'team1' }, { gid: 'team2' }] } });
    };
    setup({ ...structuredClone(initialState), snapInVersionId: 'test_snap_in_version_id' });
    server.setRoute({ method: 'GET', path: memberPath('team1'), status: 200, body: { data: [{ user: { gid: 'u1' } }] } });
    server.setRoute({ method: 'GET', path: memberPath('team2'), status: 429,
      headers: { 'Retry-After': '10' }, body: { errors: [] } });
    const paused = await runWorker('data-extraction');
    expect(paused.callback.event_type).toBe('DATA_EXTRACTION_DELAYED');
    expect(paused.state?.connectorState.groups).toMatchObject({ total: 1, lastExtractedTeamIndex: 0 });
    server.resetRoutes();
    setup(paused.state);
    server.setRoute({ method: 'GET', path: memberPath('team2'), status: 200, body: { data: [{ user: { gid: 'u2' } }] } });
    const resumed = await runWorker('data-extraction', event(EventType.ContinueExtractingData));
    expect(resumed.callback.event_type).toBe('DATA_EXTRACTION_DONE');
    expect(resumed.state?.connectorState.groups).toMatchObject({ total: 2, completed: true, lastExtractedTeamIndex: -1 });
    expect(resumed.state?.connectorState.group_memberships.total).toBe(2);
    expect(server.getRequestCount('GET', memberPath('team1'))).toBe(0);
    expect(server.getRequestCount('GET', memberPath('team2'))).toBe(1);
  });

  it.each([401, 403, 404])('stops reverse sync and preserves its cursor when project access changes to HTTP %i', async (status) => {
    serveLoaderFile();
    server.setRoute({ method: 'GET', path: targetMapperPath, status: 404, body: {} });
    server.setRoute({ method: 'GET', path: '/api/1.0/projects/project', status: 200,
      body: { data: { gid: 'project' } }, succeedThenFail: { successCount: 1, errorStatus: status } });
    server.setRoute({ method: 'POST', path: '/api/1.0/tasks', status, body: { errors: [] } });
    const { callback, state } = await runWorker('load-data', event(EventType.ContinueLoadingData));
    const code = status === 401 ? 'EXTERNAL_SYSTEM_NO_ACCESS'
      : status === 403 ? 'EXTERNAL_SYSTEM_NO_PERMISSION' : 'EXTERNAL_SYNC_UNIT_DELETED';
    expect(callback.event_type).toBe('DATA_LOADING_ERROR');
    expect(callback.event_data.error?.message).toBe(`ERROR_CODE=${code}`);
    expect(state?.sdkState.fromDevRev).toMatchObject({ filesToLoad: [{ lineToProcess: 0, completed: false }] });
    expect(server.getRequestCount('POST', '/api/1.0/tasks')).toBe(1);
  });

  it('keeps a missing reverse-sync item as an item failure while the project is accessible', async () => {
    serveLoaderFile();
    server.setRoute({ method: 'GET', path: targetMapperPath, status: 404, body: {} });
    server.setRoute({ method: 'POST', path: '/api/1.0/tasks', status: 404, body: { errors: [] } });
    const { callback } = await runWorker('load-data', event(EventType.ContinueLoadingData));
    expect(callback.event_type).toBe('DATA_LOADING_DONE');
    expect(callback.event_data.error).toBeUndefined();
    expect(callback.event_data.reports).toMatchObject([{ item_type: 'tasks', failed: 1 }]);
  });

  it('emits deletion when the project disappears after the initial metadata check', async () => {
    server.setRoute({ method: 'GET', path: '/api/1.0/projects/project', status: 200,
      body: { data: { gid: 'project' } }, succeedThenFail: { successCount: 1, errorStatus: 404 } });
    server.setRoute({ method: 'GET', path: fieldsPath, status: 404, body: { errors: [] } });
    const { callback } = await runWorker('metadata-extraction', event(EventType.StartExtractingMetadata));
    expect(callback.event_type).toBe('METADATA_EXTRACTION_ERROR');
    expect(callback.event_data.error?.message).toBe('ERROR_CODE=EXTERNAL_SYNC_UNIT_DELETED');
    expect(server.getRequestCount('GET', '/api/1.0/projects/project')).toBe(2);
    expect(server.getRequestCount('GET', sectionsPath)).toBe(0);
  });

  it('does not label a metadata 404 as project deletion when the project is accessible', async () => {
    server.setRoute({ method: 'GET', path: fieldsPath, status: 404, body: { errors: [] } });
    const { callback } = await runWorker('metadata-extraction', event(EventType.StartExtractingMetadata));
    expect(callback.event_type).toBe('METADATA_EXTRACTION_ERROR');
    expect(callback.event_data.error?.message).not.toContain('ERROR_CODE=');
    expect(server.getRequestCount('GET', '/api/1.0/projects/project')).toBe(2);
  });

  it('uses the SDK metadata timeout default and emits exactly one progress callback', async () => {
    server.setRoute({ method: 'GET', path: fieldsPath, status: 200, body: { data: [] }, delay: 100 });
    server.setRoute({ method: 'GET', path: sectionsPath, status: 200, body: { data: [] } });
    const { callback, state } = await runWorker('metadata-extraction', event(EventType.StartExtractingMetadata), fieldsPath);
    expect(callback.event_type).toBe('METADATA_EXTRACTION_PROGRESS');
    expect(state?.stateVersion).toBe(2);
  });

  it.each([['120', 120], ['0', 0], [undefined, 60], ['invalid', 60]])(
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

  it('preserves a zero-second metadata delay through the SDK callback', async () => {
    server.setRoute({ method: 'GET', path: fieldsPath, status: 429,
      headers: { 'Retry-After': '0' }, body: { errors: [] } });
    const { callback } = await runWorker('metadata-extraction', event(EventType.StartExtractingMetadata));
    expect(callback.event_type).toBe('METADATA_EXTRACTION_DELAYED');
    expect(callback.event_data.delay).toBe(0);
    expect(server.getRequestCount('GET', sectionsPath)).toBe(0);
  });

  it('honors HTTP-date retry deadlines through the SDK callback', async () => {
    const retryAt = new Date(Date.now() + 300000).toUTCString();
    server.setRoute({ method: 'GET', path: usersPath, status: 429,
      headers: { 'Retry-After': retryAt }, body: { errors: [] } });
    const { callback } = await runWorker('data-extraction');
    expect(callback.event_type).toBe('DATA_EXTRACTION_DELAYED');
    expect(callback.event_data.delay).toBeGreaterThanOrEqual(290);
    expect(callback.event_data.delay).toBeLessThanOrEqual(300);
    expect(server.getRequestCount('GET', usersPath)).toBe(1);
  });

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
      if (status === 403) {
        await expect(filterAlreadyMappedAttachments(attachments, adapter)).rejects.toThrow();
      } else {
        expect(await filterAlreadyMappedAttachments(attachments, adapter)).toEqual(status === 200 ? [] : attachments);
      }
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

  it.each(['23', '0'])('propagates loader Retry-After %s and retains the item cursor', async (retryAfter) => {
    serveLoaderFile();
    server.setRoute({ method: 'GET', path: targetMapperPath, status: 404 });
    server.setRoute({ method: 'POST', path: '/api/1.0/tasks', status: 429,
      headers: { 'Retry-After': retryAfter }, body: { errors: [] } });
    const { callback, state } = await runWorker('load-data', event(EventType.ContinueLoadingData));
    expect(callback.event_type).toBe('DATA_LOADING_DELAYED');
    expect(callback.event_data.delay).toBe(Number(retryAfter));
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
});
