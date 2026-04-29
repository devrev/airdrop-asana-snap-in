import { LoaderEventType, processTask } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { denormalizeComment, denormalizeLink, denormalizeTask } from '@asana/data-denormalization';
import { handleLoadingError, resolveExternalId, resolveRef } from '@utils/loading-helpers';

jest.mock('@devrev/ts-adaas', () => ({
  processTask: jest.fn(),
  LoaderEventType: jest.requireActual('@devrev/ts-adaas').LoaderEventType,
}));
jest.mock('@asana/api-client');
jest.mock('@asana/data-denormalization');
jest.mock('@utils/loading-helpers');

const mockProcessTask = processTask as jest.Mock;
const mockDenormalizeTask = denormalizeTask as jest.Mock;
const mockDenormalizeComment = denormalizeComment as jest.Mock;
const mockDenormalizeLink = denormalizeLink as jest.Mock;
const mockHandleLoadingError = handleLoadingError as jest.Mock;
const mockResolveExternalId = resolveExternalId as jest.Mock;
const mockResolveRef = resolveRef as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./load-data');

const captured = mockProcessTask.mock.calls[0][0];
const taskFn: (params: { adapter: any }) => Promise<void> = captured.task;
const onTimeoutFn: (params: { adapter: any }) => Promise<void> = captured.onTimeout;

const mockAsanaClient = {
  projectId: 'project-123',
  createTask: jest.fn(),
  updateTask: jest.fn(),
  createTaskSubtask: jest.fn(),
  createTaskComment: jest.fn(),
  addTaskDependencies: jest.fn(),
  setTaskParent: jest.fn(),
  addTaskToSection: jest.fn(),
  addTagToTask: jest.fn(),
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
    loadItemTypes: jest.fn().mockResolvedValue(undefined),
  } as any;
}

describe('load-data worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsanaClient as unknown as jest.Mock).mockImplementation(() => mockAsanaClient);
    mockResolveExternalId.mockResolvedValue(null);
    mockHandleLoadingError.mockReturnValue({ error: 'test error' });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('processTask registration', () => {
    it('should register task and onTimeout handlers', () => {
      expect(taskFn).toBeDefined();
      expect(onTimeoutFn).toBeDefined();
    });

    it('should pass item types to loadItemTypes', async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(adapter.loadItemTypes).toHaveBeenCalledTimes(1);
      const { itemTypesToLoad } = adapter.loadItemTypes.mock.calls[0][0];
      const itemTypes = itemTypesToLoad.map((it: any) => it.itemType);
      expect(itemTypes).toEqual(['tasks', 'subtasks', 'comments', 'links']);
    });

    it('should emit DataLoadingDone on success', async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });
      expect(adapter.emit).toHaveBeenCalledWith(LoaderEventType.DataLoadingDone);
    });

    it('should emit DataLoadingDelayed on rate limit error', async () => {
      const adapter = createMockAdapter();
      adapter.loadItemTypes.mockRejectedValue(new Error('rate limited'));
      mockHandleLoadingError.mockReturnValue({ delay: 30 });

      await taskFn({ adapter });
      expect(adapter.emit).toHaveBeenCalledWith(LoaderEventType.DataLoadingDelayed, { delay: 30 });
    });

    it('should emit DataLoadingError on other errors', async () => {
      const adapter = createMockAdapter();
      adapter.loadItemTypes.mockRejectedValue(new Error('fail'));
      mockHandleLoadingError.mockReturnValue({ error: 'Something failed' });

      await taskFn({ adapter });
      expect(adapter.emit).toHaveBeenCalledWith(LoaderEventType.DataLoadingError, {
        error: { message: 'Something failed' },
      });
    });

    it('should emit DataLoadingProgress on timeout', async () => {
      const adapter = createMockAdapter();
      await onTimeoutFn({ adapter });
      expect(adapter.emit).toHaveBeenCalledWith(LoaderEventType.DataLoadingProgress);
    });
  });

  describe('task create/update handlers', () => {
    let createTask: any;
    let updateTask: any;

    beforeEach(async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });
      const { itemTypesToLoad } = adapter.loadItemTypes.mock.calls[0][0];
      createTask = itemTypesToLoad.find((it: any) => it.itemType === 'tasks').create;
      updateTask = itemTypesToLoad.find((it: any) => it.itemType === 'tasks').update;
    });

    it('should create a task with project, section, and tags', async () => {
      mockDenormalizeTask.mockResolvedValue({
        createRequest: { data: { name: 'Test Task' } },
        sectionGid: 'section-1',
        tagGids: ['tag-1', 'tag-2'],
      });
      mockAsanaClient.createTask.mockResolvedValue({
        data: { data: { gid: 'new-task-1', modified_at: '2024-01-01T00:00:00Z' } },
      });

      const result = await createTask({
        item: { id: { devrev: 'don:1' }, data: { name: 'Test Task' } },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('new-task-1');
      expect(result.modifiedDate).toBe('2024-01-01T00:00:00Z');
      expect(mockAsanaClient.createTask).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ projects: ['project-123'] }) })
      );
      expect(mockAsanaClient.addTaskToSection).toHaveBeenCalledWith('section-1', { data: { task: 'new-task-1' } });
      expect(mockAsanaClient.addTagToTask).toHaveBeenCalledTimes(2);
    });

    it('should return error when createTask returns no gid', async () => {
      mockDenormalizeTask.mockResolvedValue({ createRequest: { data: {} }, tagGids: [] });
      mockAsanaClient.createTask.mockResolvedValue({ data: { data: {} } });

      const result = await createTask({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.error).toContain('no GID');
    });

    it('should update a task with external ID', async () => {
      mockDenormalizeTask.mockResolvedValue({
        updateRequest: { data: { name: 'Updated' } },
        sectionGid: null,
        tagGids: [],
      });
      mockAsanaClient.updateTask.mockResolvedValue({
        data: { data: { gid: 'task-1', modified_at: '2024-02-01T00:00:00Z' } },
      });

      const result = await updateTask({
        item: { id: { devrev: 'don:1', external: 'task-1' }, data: { name: 'Updated' } },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('task-1');
      expect(mockAsanaClient.updateTask).toHaveBeenCalledWith('task-1', { data: { name: 'Updated' } });
    });

    it('should return error when updating without external ID', async () => {
      const result = await updateTask({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.error).toContain('No external ID');
    });
  });

  describe('comment handlers', () => {
    let createComment: any;
    let updateComment: any;

    beforeEach(async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });
      const { itemTypesToLoad } = adapter.loadItemTypes.mock.calls[0][0];
      createComment = itemTypesToLoad.find((it: any) => it.itemType === 'comments').create;
      updateComment = itemTypesToLoad.find((it: any) => it.itemType === 'comments').update;
    });

    it('should create a comment on parent task', async () => {
      mockDenormalizeComment.mockResolvedValue({
        parentGid: 'task-1',
        request: { data: { html_text: '<body>Hello</body>' } },
      });
      mockAsanaClient.createTaskComment.mockResolvedValue({
        data: { data: { gid: 'story-1' } },
      });

      const result = await createComment({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('story-1');
      expect(mockAsanaClient.createTaskComment).toHaveBeenCalledWith('task-1', {
        data: { html_text: '<body>Hello</body>' },
      });
    });

    it('should return error when parent cannot be resolved', async () => {
      mockDenormalizeComment.mockResolvedValue({ parentGid: null, request: {} });

      const result = await createComment({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.error).toContain('Cannot resolve parent');
    });

    it('should return success (no-op) for comment updates (not supported by Asana)', async () => {
      const result = await updateComment({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.error).toBeUndefined();
    });
  });

  describe('link handlers', () => {
    let createLink: any;

    beforeEach(async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });
      const { itemTypesToLoad } = adapter.loadItemTypes.mock.calls[0][0];
      createLink = itemTypesToLoad.find((it: any) => it.itemType === 'links').create;
    });

    it('should create is_dependent_on link via addDependencies', async () => {
      mockDenormalizeLink.mockResolvedValue({
        linkType: 'is_dependent_on',
        sourceGid: 'task-1',
        targetGid: 'task-2',
      });

      const result = await createLink({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('is_dependent_on_task-1_task-2');
      expect(mockAsanaClient.addTaskDependencies).toHaveBeenCalledWith('task-1', {
        data: { dependencies: ['task-2'] },
      });
    });

    it('should create is_parent_of link via setParent', async () => {
      mockDenormalizeLink.mockResolvedValue({
        linkType: 'is_parent_of',
        sourceGid: 'parent-1',
        targetGid: 'child-1',
      });

      const result = await createLink({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('is_parent_of_parent-1_child-1');
      expect(mockAsanaClient.setTaskParent).toHaveBeenCalledWith('child-1', {
        data: { parent: 'parent-1' },
      });
    });

    it('should skip is_duplicate_of links gracefully', async () => {
      mockDenormalizeLink.mockResolvedValue({
        linkType: 'is_duplicate_of',
        sourceGid: 'task-1',
        targetGid: 'task-2',
      });

      const result = await createLink({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('is_duplicate_of_task-1_task-2');
      expect(mockAsanaClient.addTaskDependencies).not.toHaveBeenCalled();
      expect(mockAsanaClient.setTaskParent).not.toHaveBeenCalled();
    });

    it('should return error when link cannot be resolved', async () => {
      mockDenormalizeLink.mockResolvedValue(null);

      const result = await createLink({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.error).toContain('Cannot resolve link');
    });

    it('should skip is_related_to links gracefully', async () => {
      mockDenormalizeLink.mockResolvedValue({
        linkType: 'is_related_to',
        sourceGid: 'task-1',
        targetGid: 'task-2',
      });

      const result = await createLink({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('is_related_to_task-1_task-2');
    });

    it('should skip unknown link types gracefully', async () => {
      mockDenormalizeLink.mockResolvedValue({
        linkType: 'unknown_type',
        sourceGid: 'task-1',
        targetGid: 'task-2',
      });

      const result = await createLink({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('unknown_type_task-1_task-2');
    });
  });

  describe('subtask handlers', () => {
    let createSubtask: any;
    let updateSubtask: any;

    beforeEach(async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });
      const { itemTypesToLoad } = adapter.loadItemTypes.mock.calls[0][0];
      createSubtask = itemTypesToLoad.find((it: any) => it.itemType === 'subtasks').create;
      updateSubtask = itemTypesToLoad.find((it: any) => it.itemType === 'subtasks').update;
    });

    it('should create subtask under parent when parent resolves', async () => {
      mockDenormalizeTask.mockResolvedValue({
        createRequest: { data: { name: 'Sub 1' } },
        tagGids: [],
      });
      mockResolveRef.mockResolvedValue('parent-gid-1');
      mockAsanaClient.createTaskSubtask.mockResolvedValue({
        data: { data: { gid: 'subtask-1', modified_at: '2024-01-01T00:00:00Z' } },
      });

      const result = await createSubtask({
        item: { id: { devrev: 'don:1' }, data: { parent_task: 'parent-ref' } },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('subtask-1');
      expect(mockAsanaClient.createTaskSubtask).toHaveBeenCalledWith('parent-gid-1', { data: { name: 'Sub 1' } });
    });

    it('should create standalone task when parent cannot be resolved', async () => {
      mockDenormalizeTask.mockResolvedValue({
        createRequest: { data: { name: 'Orphan Sub' } },
        tagGids: [],
      });
      mockResolveRef.mockResolvedValue(null);
      mockAsanaClient.createTask.mockResolvedValue({
        data: { data: { gid: 'standalone-1', modified_at: '2024-01-01T00:00:00Z' } },
      });

      const result = await createSubtask({
        item: { id: { devrev: 'don:1' }, data: { parent_task: 'missing-parent' } },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('standalone-1');
      expect(mockAsanaClient.createTask).toHaveBeenCalled();
    });

    it('should create standalone task when parent_task is not provided', async () => {
      mockDenormalizeTask.mockResolvedValue({
        createRequest: { data: { name: 'No Parent' } },
        tagGids: [],
      });
      mockAsanaClient.createTask.mockResolvedValue({
        data: { data: { gid: 'standalone-2', modified_at: '2024-01-01T00:00:00Z' } },
      });

      const result = await createSubtask({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('standalone-2');
    });

    it('should return error when subtask creation returns no GID', async () => {
      mockDenormalizeTask.mockResolvedValue({
        createRequest: { data: {} },
        tagGids: [],
      });
      mockAsanaClient.createTask.mockResolvedValue({ data: { data: {} } });

      const result = await createSubtask({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.error).toContain('no GID');
    });

    it('should add tags to created subtask', async () => {
      mockDenormalizeTask.mockResolvedValue({
        createRequest: { data: { name: 'Tagged Sub' } },
        tagGids: ['tag-1'],
      });
      mockAsanaClient.createTask.mockResolvedValue({
        data: { data: { gid: 'sub-1', modified_at: '2024-01-01T00:00:00Z' } },
      });

      await createSubtask({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(mockAsanaClient.addTagToTask).toHaveBeenCalledWith('sub-1', { data: { tag: 'tag-1' } });
    });

    it('should delegate updateSubtask to updateTask', async () => {
      mockDenormalizeTask.mockResolvedValue({
        updateRequest: { data: { name: 'Updated Sub' } },
        sectionGid: null,
        tagGids: [],
      });
      mockAsanaClient.updateTask.mockResolvedValue({
        data: { data: { gid: 'sub-1', modified_at: '2024-02-01T00:00:00Z' } },
      });

      const result = await updateSubtask({
        item: { id: { devrev: 'don:1', external: 'sub-1' }, data: { name: 'Updated Sub' } },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('sub-1');
    });
  });

  describe('updateTask with section and tags', () => {
    let updateTask: any;

    beforeEach(async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });
      const { itemTypesToLoad } = adapter.loadItemTypes.mock.calls[0][0];
      updateTask = itemTypesToLoad.find((it: any) => it.itemType === 'tasks').update;
    });

    it('should move task to section and add tags on update', async () => {
      mockDenormalizeTask.mockResolvedValue({
        updateRequest: { data: { name: 'Updated' } },
        sectionGid: 'section-1',
        tagGids: ['tag-1', 'tag-2'],
      });
      mockAsanaClient.updateTask.mockResolvedValue({
        data: { data: { gid: 'task-1', modified_at: '2024-02-01T00:00:00Z' } },
      });

      const result = await updateTask({
        item: { id: { devrev: 'don:1', external: 'task-1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('task-1');
      expect(mockAsanaClient.addTaskToSection).toHaveBeenCalledWith('section-1', { data: { task: 'task-1' } });
      expect(mockAsanaClient.addTagToTask).toHaveBeenCalledTimes(2);
    });

    it('should continue successfully even if section assignment fails', async () => {
      mockDenormalizeTask.mockResolvedValue({
        updateRequest: { data: {} },
        sectionGid: 'section-1',
        tagGids: [],
      });
      mockAsanaClient.updateTask.mockResolvedValue({
        data: { data: { gid: 'task-1', modified_at: '2024-02-01T00:00:00Z' } },
      });
      mockAsanaClient.addTaskToSection.mockRejectedValue(new Error('Section error'));

      const result = await updateTask({
        item: { id: { devrev: 'don:1', external: 'task-1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('task-1');
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('section move to'));
    });

    it('should handle rate limit errors via handleLoadingError', async () => {
      mockDenormalizeTask.mockRejectedValue(new Error('rate limit'));
      mockHandleLoadingError.mockReturnValue({ delay: 30 });

      const result = await updateTask({
        item: { id: { devrev: 'don:1', external: 'task-1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.delay).toBe(30);
    });
  });

  describe('link update handler', () => {
    let updateLink: any;

    beforeEach(async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });
      const { itemTypesToLoad } = adapter.loadItemTypes.mock.calls[0][0];
      updateLink = itemTypesToLoad.find((it: any) => it.itemType === 'links').update;
    });

    it('should delegate updateLink to createLink', async () => {
      mockDenormalizeLink.mockResolvedValue({
        linkType: 'is_dependent_on',
        sourceGid: 'task-1',
        targetGid: 'task-2',
      });

      const result = await updateLink({
        item: { id: { devrev: 'don:1' }, data: {} },
        mappers: {},
        event: createMockAdapter().event,
      });

      expect(result.id).toBe('is_dependent_on_task-1_task-2');
    });
  });
});
