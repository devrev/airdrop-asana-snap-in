import { ExtractorEventType, processTask } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { buildExternalSyncUnits, checkUserWorkspaceRole, fetchAllProjects } from '@utils/external-sync-units-helpers';
import { serializeError } from '@utils/serialize-error';

jest.mock('@devrev/ts-adaas', () => ({
  processTask: jest.fn(),
  ExtractorEventType: jest.requireActual('@devrev/ts-adaas').ExtractorEventType,
  AirSyncDefaultItemTypes: jest.requireActual('@devrev/ts-adaas').AirSyncDefaultItemTypes,
}));
jest.mock('@asana/api-client');
jest.mock('@utils/external-sync-units-helpers');
jest.mock('@utils/serialize-error');

const mockProcessTask = processTask as jest.Mock;
const mockCheckUserWorkspaceRole = checkUserWorkspaceRole as jest.Mock;
const mockFetchAllProjects = fetchAllProjects as jest.Mock;
const mockBuildExternalSyncUnits = buildExternalSyncUnits as jest.Mock;
const mockSerializeError = serializeError as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./external-sync-units-extraction');

const captured = mockProcessTask.mock.calls[0][0];
const taskFn: (params: { adapter: any }) => Promise<void> = captured.task;
const onTimeoutFn: (params: { adapter: any }) => Promise<void> = captured.onTimeout;

function createMockAdapter() {
  return {
    event: {
      payload: {
        connection_data: { key: 'test-key', org_id: 'workspace-123' },
        event_context: { external_sync_unit_id: 'project-456' },
      },
    },
    emit: jest.fn(),
    initializeRepos: jest.fn(),
    getRepo: jest.fn().mockReturnValue({ push: jest.fn() }),
  } as any;
}

describe('external-sync-units-extraction worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    (AsanaClient as unknown as jest.Mock).mockImplementation(() => ({}));
    mockCheckUserWorkspaceRole.mockResolvedValue(undefined);
    mockSerializeError.mockImplementation((e: any) => e?.message ?? String(e));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('task', () => {
    it('should fetch projects, build ESUs, and emit ExternalSyncUnitExtractionDone', async () => {
      const mockProjects = [{ gid: '1', name: 'Project 1' }];
      const mockESUs = [{ id: '1', name: 'Project 1', item_count: 10 }];
      mockFetchAllProjects.mockResolvedValue(mockProjects);
      mockBuildExternalSyncUnits.mockResolvedValue(mockESUs);

      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(AsanaClient).toHaveBeenCalledWith(adapter.event);
      expect(mockCheckUserWorkspaceRole).toHaveBeenCalled();
      expect(mockFetchAllProjects).toHaveBeenCalled();
      expect(mockBuildExternalSyncUnits).toHaveBeenCalledWith(mockProjects, expect.anything());
      expect(adapter.getRepo).toHaveBeenCalledWith(expect.anything());
      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.ExternalSyncUnitExtractionDone);
    });

    it('should call checkUserWorkspaceRole before fetching projects', async () => {
      const callOrder: string[] = [];
      mockCheckUserWorkspaceRole.mockImplementation(async () => {
        callOrder.push('checkRole');
      });
      mockFetchAllProjects.mockImplementation(async () => {
        callOrder.push('fetchProjects');
        return [];
      });
      mockBuildExternalSyncUnits.mockResolvedValue([]);

      await taskFn({ adapter: createMockAdapter() });

      expect(callOrder).toEqual(['checkRole', 'fetchProjects']);
    });

    it('should emit ExternalSyncUnitExtractionError when fetchAllProjects throws', async () => {
      const error = new Error('Network failure');
      mockFetchAllProjects.mockRejectedValue(error);

      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.ExternalSyncUnitExtractionError, {
        error: {
          message: expect.stringContaining('Error paginating projects list from Asana'),
        },
      });
      expect(mockBuildExternalSyncUnits).not.toHaveBeenCalled();
    });

    it('should not emit done when fetchAllProjects throws', async () => {
      mockFetchAllProjects.mockRejectedValue(new Error('fail'));

      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(adapter.emit).not.toHaveBeenCalledWith(
        ExtractorEventType.ExternalSyncUnitExtractionDone,
        expect.anything()
      );
    });
  });

  describe('onTimeout', () => {
    it('should emit ExternalSyncUnitExtractionError with timeout message', async () => {
      const adapter = createMockAdapter();
      await onTimeoutFn({ adapter });

      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.ExternalSyncUnitExtractionError, {
        error: {
          message: 'Failed to extract external sync units due to timeout.',
        },
      });
    });
  });
});
