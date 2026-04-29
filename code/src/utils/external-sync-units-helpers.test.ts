import { AxiosResponse } from 'axios';

import { AsanaClient } from '@asana/api-client';
import { ItemType } from '@asana/constants';
import type {
  AsanaProject,
  GetAsanaProjectsResponse,
  GetAsanaProjectTaskCountResponse,
  NextPage,
} from '@asana/types';

import { buildExternalSyncUnits, checkUserWorkspaceRole, fetchAllProjects } from './external-sync-units-helpers';

jest.mock('@asana/api-client');

describe('checkUserWorkspaceRole', () => {
  let mockAsanaClient: jest.Mocked<AsanaClient>;

  beforeEach(() => {
    mockAsanaClient = {
      workspaceId: 'ws1',
      getWorkspaceMembershipsForMe: jest.fn(),
    } as unknown as jest.Mocked<AsanaClient>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should warn when no workspace membership is found', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockAsanaClient.getWorkspaceMembershipsForMe.mockResolvedValue({
      data: { data: [{ workspace: { gid: 'other-ws' } }] },
    } as any);

    await checkUserWorkspaceRole(mockAsanaClient);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Could not find workspace membership'));
    consoleSpy.mockRestore();
  });

  it('should warn when user is a guest', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockAsanaClient.getWorkspaceMembershipsForMe.mockResolvedValue({
      data: { data: [{ workspace: { gid: 'ws1' }, is_guest: true, is_admin: false }] },
    } as any);

    await checkUserWorkspaceRole(mockAsanaClient);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('GUEST'));
    consoleSpy.mockRestore();
  });

  it('should warn when user is not an admin', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockAsanaClient.getWorkspaceMembershipsForMe.mockResolvedValue({
      data: { data: [{ workspace: { gid: 'ws1' }, is_guest: false, is_admin: false }] },
    } as any);

    await checkUserWorkspaceRole(mockAsanaClient);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('not a workspace admin'));
    consoleSpy.mockRestore();
  });

  it('should not warn when user is an admin', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockAsanaClient.getWorkspaceMembershipsForMe.mockResolvedValue({
      data: { data: [{ workspace: { gid: 'ws1' }, is_guest: false, is_admin: true }] },
    } as any);

    await checkUserWorkspaceRole(mockAsanaClient);

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should warn and continue when API call fails', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockAsanaClient.getWorkspaceMembershipsForMe.mockRejectedValue(new Error('Network error'));

    await checkUserWorkspaceRole(mockAsanaClient);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Unable to check workspace membership role'));
    consoleSpy.mockRestore();
  });

  it('should handle empty memberships array', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockAsanaClient.getWorkspaceMembershipsForMe.mockResolvedValue({
      data: { data: [] },
    } as any);

    await checkUserWorkspaceRole(mockAsanaClient);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Could not find workspace membership'));
    consoleSpy.mockRestore();
  });

  it('should handle null data gracefully', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockAsanaClient.getWorkspaceMembershipsForMe.mockResolvedValue({
      data: { data: null },
    } as any);

    await checkUserWorkspaceRole(mockAsanaClient);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Could not find workspace membership'));
    consoleSpy.mockRestore();
  });
});

function createProjectsResponse(
  projects: AsanaProject[],
  nextPage: NextPage | null = null
): AxiosResponse<GetAsanaProjectsResponse> {
  return {
    data: { data: projects, next_page: nextPage },
  } as AxiosResponse<GetAsanaProjectsResponse>;
}

function createTaskCountResponse(numTasks?: number): AxiosResponse<GetAsanaProjectTaskCountResponse> {
  return {
    data: { data: { num_tasks: numTasks } },
  } as AxiosResponse<GetAsanaProjectTaskCountResponse>;
}

describe('fetchAllProjects', () => {
  let mockAsanaClient: jest.Mocked<AsanaClient>;

  beforeEach(() => {
    mockAsanaClient = {
      getProjects: jest.fn(),
    } as unknown as jest.Mocked<AsanaClient>;
  });

  it('should fetch all projects in a single page', async () => {
    const projects: AsanaProject[] = [
      { gid: 'proj1', name: 'Project 1', resource_type: 'project' },
      { gid: 'proj2', name: 'Project 2', resource_type: 'project' },
    ];

    mockAsanaClient.getProjects.mockResolvedValueOnce(createProjectsResponse(projects));

    const result = await fetchAllProjects(mockAsanaClient);

    expect(result).toEqual(projects);
    expect(mockAsanaClient.getProjects).toHaveBeenCalledTimes(1);
    expect(mockAsanaClient.getProjects).toHaveBeenCalledWith({
      limit: 100,
      offset: undefined,
    });
  });

  it('should paginate through multiple pages', async () => {
    const page1Projects: AsanaProject[] = [{ gid: 'proj1', name: 'Project 1', resource_type: 'project' }];
    const page2Projects: AsanaProject[] = [{ gid: 'proj2', name: 'Project 2', resource_type: 'project' }];
    const page3Projects: AsanaProject[] = [{ gid: 'proj3', name: 'Project 3', resource_type: 'project' }];

    mockAsanaClient.getProjects
      .mockResolvedValueOnce(createProjectsResponse(page1Projects, { offset: 'offset1' }))
      .mockResolvedValueOnce(createProjectsResponse(page2Projects, { offset: 'offset2' }))
      .mockResolvedValueOnce(createProjectsResponse(page3Projects));

    const result = await fetchAllProjects(mockAsanaClient);

    expect(result).toEqual([...page1Projects, ...page2Projects, ...page3Projects]);
    expect(mockAsanaClient.getProjects).toHaveBeenCalledTimes(3);
    expect(mockAsanaClient.getProjects).toHaveBeenNthCalledWith(1, {
      limit: 100,
      offset: undefined,
    });
    expect(mockAsanaClient.getProjects).toHaveBeenNthCalledWith(2, {
      limit: 100,
      offset: 'offset1',
    });
    expect(mockAsanaClient.getProjects).toHaveBeenNthCalledWith(3, {
      limit: 100,
      offset: 'offset2',
    });
  });

  it('should return empty array when no projects exist', async () => {
    mockAsanaClient.getProjects.mockResolvedValueOnce(createProjectsResponse([]));

    const result = await fetchAllProjects(mockAsanaClient);

    expect(result).toEqual([]);
  });

  it('should handle null data gracefully', async () => {
    mockAsanaClient.getProjects.mockResolvedValueOnce(
      createProjectsResponse(null as unknown as AsanaProject[])
    );

    const result = await fetchAllProjects(mockAsanaClient);

    expect(result).toEqual([]);
  });

  it('should throw error when API call fails', async () => {
    const error = new Error('API Error');
    mockAsanaClient.getProjects.mockRejectedValueOnce(error);

    await expect(fetchAllProjects(mockAsanaClient)).rejects.toThrow('API Error');
  });
});

describe('buildExternalSyncUnits', () => {
  let mockAsanaClient: jest.Mocked<AsanaClient>;

  beforeEach(() => {
    mockAsanaClient = {
      getProjectTaskCount: jest.fn(),
    } as unknown as jest.Mocked<AsanaClient>;
  });

  it('should build external sync units from projects', async () => {
    const projects: AsanaProject[] = [
      { gid: 'proj1', name: 'Project 1', resource_type: 'project' },
      { gid: 'proj2', name: 'Project 2', resource_type: 'project' },
    ];

    mockAsanaClient.getProjectTaskCount
      .mockResolvedValueOnce(createTaskCountResponse(10))
      .mockResolvedValueOnce(createTaskCountResponse(25));

    const result = await buildExternalSyncUnits(projects, mockAsanaClient);

    expect(result).toEqual([
      {
        id: 'proj1',
        name: 'Project 1',
        description: 'project',
        item_type: ItemType.TASKS,
        item_count: 10,
      },
      {
        id: 'proj2',
        name: 'Project 2',
        description: 'project',
        item_type: ItemType.TASKS,
        item_count: 25,
      },
    ]);
  });

  it('should handle task count fetch failure gracefully with 0 count', async () => {
    const projects: AsanaProject[] = [{ gid: 'proj1', name: 'Project 1', resource_type: 'project' }];

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockAsanaClient.getProjectTaskCount.mockRejectedValueOnce(new Error('Failed to fetch'));

    const result = await buildExternalSyncUnits(projects, mockAsanaClient);

    expect(result).toEqual([
      {
        id: 'proj1',
        name: 'Project 1',
        description: 'project',
        item_type: ItemType.TASKS,
        item_count: 0,
      },
    ]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('should handle mixed success and failure for task counts', async () => {
    const projects: AsanaProject[] = [
      { gid: 'proj1', name: 'Project 1', resource_type: 'project' },
      { gid: 'proj2', name: 'Project 2', resource_type: 'project' },
      { gid: 'proj3', name: 'Project 3', resource_type: 'project' },
    ];

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    mockAsanaClient.getProjectTaskCount
      .mockResolvedValueOnce(createTaskCountResponse(5))
      .mockRejectedValueOnce(new Error('API Error'))
      .mockResolvedValueOnce(createTaskCountResponse(15));

    const result = await buildExternalSyncUnits(projects, mockAsanaClient);

    expect(result).toEqual([
      {
        id: 'proj1',
        name: 'Project 1',
        description: 'project',
        item_type: ItemType.TASKS,
        item_count: 5,
      },
      {
        id: 'proj2',
        name: 'Project 2',
        description: 'project',
        item_type: ItemType.TASKS,
        item_count: 0,
      },
      {
        id: 'proj3',
        name: 'Project 3',
        description: 'project',
        item_type: ItemType.TASKS,
        item_count: 15,
      },
    ]);
    consoleSpy.mockRestore();
  });

  it('should return empty array for empty projects', async () => {
    const result = await buildExternalSyncUnits([], mockAsanaClient);

    expect(result).toEqual([]);
    expect(mockAsanaClient.getProjectTaskCount).not.toHaveBeenCalled();
  });

  it('should handle undefined num_tasks in response', async () => {
    const projects: AsanaProject[] = [{ gid: 'proj1', name: 'Project 1', resource_type: 'project' }];

    mockAsanaClient.getProjectTaskCount.mockResolvedValueOnce(createTaskCountResponse(undefined));

    const result = await buildExternalSyncUnits(projects, mockAsanaClient);

    expect(result).toEqual([
      {
        id: 'proj1',
        name: 'Project 1',
        description: 'project',
        item_type: ItemType.TASKS,
        item_count: 0,
      },
    ]);
  });

  it('should process projects in batches of 10', async () => {
    const projects: AsanaProject[] = Array.from({ length: 15 }, (_, i) => ({
      gid: `proj${i + 1}`,
      name: `Project ${i + 1}`,
      resource_type: 'project',
    }));

    const callOrder: string[] = [];
    mockAsanaClient.getProjectTaskCount.mockImplementation(async (projectId: string) => {
      callOrder.push(projectId);
      return createTaskCountResponse(1);
    });

    const result = await buildExternalSyncUnits(projects, mockAsanaClient);

    expect(result).toHaveLength(15);
    expect(mockAsanaClient.getProjectTaskCount).toHaveBeenCalledTimes(15);

    // Verify all 15 projects were fetched in order
    for (let i = 0; i < 15; i++) {
      expect(callOrder[i]).toBe(`proj${i + 1}`);
    }

    // Verify result order matches input order
    result.forEach((unit, i) => {
      expect(unit.id).toBe(`proj${i + 1}`);
      expect(unit.name).toBe(`Project ${i + 1}`);
      expect(unit.item_count).toBe(1);
    });
  });
});
