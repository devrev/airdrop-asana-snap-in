import { processTask } from '@devrev/ts-adaas';
import axios from 'axios';

import { handleExtractionError } from '@utils/data-helpers';

const ExtractorEventType = {
  AttachmentExtractionDone: 'ATTACHMENT_EXTRACTION_DONE',
  AttachmentExtractionDelayed: 'ATTACHMENT_EXTRACTION_DELAYED',
  AttachmentExtractionError: 'ATTACHMENT_EXTRACTION_ERROR',
  AttachmentExtractionProgress: 'ATTACHMENT_EXTRACTION_PROGRESS',
} as const;

jest.mock('@devrev/ts-adaas', () => ({
  processTask: jest.fn(),
  ExtractorEventType: {
    AttachmentExtractionDone: 'ATTACHMENT_EXTRACTION_DONE',
    AttachmentExtractionDelayed: 'ATTACHMENT_EXTRACTION_DELAYED',
    AttachmentExtractionError: 'ATTACHMENT_EXTRACTION_ERROR',
    AttachmentExtractionProgress: 'ATTACHMENT_EXTRACTION_PROGRESS',
  },
}));
jest.mock('axios');
jest.mock('@utils/data-helpers');

const mockProcessTask = processTask as jest.Mock;
const mockAxiosGet = axios.get as jest.Mock;
const mockHandleExtractionError = handleExtractionError as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./attachments-extraction');

const captured = mockProcessTask.mock.calls[0][0];
const taskFn: (params: { adapter: any }) => Promise<void> = captured.task;
const onTimeoutFn: (params: { adapter: any }) => Promise<void> = captured.onTimeout;

function createMockAdapter(streamAttachmentsReturn?: any) {
  return {
    emit: jest.fn(),
    streamAttachments: jest.fn().mockResolvedValue(streamAttachmentsReturn ?? undefined),
  } as any;
}

describe('attachments-extraction worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('task', () => {
    it('should call streamAttachments with stream function and batchSize 50', async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(adapter.streamAttachments).toHaveBeenCalledWith({
        stream: expect.any(Function),
        batchSize: 50,
      });
    });

    it('should emit AttachmentExtractionDone when streamAttachments returns no error or delay', async () => {
      const adapter = createMockAdapter(undefined);
      await taskFn({ adapter });

      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.AttachmentExtractionDone);
    });

    it('should emit AttachmentExtractionDelayed when streamAttachments returns delay', async () => {
      const adapter = createMockAdapter({ delay: 120 });
      await taskFn({ adapter });

      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.AttachmentExtractionDelayed, {
        delay: 120,
      });
      expect(adapter.emit).not.toHaveBeenCalledWith(ExtractorEventType.AttachmentExtractionDone);
    });

    it('should emit AttachmentExtractionError when streamAttachments returns error', async () => {
      const errorObj = { message: 'download failed' };
      const adapter = createMockAdapter({ error: errorObj });
      await taskFn({ adapter });

      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.AttachmentExtractionError, {
        error: errorObj,
      });
      expect(adapter.emit).not.toHaveBeenCalledWith(ExtractorEventType.AttachmentExtractionDone);
    });
  });

  describe('stream function', () => {
    let streamFn: (params: any) => Promise<any>;

    beforeEach(async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });
      streamFn = adapter.streamAttachments.mock.calls[0][0].stream;
    });

    it('should download attachment and return httpStream on success', async () => {
      const mockResponse = { data: 'binary-data' };
      mockAxiosGet.mockResolvedValue(mockResponse);

      const result = await streamFn({ item: { url: 'https://example.com/file.pdf' } });

      expect(mockAxiosGet).toHaveBeenCalledWith('https://example.com/file.pdf', {
        responseType: 'stream',
        headers: { 'Accept-Encoding': 'identity' },
      });
      expect(result).toEqual({ httpStream: mockResponse });
    });

    it('should return delay when axios error results in rate limit delay', async () => {
      const error = new Error('rate limited');
      mockAxiosGet.mockRejectedValue(error);
      mockHandleExtractionError.mockReturnValue({ delay: 60 });

      const result = await streamFn({ item: { url: 'https://example.com/file.pdf' } });

      expect(mockHandleExtractionError).toHaveBeenCalledWith(error);
      expect(result).toEqual({ delay: 60 });
    });

    it('should return error when axios error has no delay', async () => {
      const error = new Error('server error');
      const extractionError = { message: 'server error' };
      mockAxiosGet.mockRejectedValue(error);
      mockHandleExtractionError.mockReturnValue({ error: extractionError });

      const result = await streamFn({ item: { url: 'https://example.com/file.pdf' } });

      expect(result).toEqual({ error: extractionError });
    });
  });

  describe('onTimeout', () => {
    it('should emit AttachmentExtractionProgress', async () => {
      const adapter = createMockAdapter();
      await onTimeoutFn({ adapter });

      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.AttachmentExtractionProgress);
    });
  });
});
