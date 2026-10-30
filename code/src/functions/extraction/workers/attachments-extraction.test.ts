import { processExtractionTask } from '@devrev/airsync-sdk';
import axios from 'axios';

import { AsanaClient } from '@asana/api-client';
import { handleExtractionError } from '@utils/data-helpers';

jest.mock('@devrev/airsync-sdk', () => ({
  ...jest.requireActual('@devrev/airsync-sdk'),
  processExtractionTask: jest.fn(),
}));
jest.mock('axios');
jest.mock('@asana/api-client');
jest.mock('@utils/data-helpers');

const mockProcessTask = processExtractionTask as jest.Mock;
const mockAxiosGet = axios.get as jest.Mock;
const mockHandleExtractionError = handleExtractionError as jest.Mock;
const MockAsanaClient = AsanaClient as jest.MockedClass<typeof AsanaClient>;
const mockGetAttachment = jest.fn();

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./attachments-extraction');

const captured = mockProcessTask.mock.calls[0][0];
const taskFn: (params: { adapter: any }) => Promise<any> = captured.task;

const event = { payload: { connection_data: { key: 'k', org_id: 'w' }, event_context: {} } } as any;
const staleUrl = 'https://asanausercontent.com/us1/assets/1/att1/abc?e=1789755944&v=0&t=stale';
const freshUrl = 'https://asanausercontent.com/us1/assets/1/att1/abc?e=1790272400&v=0&t=fresh';

function createMockAdapter(streamAttachmentsReturn?: any) {
  return {
    event,
    streamAttachments: jest.fn().mockResolvedValue(streamAttachmentsReturn ?? { status: 'success' }),
  } as any;
}

describe('attachments-extraction worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockAsanaClient.mockImplementation(() => ({ getAttachment: mockGetAttachment, getProject: jest.fn().mockResolvedValue({}) }) as any);
  });

  describe('task', () => {
    it('should call streamAttachments with stream function and batchSize 10', async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(adapter.streamAttachments).toHaveBeenCalledWith({
        stream: expect.any(Function),
        batchSize: 10,
      });
    });

    it('should return success when streamAttachments returns no error or delay', async () => {
      const adapter = createMockAdapter(undefined);
      const taskResult = await taskFn({ adapter });

      expect(taskResult).toEqual({ status: 'success' });
    });

    it('should preserve progress when attachment streaming pauses at the timeout', async () => {
      const adapter = createMockAdapter({ status: 'progress' });

      expect(await taskFn({ adapter })).toEqual({ status: 'progress' });
    });

    it('should return delay when streamAttachments returns delay', async () => {
      const adapter = createMockAdapter({ status: 'delay', delaySeconds: 120 });
      const taskResult = await taskFn({ adapter });

      expect(taskResult).toEqual({ status: 'delay', delaySeconds: 120, });
      expect(taskResult.status).not.toBe('success');
    });

    it('should return error when streamAttachments returns error', async () => {
      const errorObj = { message: 'download failed' };
      const adapter = createMockAdapter({ status: 'error', error: errorObj });
      const taskResult = await taskFn({ adapter });

      expect(taskResult).toEqual({ status: 'error', error: errorObj, });
      expect(taskResult.status).not.toBe('success');
    });
  });

  describe('stream function', () => {
    let streamFn: (params: any) => Promise<any>;

    beforeEach(async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });
      streamFn = adapter.streamAttachments.mock.calls[0][0].stream;
    });

    it('should fetch a fresh download_url by attachment id instead of using the stored url', async () => {
      const mockResponse = { data: 'binary-data' };
      mockGetAttachment.mockResolvedValue({ data: { data: { download_url: freshUrl } } });
      mockAxiosGet.mockResolvedValue(mockResponse);

      const result = await streamFn({ item: { id: 'att1', url: staleUrl }, event });

      expect(mockGetAttachment).toHaveBeenCalledWith('att1');
      expect(mockAxiosGet).toHaveBeenCalledWith(freshUrl, {
        responseType: 'stream',
        headers: { 'Accept-Encoding': 'identity' },
      });
      expect(mockAxiosGet).not.toHaveBeenCalledWith(staleUrl, expect.anything());
      expect(result).toEqual({ status: 'success', httpStream: mockResponse });
    });

    it('should not create a new Asana client per attachment', async () => {
      mockGetAttachment.mockResolvedValue({ data: { data: { download_url: freshUrl } } });
      mockAxiosGet.mockResolvedValue({ data: 'binary-data' });

      await streamFn({ item: { id: 'att1', url: staleUrl }, event });
      await streamFn({ item: { id: 'att2', url: staleUrl }, event });

      expect(MockAsanaClient).toHaveBeenCalledTimes(1);
      expect(mockGetAttachment).toHaveBeenCalledTimes(2);
    });

    it('should return an error without downloading when Asana has no download_url', async () => {
      mockGetAttachment.mockResolvedValue({ data: { data: { download_url: null } } });

      const result = await streamFn({ item: { id: 'att1', url: staleUrl }, event });

      expect(mockAxiosGet).not.toHaveBeenCalled();
      expect(result.status).toBe('error');
      expect(result.error.message).toContain('att1');
    });

    it('should return delay when refreshing the url is rate limited', async () => {
      const error = new Error('rate limited');
      mockGetAttachment.mockRejectedValue(error);
      mockHandleExtractionError.mockReturnValue({ delay: 60 });

      const result = await streamFn({ item: { id: 'att1', url: staleUrl }, event });

      expect(mockHandleExtractionError).toHaveBeenCalledWith(error);
      expect(mockAxiosGet).not.toHaveBeenCalled();
      expect(result).toEqual({ status: 'delay', delaySeconds: 60 });
    });

    it('should return delay when the download is rate limited', async () => {
      const error = new Error('rate limited');
      mockGetAttachment.mockResolvedValue({ data: { data: { download_url: freshUrl } } });
      mockAxiosGet.mockRejectedValue(error);
      mockHandleExtractionError.mockReturnValue({ delay: 60 });

      const result = await streamFn({ item: { id: 'att1', url: staleUrl }, event });

      expect(mockHandleExtractionError).toHaveBeenCalledWith(error);
      expect(result).toEqual({ status: 'delay', delaySeconds: 60 });
    });

    it('should return error when the download fails without delay', async () => {
      const error = new Error('server error');
      const extractionError = { message: 'server error' };
      mockGetAttachment.mockResolvedValue({ data: { data: { download_url: freshUrl } } });
      mockAxiosGet.mockRejectedValue(error);
      mockHandleExtractionError.mockReturnValue({ error: extractionError });

      const result = await streamFn({ item: { id: 'att1', url: staleUrl }, event });

      expect(result).toEqual({ status: 'error', error: extractionError });
    });
  });

  describe('onTimeout', () => {
    it('should use the SDK timeout handler', () => {
      expect(captured.onTimeout).toBeUndefined();
    });
  });
});
