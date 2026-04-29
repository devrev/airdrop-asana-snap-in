import axios from 'axios';

import { AsanaClient } from '.';

jest.mock('axios', () => {
  const mockInstance = {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
    put: jest.fn().mockResolvedValue({ data: {} }),
    delete: jest.fn().mockResolvedValue({ data: {} }),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    defaults: { headers: { common: {} } },
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockInstance),
      isAxiosError: jest.fn(() => false),
    },
  };
});

let capturedRetryConfig: any = null;
jest.mock('axios-retry', () => ({
  __esModule: true,
  default: jest.fn((_, config) => {
    capturedRetryConfig = config;
  }),
}));

const mockAxios = axios as jest.Mocked<typeof axios>;
const mockGet = (mockAxios.create as jest.Mock)().get as jest.Mock;

function createClient() {
  const event = {
    payload: {
      connection_data: { key: 'test-api-key', org_id: 'workspace-123' },
      event_context: { external_sync_unit_id: 'project-456' },
    },
  } as any;

  return new AsanaClient(event);
}

describe('AsanaClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create HTTP client with correct base URL and auth header', () => {
      createClient();

      expect(mockAxios.create).toHaveBeenCalledWith({
        baseURL: 'https://app.asana.com/api/1.0',
        headers: { Authorization: 'Bearer test-api-key' },
      });
    });

    it('should set projectId from event context', () => {
      const client = createClient();

      expect(client.projectId).toBe('project-456');
    });
  });

  describe('getTasks', () => {
    it('should call correct URL with task fields and limit', async () => {
      const client = createClient();

      await client.getTasks({});

      expect(mockGet).toHaveBeenCalledWith('/projects/project-456/tasks', {
        params: expect.objectContaining({ limit: 100, opt_fields: expect.any(String) }),
      });
    });

    it('should include pagination offset when provided', async () => {
      const client = createClient();

      await client.getTasks({ offset: 'abc123' });

      expect(mockGet).toHaveBeenCalledWith('/projects/project-456/tasks', {
        params: expect.objectContaining({ offset: 'abc123' }),
      });
    });
  });

  describe('getSubtasksForTask', () => {
    it('should call correct URL with taskGid', async () => {
      const client = createClient();

      await client.getSubtasksForTask('task-789');

      expect(mockGet).toHaveBeenCalledWith('/tasks/task-789/subtasks', {
        params: expect.objectContaining({ limit: 100, opt_fields: expect.any(String) }),
      });
    });
  });

  describe('getProjects', () => {
    it('should call correct URL with workspaceId', async () => {
      const client = createClient();

      await client.getProjects({});

      expect(mockGet).toHaveBeenCalledWith('/workspaces/workspace-123/projects', {
        params: {},
      });
    });
  });

  describe('getProjectTaskCount', () => {
    it('should call correct URL with projectId and num_tasks field', async () => {
      const client = createClient();

      await client.getProjectTaskCount('proj-abc');

      expect(mockGet).toHaveBeenCalledWith('/projects/proj-abc/task_counts', {
        params: { opt_fields: 'num_tasks' },
      });
    });
  });

  describe('getMembershipsForProject', () => {
    it('should call /memberships with project as parent', async () => {
      const client = createClient();

      await client.getMembershipsForProject({});

      expect(mockGet).toHaveBeenCalledWith('/memberships', {
        params: expect.objectContaining({
          parent: 'project-456',
          limit: 100,
        }),
      });
    });

    it('should include pagination offset when provided', async () => {
      const client = createClient();

      await client.getMembershipsForProject({ offset: 'offset-abc' });

      expect(mockGet).toHaveBeenCalledWith('/memberships', {
        params: expect.objectContaining({ offset: 'offset-abc' }),
      });
    });
  });

  describe('getUser', () => {
    it('should call /users/{userGid} with name and email fields', async () => {
      const client = createClient();

      await client.getUser('user-123');

      expect(mockGet).toHaveBeenCalledWith('/users/user-123', {
        params: { opt_fields: 'name,email' },
      });
    });
  });

  describe('getTagsForWorkspace', () => {
    it('should call correct URL with workspaceId', async () => {
      const client = createClient();

      await client.getTagsForWorkspace({});

      expect(mockGet).toHaveBeenCalledWith('/workspaces/workspace-123/tags', {
        params: expect.objectContaining({ limit: 100, opt_fields: expect.any(String) }),
      });
    });
  });

  describe('getCustomFieldSettingsForProject', () => {
    it('should call correct URL with projectId and custom field settings options', async () => {
      const client = createClient();

      await client.getCustomFieldSettingsForProject({});

      expect(mockGet).toHaveBeenCalledWith('/projects/project-456/custom_field_settings', {
        params: expect.objectContaining({ limit: 100, opt_fields: expect.any(String) }),
      });
    });
  });

  describe('getStoriesForTask', () => {
    it('should call correct URL with taskGid', async () => {
      const client = createClient();

      await client.getStoriesForTask('task-789');

      expect(mockGet).toHaveBeenCalledWith('/tasks/task-789/stories', {
        params: expect.objectContaining({ limit: 100, opt_fields: expect.any(String) }),
      });
    });
  });

  describe('getSectionsForProject', () => {
    it('should call correct URL with projectId', async () => {
      const client = createClient();

      await client.getSectionsForProject();

      expect(mockGet).toHaveBeenCalledWith('/projects/project-456/sections', {
        params: expect.objectContaining({ limit: 100, opt_fields: 'name' }),
      });
    });
  });

  describe('getProject', () => {
    it('should call correct URL with projectId and privacy_setting field', async () => {
      const client = createClient();

      await client.getProject();

      expect(mockGet).toHaveBeenCalledWith('/projects/project-456', {
        params: { opt_fields: 'privacy_setting' },
      });
    });
  });

  describe('retryCondition', () => {
    beforeEach(() => {
      createClient();
    });

    it('should retry when error has no response (network error)', () => {
      const result = capturedRetryConfig.retryCondition({ });
      expect(result).toBe(true);
    });

    it('should retry on 500 server error', () => {
      const result = capturedRetryConfig.retryCondition({ response: { status: 500 } });
      expect(result).toBe(true);
    });

    it('should retry on 503 server error', () => {
      const result = capturedRetryConfig.retryCondition({ response: { status: 503 } });
      expect(result).toBe(true);
    });

    it('should not retry on 429 rate limit', () => {
      const result = capturedRetryConfig.retryCondition({ response: { status: 429 } });
      expect(result).toBe(false);
    });

    it('should not retry on 400 client error', () => {
      const result = capturedRetryConfig.retryCondition({ response: { status: 400 } });
      expect(result).toBe(false);
    });

    it('should not retry on 404 not found', () => {
      const result = capturedRetryConfig.retryCondition({ response: { status: 404 } });
      expect(result).toBe(false);
    });
  });

  describe('retryDelay', () => {
    beforeEach(() => {
      jest.spyOn(console, 'warn').mockImplementation();
      createClient();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should return exponential delay based on retry count', () => {
      const delay1 = capturedRetryConfig.retryDelay(1, 'error');
      expect(delay1).toBe(2000);

      const delay2 = capturedRetryConfig.retryDelay(2, 'error');
      expect(delay2).toBe(4000);

      const delay3 = capturedRetryConfig.retryDelay(3, 'error');
      expect(delay3).toBe(8000);
    });

    it('should log a warning with retry attempt details', () => {
      capturedRetryConfig.retryDelay(1, 'connection refused');

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('HTTP Retry: Attempt 1/3')
      );
    });
  });

  describe('write methods', () => {
    const mockPost = (mockAxios.create as jest.Mock)().post as jest.Mock;
    const mockPut = (mockAxios.create as jest.Mock)().put as jest.Mock;

    it('createTask should POST to /tasks', async () => {
      const client = createClient();
      await client.createTask({ data: { name: 'New Task' } } as any);
      expect(mockPost).toHaveBeenCalledWith('/tasks', { data: { name: 'New Task' } });
    });

    it('updateTask should PUT to /tasks/{taskGid}', async () => {
      const client = createClient();
      await client.updateTask('t1', { data: { name: 'Updated' } } as any);
      expect(mockPut).toHaveBeenCalledWith('/tasks/t1', { data: { name: 'Updated' } });
    });

    it('createTaskSubtask should POST to /tasks/{parentGid}/subtasks', async () => {
      const client = createClient();
      await client.createTaskSubtask('parent1', { data: { name: 'Sub' } } as any);
      expect(mockPost).toHaveBeenCalledWith('/tasks/parent1/subtasks', { data: { name: 'Sub' } });
    });

    it('createTaskComment should POST to /tasks/{taskGid}/stories', async () => {
      const client = createClient();
      await client.createTaskComment('t1', { data: { html_text: 'Hi' } } as any);
      expect(mockPost).toHaveBeenCalledWith('/tasks/t1/stories', { data: { html_text: 'Hi' } });
    });

    it('addTaskDependencies should POST to /tasks/{taskGid}/addDependencies', async () => {
      const client = createClient();
      await client.addTaskDependencies('t1', { data: { dependencies: ['d1'] } } as any);
      expect(mockPost).toHaveBeenCalledWith('/tasks/t1/addDependencies', { data: { dependencies: ['d1'] } });
    });

    it('removeTaskDependencies should POST to /tasks/{taskGid}/removeDependencies', async () => {
      const client = createClient();
      await client.removeTaskDependencies('t1', { data: { dependencies: ['d1'] } } as any);
      expect(mockPost).toHaveBeenCalledWith('/tasks/t1/removeDependencies', { data: { dependencies: ['d1'] } });
    });

    it('setTaskParent should POST to /tasks/{taskGid}/setParent', async () => {
      const client = createClient();
      await client.setTaskParent('t1', { data: { parent: 'p1' } } as any);
      expect(mockPost).toHaveBeenCalledWith('/tasks/t1/setParent', { data: { parent: 'p1' } });
    });

    it('addTaskToSection should POST to /sections/{sectionGid}/addTask', async () => {
      const client = createClient();
      await client.addTaskToSection('s1', { data: { task: 't1' } } as any);
      expect(mockPost).toHaveBeenCalledWith('/sections/s1/addTask', { data: { task: 't1' } });
    });

    it('addTaskToProject should POST to /tasks/{taskGid}/addProject', async () => {
      const client = createClient();
      await client.addTaskToProject('t1', { data: { project: 'p1' } } as any);
      expect(mockPost).toHaveBeenCalledWith('/tasks/t1/addProject', { data: { project: 'p1' } });
    });

    it('addTagToTask should POST to /tasks/{taskGid}/addTag', async () => {
      const client = createClient();
      await client.addTagToTask('t1', { data: { tag: 'tag1' } } as any);
      expect(mockPost).toHaveBeenCalledWith('/tasks/t1/addTag', { data: { tag: 'tag1' } });
    });

    it('removeTagFromTask should POST to /tasks/{taskGid}/removeTag', async () => {
      const client = createClient();
      await client.removeTagFromTask('t1', { data: { tag: 'tag1' } } as any);
      expect(mockPost).toHaveBeenCalledWith('/tasks/t1/removeTag', { data: { tag: 'tag1' } });
    });

    it('getUsersForWorkspace should call /users with workspace', async () => {
      const client = createClient();
      await client.getUsersForWorkspace();
      expect(mockGet).toHaveBeenCalledWith('/users', {
        params: expect.objectContaining({ workspace: 'workspace-123' }),
      });
    });

    it('getWorkspaceMembershipsForMe should call correct URL', async () => {
      const client = createClient();
      await client.getWorkspaceMembershipsForMe();
      expect(mockGet).toHaveBeenCalledWith('/users/me/workspace_memberships', {
        params: expect.objectContaining({ opt_fields: expect.any(String) }),
      });
    });
  });

});
