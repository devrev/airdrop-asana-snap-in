import { ExtractorEventType, processTask } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { ItemType } from '@asana/constants';
import {
  enrichMetadataWithCustomFields,
  enrichMetadataWithSections,
  enrichMetadataWithSubtaskStages,
} from '@utils/metadata-helpers';

jest.mock('@devrev/ts-adaas', () => ({
  processTask: jest.fn(),
  ExtractorEventType: jest.requireActual('@devrev/ts-adaas').ExtractorEventType,
}));
jest.mock('@asana/api-client');
jest.mock('@asana/external_domain_metadata.json', () => ({ record_types: [] }), { virtual: true });
jest.mock('@utils/metadata-helpers');

const mockProcessTask = processTask as jest.Mock;
const mockEnrichCustomFields = enrichMetadataWithCustomFields as jest.Mock;
const mockEnrichSections = enrichMetadataWithSections as jest.Mock;
const mockEnrichSubtaskStages = enrichMetadataWithSubtaskStages as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./metadata-extraction');

const captured = mockProcessTask.mock.calls[0][0];
const taskFn: (params: { adapter: any }) => Promise<void> = captured.task;
const onTimeoutFn: (params: { adapter: any }) => Promise<void> = captured.onTimeout;

function createMockAdapter() {
  const mockPush = jest.fn();
  return {
    event: {
      payload: {
        connection_data: { key: 'test-key', org_id: 'workspace-123' },
        event_context: { external_sync_unit_id: 'project-456' },
      },
    },
    emit: jest.fn(),
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

    it('should enrich metadata, push to repo, and emit MetadataExtractionDone', async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(mockEnrichCustomFields).toHaveBeenCalled();
      expect(mockEnrichSections).toHaveBeenCalled();
      expect(mockEnrichSubtaskStages).toHaveBeenCalled();
      expect(adapter.getRepo).toHaveBeenCalledWith(ItemType.EXTERNAL_DOMAIN_METADATA);
      expect(adapter._mockPush).toHaveBeenCalledWith([expect.any(Object)]);
      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.MetadataExtractionDone);
    });

    it('should emit MetadataExtractionError and return early when enrichMetadataWithCustomFields returns error', async () => {
      const errorMsg = 'Failed to fetch custom fields';
      mockEnrichCustomFields.mockResolvedValue(errorMsg);

      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.MetadataExtractionError, {
        error: { message: errorMsg },
      });
      expect(mockEnrichSections).not.toHaveBeenCalled();
      expect(mockEnrichSubtaskStages).not.toHaveBeenCalled();
    });

    it('should emit MetadataExtractionError when enrichMetadataWithSections returns error', async () => {
      const errorMsg = 'Failed to fetch sections';
      mockEnrichSections.mockResolvedValue(errorMsg);

      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(mockEnrichCustomFields).toHaveBeenCalled();
      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.MetadataExtractionError, {
        error: { message: errorMsg },
      });
      expect(mockEnrichSubtaskStages).not.toHaveBeenCalled();
    });

    it('should create AsanaClient from adapter event', async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(AsanaClient).toHaveBeenCalledWith(adapter.event);
    });
  });

  describe('onTimeout', () => {
    it('should emit MetadataExtractionError with timeout message', async () => {
      const adapter = createMockAdapter();
      await onTimeoutFn({ adapter });

      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.MetadataExtractionError, {
        error: {
          message: 'Failed to extract metadata from Asana due to timeout. Please check the logs for more details.',
        },
      });
    });
  });
});
