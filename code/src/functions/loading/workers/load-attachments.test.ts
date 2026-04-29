import { LoaderEventType, processTask } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { handleLoadingError, resolveExternalId } from '@utils/loading-helpers';

jest.mock('@devrev/ts-adaas', () => ({
  processTask: jest.fn(),
  LoaderEventType: jest.requireActual('@devrev/ts-adaas').LoaderEventType,
}));
jest.mock('@asana/api-client');
jest.mock('@utils/loading-helpers');
jest.mock('axios', () => {
  const mockAxios: Record<string, unknown> = {
    get: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    isAxiosError: jest.fn(),
    defaults: { headers: { common: {} } },
  };
  mockAxios.create = jest.fn(() => mockAxios);
  return { default: mockAxios, __esModule: true, ...mockAxios };
});

const mockProcessTask = processTask as jest.Mock;
const mockHandleLoadingError = handleLoadingError as jest.Mock;
const mockResolveExternalId = resolveExternalId as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./load-attachments');

const captured = mockProcessTask.mock.calls[0][0];
const taskFn: (params: { adapter: any }) => Promise<void> = captured.task;
const onTimeoutFn: (params: { adapter: any }) => Promise<void> = captured.onTimeout;

const mockAsanaClient = {
  createTaskAttachment: jest.fn(),
};

function createMockAdapter() {
  return {
    state: {},
    event: {
      payload: {
        connection_data: { key: 'test-key', org_id: 'workspace-1' },
        event_context: { external_sync_unit_id: 'project-123', sync_unit_id: 'su-1' },
      },
    },
    emit: jest.fn(),
    loadAttachments: jest.fn().mockResolvedValue(undefined),
  } as any;
}

describe('load-attachments worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsanaClient as unknown as jest.Mock).mockImplementation(() => mockAsanaClient);
    mockResolveExternalId.mockResolvedValue(null);
    mockHandleLoadingError.mockReturnValue({ error: 'test error' });
  });

  describe('processTask registration', () => {
    it('should register task and onTimeout handlers', () => {
      expect(taskFn).toBeDefined();
      expect(onTimeoutFn).toBeDefined();
    });

    it('should call loadAttachments with create function', async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });
      expect(adapter.loadAttachments).toHaveBeenCalledTimes(1);
      expect(adapter.loadAttachments).toHaveBeenCalledWith({ create: expect.any(Function) });
    });

    it('should emit AttachmentLoadingDone on success', async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });
      expect(adapter.emit).toHaveBeenCalledWith(LoaderEventType.AttachmentLoadingDone);
    });

    it('should emit AttachmentLoadingDelayed on rate limit', async () => {
      const adapter = createMockAdapter();
      adapter.loadAttachments.mockRejectedValue(new Error('rate limited'));
      mockHandleLoadingError.mockReturnValue({ delay: 60 });

      await taskFn({ adapter });
      expect(adapter.emit).toHaveBeenCalledWith(LoaderEventType.AttachmentLoadingDelayed, { delay: 60 });
    });

    it('should emit AttachmentLoadingError on other errors', async () => {
      const adapter = createMockAdapter();
      adapter.loadAttachments.mockRejectedValue(new Error('fail'));
      mockHandleLoadingError.mockReturnValue({ error: 'Upload failed' });

      await taskFn({ adapter });
      expect(adapter.emit).toHaveBeenCalledWith(LoaderEventType.AttachmentLoadingError, {
        error: { message: 'Upload failed' },
      });
    });

    it('should emit AttachmentLoadingProgress on timeout', async () => {
      const adapter = createMockAdapter();
      await onTimeoutFn({ adapter });
      expect(adapter.emit).toHaveBeenCalledWith(LoaderEventType.AttachmentLoadingProgress);
    });
  });

  describe('createAttachment callback', () => {
    let createAttachment: any;

    beforeEach(async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });
      createAttachment = adapter.loadAttachments.mock.calls[0][0].create;
    });

    it('should download file and upload to Asana', async () => {
      mockResolveExternalId.mockResolvedValue('asana-task-1');
      const axios = (await import('axios')).default;
      (axios.get as jest.Mock).mockResolvedValue({ data: Buffer.from('file content') });
      mockAsanaClient.createTaskAttachment.mockResolvedValue({
        data: { data: { gid: 'attachment-1' } },
      });

      const result = await createAttachment({
        item: {
          parent_id: 'devrev-task-1',
          file_name: 'test.pdf',
          url: 'https://devrev.ai/files/123',
        },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('attachment-1');
      expect(axios.get).toHaveBeenCalledWith('https://devrev.ai/files/123', { responseType: 'arraybuffer' });
      expect(mockAsanaClient.createTaskAttachment).toHaveBeenCalledWith(
        'asana-task-1',
        expect.any(Buffer),
        'test.pdf'
      );
    });

    it('should return error when parent cannot be resolved', async () => {
      mockResolveExternalId.mockResolvedValue(null);

      const result = await createAttachment({
        item: { parent_id: 'unknown-task', file_name: 'test.pdf', url: 'https://example.com/file' },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.error).toContain('Cannot resolve parent');
    });

    it('should return error when parent_id is missing', async () => {
      const result = await createAttachment({
        item: { file_name: 'test.pdf', url: 'https://example.com/file' },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.error).toContain('Cannot resolve parent');
    });

    it('should handle download failure', async () => {
      mockResolveExternalId.mockResolvedValue('asana-task-1');
      const axios = (await import('axios')).default;
      (axios.get as jest.Mock).mockRejectedValue(new Error('Download failed'));
      mockHandleLoadingError.mockReturnValue({ error: 'Download failed' });

      const result = await createAttachment({
        item: { parent_id: 'devrev-task-1', file_name: 'test.pdf', url: 'https://example.com/file' },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.error).toBeDefined();
    });
  });
});
