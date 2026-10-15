import { processExtractionTask } from '@devrev/airsync-sdk';

import { AsanaClient } from '@asana/api-client';
import { ItemType } from '@asana/constants';
import {
  enrichMetadataWithCustomFields,
  enrichMetadataWithSections,
  enrichMetadataWithSubtaskStages,
} from '@utils/metadata-helpers';

jest.mock('@devrev/airsync-sdk', () => ({
  processExtractionTask: jest.fn(),
}));
jest.mock('@asana/api-client');
jest.mock('@asana/external_domain_metadata.json', () => ({ record_types: [] }), { virtual: true });
jest.mock('@utils/metadata-helpers');

const mockProcessTask = processExtractionTask as jest.Mock;
const mockEnrichCustomFields = enrichMetadataWithCustomFields as jest.Mock;
const mockEnrichSections = enrichMetadataWithSections as jest.Mock;
const mockEnrichSubtaskStages = enrichMetadataWithSubtaskStages as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./metadata-extraction');

const captured = mockProcessTask.mock.calls[0][0];
const taskFn: (params: { adapter: any }) => Promise<any> = captured.task;

function createMockAdapter() {
  const mockPush = jest.fn();
  return {
    event: {
      payload: {
        connection_data: { key: 'test-key', org_id: 'workspace-123' },
        event_context: { external_sync_unit_id: 'project-456' },
      },
    },
    initializeRepos: jest.fn(),
    getRepo: jest.fn().mockReturnValue({ push: mockPush }),
    _mockPush: mockPush,
  } as any;
}

describe('metadata-extraction worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsanaClient as unknown as jest.Mock).mockImplementation(() => ({}));
    mockEnrichCustomFields.mockResolvedValue(undefined);
    mockEnrichSections.mockResolvedValue(undefined);
    mockEnrichSubtaskStages.mockReturnValue(undefined);
  });

  describe('task', () => {
    it('should initialize repos with EXTERNAL_DOMAIN_METADATA item type', async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(adapter.initializeRepos).toHaveBeenCalledWith([{ itemType: ItemType.EXTERNAL_DOMAIN_METADATA }]);
    });

    it('should enrich metadata, push to repo, and return success', async () => {
      const adapter = createMockAdapter();
      const taskResult = await taskFn({ adapter });

      expect(mockEnrichCustomFields).toHaveBeenCalled();
      expect(mockEnrichSections).toHaveBeenCalled();
      expect(mockEnrichSubtaskStages).toHaveBeenCalled();
      expect(adapter.getRepo).toHaveBeenCalledWith(ItemType.EXTERNAL_DOMAIN_METADATA);
      expect(adapter._mockPush).toHaveBeenCalledWith([expect.any(Object)]);
      expect(taskResult).toEqual({ status: 'success' });
    });

    it('should propagate upload failure instead of reporting success', async () => {
      const adapter = createMockAdapter();
      adapter._mockPush.mockRejectedValue(new Error('Artifact upload failed'));

      await expect(taskFn({ adapter })).rejects.toThrow('Artifact upload failed');
    });

    it('should return error and return early when enrichMetadataWithCustomFields returns error', async () => {
      const errorMsg = 'Failed to fetch custom fields';
      mockEnrichCustomFields.mockResolvedValue({ error: { message: errorMsg } });

      const adapter = createMockAdapter();
      const taskResult = await taskFn({ adapter });

      expect(taskResult).toEqual({ status: 'error', error: { message: errorMsg }, });
      expect(mockEnrichSections).not.toHaveBeenCalled();
      expect(mockEnrichSubtaskStages).not.toHaveBeenCalled();
    });

    it('should return error when enrichMetadataWithSections returns error', async () => {
      const errorMsg = 'Failed to fetch sections';
      mockEnrichSections.mockResolvedValue({ error: { message: errorMsg } });

      const adapter = createMockAdapter();
      const taskResult = await taskFn({ adapter });

      expect(mockEnrichCustomFields).toHaveBeenCalled();
      expect(taskResult).toEqual({ status: 'error', error: { message: errorMsg }, });
      expect(mockEnrichSubtaskStages).not.toHaveBeenCalled();
    });

    it('should return delay and return early when custom fields are rate limited', async () => {
      mockEnrichCustomFields.mockResolvedValue({ delay: 120 });

      const adapter = createMockAdapter();
      const taskResult = await taskFn({ adapter });

      expect(taskResult).toEqual({ status: 'delay', delaySeconds: 120 });
      expect(mockEnrichSections).not.toHaveBeenCalled();
      expect(adapter._mockPush).not.toHaveBeenCalled();
    });

    it('should return delay when sections are rate limited', async () => {
      mockEnrichSections.mockResolvedValue({ delay: 45 });

      const adapter = createMockAdapter();
      const taskResult = await taskFn({ adapter });

      expect(taskResult).toEqual({ status: 'delay', delaySeconds: 45 });
      expect(mockEnrichSubtaskStages).not.toHaveBeenCalled();
      expect(adapter._mockPush).not.toHaveBeenCalled();
    });

    it('should create AsanaClient from adapter event', async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(AsanaClient).toHaveBeenCalledWith(adapter.event);
    });
  });

  describe('onTimeout', () => {
    it('should use the SDK timeout handler', () => {
      expect(captured.onTimeout).toBeUndefined();
    });
  });
});
