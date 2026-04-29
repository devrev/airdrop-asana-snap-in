import { ExtractorEventType, processTask } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import {
  extractGroups,
  extractTags,
  extractTasks,
  extractUsers,
  handleExtractionError,
  prepareStateForExtraction,
} from '@utils/data-helpers';
import { extractPermissions } from '@utils/permissions-helpers';

import { type ExtractorState,initialState } from '../index';

jest.mock('@devrev/ts-adaas', () => ({
  processTask: jest.fn(),
  ExtractorEventType: jest.requireActual('@devrev/ts-adaas').ExtractorEventType,
}));
jest.mock('@asana/api-client');
jest.mock('@asana/data-normalization', () => ({
  normalizeAsanaUser: jest.fn(),
  normalizeAsanaTag: jest.fn(),
  normalizeAsanaTask: jest.fn(),
  normalizeAsanaSubtask: jest.fn(),
  normalizeAsanaAttachment: jest.fn(),
  normalizeAsanaComment: jest.fn(),
  normalizeAsanaLink: jest.fn(),
}));
jest.mock('@utils/data-helpers');
jest.mock('@utils/permissions-helpers');

const mockProcessTask = processTask as jest.Mock;
const mockExtractUsers = extractUsers as jest.Mock;
const mockExtractTags = extractTags as jest.Mock;
const mockExtractGroups = extractGroups as jest.Mock;
const mockExtractTasks = extractTasks as jest.Mock;
const mockHandleExtractionError = handleExtractionError as jest.Mock;
const mockPrepareState = prepareStateForExtraction as jest.Mock;
const mockExtractPermissions = extractPermissions as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./data-extraction');

const captured = mockProcessTask.mock.calls[0][0];
const taskFn: (params: { adapter: any }) => Promise<void> = captured.task;
const onTimeoutFn: (params: { adapter: any }) => Promise<void> = captured.onTimeout;

function createMockAdapter(stateOverrides?: Partial<ExtractorState>) {
  return {
    isTimeout: false,
    shouldExtract: jest.fn().mockReturnValue(true),
    state: { ...structuredClone(initialState), ...stateOverrides },
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

describe('data-extraction worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsanaClient as unknown as jest.Mock).mockImplementation(() => ({}));
    mockExtractUsers.mockResolvedValue(undefined);
    mockExtractTags.mockResolvedValue(undefined);
    mockExtractGroups.mockResolvedValue(undefined);
    mockExtractTasks.mockResolvedValue(undefined);
    mockPrepareState.mockReturnValue(undefined);
    mockExtractPermissions.mockResolvedValue(undefined);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('task', () => {
    it('should initialize repos, create client, prepare state, extract all types, and emit DataExtractionDone', async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(adapter.initializeRepos).toHaveBeenCalledWith(expect.any(Array));
      expect(AsanaClient).toHaveBeenCalledWith(adapter.event);
      expect(mockPrepareState).toHaveBeenCalledWith(adapter);
      expect(mockExtractUsers).toHaveBeenCalled();
      expect(mockExtractTags).toHaveBeenCalled();
      expect(mockExtractGroups).toHaveBeenCalled();
      expect(mockExtractTasks).toHaveBeenCalled();
      expect(mockExtractPermissions).toHaveBeenCalled();
      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.DataExtractionDone);
    });

    it('should extract in order: users, tags, groups, tasks', async () => {
      const callOrder: string[] = [];
      mockExtractUsers.mockImplementation(async () => callOrder.push('users'));
      mockExtractTags.mockImplementation(async () => callOrder.push('tags'));
      mockExtractGroups.mockImplementation(async () => callOrder.push('groups'));
      mockExtractTasks.mockImplementation(async () => callOrder.push('tasks'));

      await taskFn({ adapter: createMockAdapter() });

      expect(callOrder).toEqual(['users', 'tags', 'groups', 'tasks']);
    });

    it('should skip already-completed item types', async () => {
      const adapter = createMockAdapter({
        users: { completed: true, offset: '', total: 5 },
        tags: { completed: true, offset: '', total: 3 },
        groups: { completed: true, offset: '', total: 2 },
      });

      await taskFn({ adapter });

      expect(mockExtractUsers).not.toHaveBeenCalled();
      expect(mockExtractTags).not.toHaveBeenCalled();
      expect(mockExtractGroups).not.toHaveBeenCalled();
      expect(mockExtractTasks).toHaveBeenCalled();
    });

    it('should mark attachments, comments, subtasks, links, and permissions as completed after tasks extraction', async () => {
      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(adapter.state.tasks.completed).toBe(true);
      expect(adapter.state.attachments.completed).toBe(true);
      expect(adapter.state.comments.completed).toBe(true);
      expect(adapter.state.subtasks.completed).toBe(true);
      expect(adapter.state.links.completed).toBe(true);
      expect(mockExtractPermissions).toHaveBeenCalled();
    });

    it('should skip item types where shouldExtract returns false', async () => {
      const adapter = createMockAdapter();
      adapter.shouldExtract.mockImplementation((type: string) => type !== 'users' && type !== 'tags');

      await taskFn({ adapter });

      expect(mockExtractUsers).not.toHaveBeenCalled();
      expect(mockExtractTags).not.toHaveBeenCalled();
      expect(mockExtractGroups).toHaveBeenCalled();
      expect(mockExtractTasks).toHaveBeenCalled();
      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.DataExtractionDone);
    });

    it('should skip permissions extraction when access_rules shouldExtract is false', async () => {
      const adapter = createMockAdapter();
      adapter.shouldExtract.mockImplementation((type: string) => type !== 'access_rules');

      await taskFn({ adapter });

      expect(mockExtractTasks).toHaveBeenCalled();
      expect(mockExtractPermissions).not.toHaveBeenCalled();
      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.DataExtractionDone);
    });

    it('should skip all extractions and still emit done when no item types are in scope', async () => {
      const adapter = createMockAdapter();
      adapter.shouldExtract.mockReturnValue(false);

      await taskFn({ adapter });

      expect(mockExtractUsers).not.toHaveBeenCalled();
      expect(mockExtractTags).not.toHaveBeenCalled();
      expect(mockExtractGroups).not.toHaveBeenCalled();
      expect(mockExtractTasks).not.toHaveBeenCalled();
      expect(mockExtractPermissions).not.toHaveBeenCalled();
      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.DataExtractionDone);
    });

    it('should emit DataExtractionDelayed when extraction error has delay', async () => {
      const error = new Error('rate limited');
      mockExtractUsers.mockRejectedValue(error);
      mockHandleExtractionError.mockReturnValue({ delay: 60 });

      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(mockHandleExtractionError).toHaveBeenCalledWith(error);
      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.DataExtractionDelayed, { delay: 60 });
      expect(adapter.emit).not.toHaveBeenCalledWith(ExtractorEventType.DataExtractionDone);
    });

    it('should emit DataExtractionError when extraction error has no delay', async () => {
      const error = new Error('server error');
      const extractionError = { message: 'server error' };
      mockExtractUsers.mockRejectedValue(error);
      mockHandleExtractionError.mockReturnValue({ error: extractionError });

      const adapter = createMockAdapter();
      await taskFn({ adapter });

      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.DataExtractionError, {
        error: extractionError,
      });
      expect(adapter.emit).not.toHaveBeenCalledWith(ExtractorEventType.DataExtractionDone);
    });

    it('should stop extraction and not emit done when timeout occurs before starting', async () => {
      const adapter = createMockAdapter();
      adapter.isTimeout = true;

      await taskFn({ adapter });

      expect(mockExtractUsers).not.toHaveBeenCalled();
      expect(adapter.emit).not.toHaveBeenCalled();
    });

    it('should stop extraction when timeout occurs mid-extraction', async () => {
      const adapter = createMockAdapter();
      mockExtractUsers.mockImplementation(async () => {
        adapter.isTimeout = true;
      });

      await taskFn({ adapter });

      expect(mockExtractUsers).toHaveBeenCalled();
      expect(mockExtractTags).not.toHaveBeenCalled();
      expect(adapter.emit).not.toHaveBeenCalledWith(ExtractorEventType.DataExtractionDone);
    });

  });

  describe('onTimeout', () => {
    it('should emit DataExtractionProgress', async () => {
      const adapter = createMockAdapter();
      await onTimeoutFn({ adapter });

      expect(adapter.emit).toHaveBeenCalledWith(ExtractorEventType.DataExtractionProgress);
    });
  });
});
