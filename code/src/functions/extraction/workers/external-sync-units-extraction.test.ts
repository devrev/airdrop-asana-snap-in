import { processExtractionTask } from '@devrev/airsync-sdk';
import { AxiosError, type AxiosResponse } from 'axios';

import { AsanaClient } from '@asana/api-client';
import { buildExternalSyncUnits, checkUserWorkspaceRole, fetchAllProjects } from '@utils/external-sync-units-helpers';
import { serializeError } from '@utils/serialize-error';

jest.mock('@devrev/airsync-sdk', () => ({
  ...jest.requireActual('@devrev/airsync-sdk'),
  processExtractionTask: jest.fn(),
  AirSyncDefaultItemTypes: jest.requireActual('@devrev/airsync-sdk').AirSyncDefaultItemTypes,
}));
jest.mock('@asana/api-client');
jest.mock('@utils/external-sync-units-helpers');
jest.mock('@utils/serialize-error');

const mockProcessTask = processExtractionTask as jest.Mock;
const mockCheckUserWorkspaceRole = checkUserWorkspaceRole as jest.Mock;
const mockFetchAllProjects = fetchAllProjects as jest.Mock;
const mockBuildExternalSyncUnits = buildExternalSyncUnits as jest.Mock;
const mockSerializeError = serializeError as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./external-sync-units-extraction');

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
    it('should fetch projects, build ESUs, and return success', async () => {
      const mockProjects = [{ gid: '1', name: 'Project 1' }];
      const mockESUs = [{ id: '1', name: 'Project 1' }];
      mockFetchAllProjects.mockResolvedValue(mockProjects);
      mockBuildExternalSyncUnits.mockReturnValue(mockESUs);

      const adapter = createMockAdapter();
      const taskResult = await taskFn({ adapter });

      expect(AsanaClient).toHaveBeenCalledWith(adapter.event);
      expect(mockCheckUserWorkspaceRole).toHaveBeenCalled();
      expect(mockFetchAllProjects).toHaveBeenCalled();
      expect(mockBuildExternalSyncUnits).toHaveBeenCalledWith(mockProjects);
      expect(adapter.getRepo).toHaveBeenCalledWith('external_sync_units');
      expect(adapter._mockPush).toHaveBeenCalledWith(mockESUs);
      expect(taskResult).toEqual({ status: 'success' });
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
      mockBuildExternalSyncUnits.mockReturnValue([]);

      await taskFn({ adapter: createMockAdapter() });

      expect(callOrder).toEqual(['checkRole', 'fetchProjects']);
    });

    it('should return error when fetchAllProjects throws', async () => {
      const error = new Error('Network failure');
      mockFetchAllProjects.mockRejectedValue(error);

      const adapter = createMockAdapter();
      const taskResult = await taskFn({ adapter });

      expect(taskResult).toEqual({ status: 'error', error: {
          message: expect.stringContaining('Error paginating projects list from Asana'),
        }, });
      expect(mockBuildExternalSyncUnits).not.toHaveBeenCalled();
    });

    it('should return error with a retry hint when Asana rate limits', async () => {
      mockFetchAllProjects.mockRejectedValue(
        new AxiosError('Too Many Requests', '429', undefined, undefined, {
          status: 429,
          headers: { 'retry-after': '90' },
        } as unknown as AxiosResponse)
      );

      const adapter = createMockAdapter();
      const taskResult = await taskFn({ adapter });

      expect(taskResult).toEqual({ status: 'error', error: {
          message: 'Rate limited by Asana (HTTP 429) while listing projects. Retry in 90 seconds.',
        }, });
      expect(mockBuildExternalSyncUnits).not.toHaveBeenCalled();
    });

    it('should not return success when fetchAllProjects throws', async () => {
      mockFetchAllProjects.mockRejectedValue(new Error('fail'));

      const adapter = createMockAdapter();
      const taskResult = await taskFn({ adapter });

      expect(taskResult.status).not.toBe('success');
    });
  });

  describe('onTimeout', () => {
    it('should use the SDK timeout handler', () => {
      expect(captured.onTimeout).toBeUndefined();
    });
  });
});
