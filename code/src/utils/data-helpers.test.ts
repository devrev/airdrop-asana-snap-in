import { axios, EventType, SyncMode } from '@devrev/ts-adaas';

import { ItemType, LinkType, MAX_SUBTASK_DEPTH } from '@asana/constants';

import { initialState } from '../functions/extraction/index';
import {
  extractGroups,
  extractTags,
  extractTasks,
  extractTaskWithSubtasks,
  extractUsers,
  fetchAllSubtasks,
  fetchCommentsForTask,
  fetchTeamMemberUserGids,
  handleExtractionError,
  prepareStateForExtraction,
  TaskExtractionBuffer,
} from './data-helpers';
import { extractCustomFields, extractSectionFromMemberships, toTimestamp } from './field-extraction-helpers';

describe('handleExtractionError', () => {
  describe('rate limit errors (429)', () => {
    it('should return delay from Retry-After header for rate limit errors', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 429,
          headers: { 'Retry-After': '60' },
        },
      };

      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      const result = handleExtractionError(error);

      expect(result).toEqual({ delay: 60 });
    });

    it('should handle non-numeric Retry-After header', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 429,
          headers: { 'Retry-After': 'invalid' },
        },
      };

      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      const result = handleExtractionError(error);

      expect(result.delay).toBe(60);
    });
  });

  describe('non-rate-limit errors', () => {
    beforeEach(() => {
      jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);
      jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should return error object for standard Error', () => {
      const error = new Error('Something went wrong');

      const result = handleExtractionError(error);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Error while extracting data');
      expect(result.error?.message).toContain('Something went wrong');
    });

    it('should return error object for unknown error types', () => {
      const error = 'string error';

      const result = handleExtractionError(error);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Error while extracting data');
    });

    it('should return error object for non-429 axios errors', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 500,
          data: { message: 'Internal Server Error' },
        },
      };

      const result = handleExtractionError(error);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Error while extracting data');
    });
  });

  describe('axios errors with different status codes', () => {
    beforeEach(() => {
      jest.spyOn(console, 'error').mockImplementation();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should not return delay for 400 Bad Request', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 400,
          headers: {},
        },
      };

      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      const result = handleExtractionError(error);

      expect(result.delay).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it('should not return delay for 500 Internal Server Error', () => {
      const error = {
        isAxiosError: true,
        response: {
          status: 500,
          headers: {},
        },
      };

      jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);

      const result = handleExtractionError(error);

      expect(result.delay).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });
});

describe('MAX_SUBTASK_DEPTH - DevRev platform limitation', () => {
  it('should be set to 2 (DevRev platform only supports 2 levels of link depth)', () => {
    expect(MAX_SUBTASK_DEPTH).toBe(2);
  });

  it('should allow depth 0 (project task)', () => {
    expect(0).toBeLessThanOrEqual(MAX_SUBTASK_DEPTH);
  });

  it('should allow depth 1 (subtask)', () => {
    expect(1).toBeLessThanOrEqual(MAX_SUBTASK_DEPTH);
  });

  it('should allow depth 2 (sub-subtask)', () => {
    expect(2).toBeLessThanOrEqual(MAX_SUBTASK_DEPTH);
  });

  it('should NOT allow depth 3 (sub-sub-subtask exceeds platform limit)', () => {
    expect(3).toBeGreaterThan(MAX_SUBTASK_DEPTH);
  });
});

describe('toTimestamp', () => {
  it('should convert date-only string to ISO timestamp', () => {
    expect(toTimestamp('2024-01-15')).toBe('2024-01-15T00:00:00.000Z');
  });

  it('should pass through full ISO datetime string', () => {
    expect(toTimestamp('2024-06-15T14:30:00.000Z')).toBe('2024-06-15T14:30:00.000Z');
  });

  it('should handle ISO string without milliseconds', () => {
    const result = toTimestamp('2024-06-15T14:30:00Z');
    expect(result).toBe('2024-06-15T14:30:00.000Z');
  });

  it('should return null for null input', () => {
    expect(toTimestamp(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(toTimestamp(undefined)).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(toTimestamp('')).toBeNull();
  });

  it('should return null for invalid date string', () => {
    jest.spyOn(console, 'warn').mockImplementation();
    expect(toTimestamp('not-a-date')).toBeNull();
    jest.restoreAllMocks();
  });
});

describe('extractCustomFields', () => {
  it('should return empty object for null input', () => {
    expect(extractCustomFields(null)).toEqual({});
  });

  it('should return empty object for undefined input', () => {
    expect(extractCustomFields(undefined)).toEqual({});
  });

  it('should return empty object for empty array', () => {
    expect(extractCustomFields([])).toEqual({});
  });

  it('should extract text field', () => {
    const fields = [{ gid: 'cf1', name: 'Notes', type: 'text', text_value: 'Hello' }];
    expect(extractCustomFields(fields as any)).toEqual({ cf1: 'Hello' });
  });

  it('should extract number field', () => {
    const fields = [{ gid: 'cf1', name: 'Points', type: 'number', number_value: 42 }];
    expect(extractCustomFields(fields as any)).toEqual({ cf1: 42 });
  });

  it('should extract number field with value 0', () => {
    const fields = [{ gid: 'cf1', name: 'Points', type: 'number', number_value: 0 }];
    expect(extractCustomFields(fields as any)).toEqual({ cf1: 0 });
  });

  it('should extract enum field using enum_value.gid', () => {
    const fields = [{ gid: 'cf1', name: 'Status', type: 'enum', enum_value: { gid: 'opt1', name: 'Done' } }];
    expect(extractCustomFields(fields as any)).toEqual({ cf1: 'opt1' });
  });

  it('should return null for enum when enum_value.gid is missing', () => {
    const fields = [{ gid: 'cf1', name: 'Status', type: 'enum', enum_value: {}, display_value: 'In Progress' }];
    expect(extractCustomFields(fields as any)).toEqual({});
  });

  it('should extract multi_enum field as array of GIDs', () => {
    const fields = [
      {
        gid: 'cf1',
        name: 'Labels',
        type: 'multi_enum',
        multi_enum_values: [{ gid: 'opt1', name: 'Bug' }, { gid: 'opt2', name: 'Feature' }],
      },
    ];
    expect(extractCustomFields(fields as any)).toEqual({ cf1: ['opt1', 'opt2'] });
  });

  it('should extract date field with date_time', () => {
    const fields = [
      { gid: 'cf1', name: 'Deadline', type: 'date', date_value: { date_time: '2024-06-15T14:00:00.000Z' } },
    ];
    expect(extractCustomFields(fields as any)).toEqual({ cf1: '2024-06-15T14:00:00.000Z' });
  });

  it('should fall back to date_value.date when date_time is missing', () => {
    const fields = [{ gid: 'cf1', name: 'Deadline', type: 'date', date_value: { date: '2024-06-15' } }];
    expect(extractCustomFields(fields as any)).toEqual({ cf1: '2024-06-15' });
  });

  it('should extract people field as array of GIDs', () => {
    const fields = [
      {
        gid: 'cf1',
        name: 'Reviewers',
        type: 'people',
        people_value: [{ gid: 'u1' }, { gid: 'u2' }],
      },
    ];
    expect(extractCustomFields(fields as any)).toEqual({ cf1: ['u1', 'u2'] });
  });

  it('should use display_value as fallback for unknown field types', () => {
    const fields = [{ gid: 'cf1', name: 'Formula', type: 'formula', display_value: '42' }];
    expect(extractCustomFields(fields as any)).toEqual({ cf1: '42' });
  });

  it('should skip fields missing gid', () => {
    const fields = [{ name: 'Orphan', type: 'text', text_value: 'val' }];
    expect(extractCustomFields(fields as any)).toEqual({});
  });

  it('should skip fields missing name', () => {
    const fields = [{ gid: 'cf1', type: 'text', text_value: 'val' }];
    expect(extractCustomFields(fields as any)).toEqual({});
  });

  it('should skip fields with null value', () => {
    const fields = [{ gid: 'cf1', name: 'Empty', type: 'text', text_value: null }];
    expect(extractCustomFields(fields as any)).toEqual({});
  });

  it('should handle multiple fields of different types', () => {
    const fields = [
      { gid: 'cf1', name: 'Notes', type: 'text', text_value: 'Hello' },
      { gid: 'cf2', name: 'Points', type: 'number', number_value: 5 },
      { gid: 'cf3', name: 'Status', type: 'enum', enum_value: { gid: 'opt1', name: 'Open' } },
    ];
    expect(extractCustomFields(fields as any)).toEqual({
      cf1: 'Hello',
      cf2: 5,
      cf3: 'opt1',
    });
  });
});

describe('extractSectionFromMemberships', () => {
  it('should return null for null input', () => {
    expect(extractSectionFromMemberships(null)).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(extractSectionFromMemberships(undefined)).toBeNull();
  });

  it('should return null for empty array', () => {
    expect(extractSectionFromMemberships([])).toBeNull();
  });

  it('should find section matching projectId', () => {
    const memberships = [
      { project: { gid: 'p1' }, section: { gid: 's1' } },
      { project: { gid: 'p2' }, section: { gid: 's2' } },
    ];
    expect(extractSectionFromMemberships(memberships as any, 'p2')).toBe('s2');
  });

  it('should fall back to first section when projectId does not match', () => {
    const memberships = [
      { project: { gid: 'p1' }, section: { gid: 's1' } },
      { project: { gid: 'p2' }, section: { gid: 's2' } },
    ];
    expect(extractSectionFromMemberships(memberships as any, 'p999')).toBe('s1');
  });

  it('should return first available section when no projectId provided', () => {
    const memberships = [
      { project: { gid: 'p1' }, section: { gid: 's1' } },
      { project: { gid: 'p2' }, section: { gid: 's2' } },
    ];
    expect(extractSectionFromMemberships(memberships as any)).toBe('s1');
  });

  it('should return null when no memberships have section GIDs', () => {
    const memberships = [{ project: { gid: 'p1' } }, { project: { gid: 'p2' }, section: {} }];
    expect(extractSectionFromMemberships(memberships as any)).toBeNull();
  });

  it('should skip memberships without section and return first valid one', () => {
    const memberships = [{ project: { gid: 'p1' } }, { project: { gid: 'p2' }, section: { gid: 's2' } }];
    expect(extractSectionFromMemberships(memberships as any)).toBe('s2');
  });
});

describe('fetchCommentsForTask', () => {
  function createMockClient(pages: { stories: any[]; nextOffset?: string }[]) {
    let callIndex = 0;
    return {
      getStoriesForTask: jest.fn().mockImplementation(() => {
        const page = pages[callIndex++] || { stories: [] };
        return Promise.resolve({
          data: {
            data: page.stories,
            next_page: page.nextOffset ? { offset: page.nextOffset } : null,
          },
        });
      }),
    } as any;
  }

  it('should return only stories with type comment', async () => {
    const client = createMockClient([
      {
        stories: [
          { gid: 's1', type: 'comment', text: 'A comment' },
          { gid: 's2', type: 'system', text: 'Assigned to user' },
          { gid: 's3', type: 'comment', text: 'Another comment' },
        ],
      },
    ]);

    const result = await fetchCommentsForTask('task1', client);

    expect(result).toHaveLength(2);
    expect(result[0].gid).toBe('s1');
    expect(result[1].gid).toBe('s3');
  });

  it('should handle multi-page pagination', async () => {
    const client = createMockClient([
      { stories: [{ gid: 's1', type: 'comment', text: 'Page 1' }], nextOffset: 'offset2' },
      { stories: [{ gid: 's2', type: 'comment', text: 'Page 2' }] },
    ]);

    const result = await fetchCommentsForTask('task1', client);

    expect(result).toHaveLength(2);
    expect(client.getStoriesForTask).toHaveBeenCalledTimes(2);
  });

  it('should return empty array when no stories exist', async () => {
    const client = createMockClient([{ stories: [] }]);

    const result = await fetchCommentsForTask('task1', client);

    expect(result).toEqual([]);
  });

  it('should return empty array when all stories are non-comment types', async () => {
    const client = createMockClient([
      { stories: [{ gid: 's1', type: 'system' }, { gid: 's2', type: 'system' }] },
    ]);

    const result = await fetchCommentsForTask('task1', client);

    expect(result).toEqual([]);
  });
});

describe('fetchAllSubtasks', () => {
  function createMockClient(pages: { subtasks: any[]; nextOffset?: string }[]) {
    let callIndex = 0;
    return {
      getSubtasksForTask: jest.fn().mockImplementation(() => {
        const page = pages[callIndex++] || { subtasks: [] };
        return Promise.resolve({
          data: {
            data: page.subtasks,
            next_page: page.nextOffset ? { offset: page.nextOffset } : null,
          },
        });
      }),
    } as any;
  }

  it('should return subtasks from a single page', async () => {
    const client = createMockClient([
      { subtasks: [{ gid: 'st1', name: 'Sub 1' }, { gid: 'st2', name: 'Sub 2' }] },
    ]);

    const result = await fetchAllSubtasks('task1', client);

    expect(result).toHaveLength(2);
    expect(result[0].gid).toBe('st1');
    expect(result[1].gid).toBe('st2');
  });

  it('should handle multi-page pagination', async () => {
    const client = createMockClient([
      { subtasks: [{ gid: 'st1' }], nextOffset: 'page2' },
      { subtasks: [{ gid: 'st2' }], nextOffset: 'page3' },
      { subtasks: [{ gid: 'st3' }] },
    ]);

    const result = await fetchAllSubtasks('task1', client);

    expect(result).toHaveLength(3);
    expect(client.getSubtasksForTask).toHaveBeenCalledTimes(3);
  });

  it('should return empty array for task with no subtasks', async () => {
    const client = createMockClient([{ subtasks: [] }]);

    const result = await fetchAllSubtasks('task1', client);

    expect(result).toEqual([]);
  });
});

describe('prepareStateForExtraction', () => {
  function createMockAdapter(overrides: {
    eventType?: string;
    mode?: string;
    extractFrom?: string;
    extractTo?: string;
  }) {
    return {
      event: {
        payload: {
          event_type: overrides.eventType ?? EventType.StartExtractingData,
          event_context: {
            mode: overrides.mode ?? SyncMode.INITIAL,
            extract_from: overrides.extractFrom,
            extract_to: overrides.extractTo,
          },
        },
      },
      state: {
        users: { completed: false, offset: '', total: 0 },
        tasks: { completed: false, offset: '', total: 0, lastExtractedTaskIndex: -1 },
        attachments: { completed: false, total: 0 },
        comments: { completed: false, total: 0 },
        tags: { completed: false, offset: '', total: 0 },
        subtasks: { completed: false, total: 0 },
        links: { completed: false, total: 0 },
      },
    } as any;
  }

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation();
    // Reset shared initialState to prevent cross-test pollution.
    // prepareStateForExtraction assigns references to initialState's nested objects,
    // so mutations in one test can leak into subsequent tests.
    initialState.users = { completed: false, offset: '', total: 0 };
    initialState.tasks = { completed: false, offset: '', total: 0, lastExtractedTaskIndex: -1 };
    initialState.attachments = { completed: false, total: 0 };
    initialState.comments = { completed: false, total: 0 };
    initialState.tags = { completed: false, offset: '', total: 0 };
    initialState.subtasks = { completed: false, total: 0 };
    initialState.links = { completed: false, total: 0 };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be a no-op for non-StartExtractingData events', () => {
    const adapter = createMockAdapter({ eventType: 'some_other_event' });
    const stateBefore = JSON.parse(JSON.stringify(adapter.state));

    prepareStateForExtraction(adapter);

    expect(adapter.state).toEqual(stateBefore);
  });

  it('should reset all state on incremental sync', () => {
    const adapter = createMockAdapter({ mode: SyncMode.INCREMENTAL });
    adapter.state.users.completed = true;
    adapter.state.users.total = 50;
    adapter.state.tasks.completed = true;
    adapter.state.tasks.total = 100;

    prepareStateForExtraction(adapter);

    expect(adapter.state.users.completed).toBe(false);
    expect(adapter.state.users.total).toBe(0);
    expect(adapter.state.tasks.completed).toBe(false);
    expect(adapter.state.tasks.total).toBe(0);
  });

  it('should not reset state on initial sync', () => {
    const adapter = createMockAdapter({});
    adapter.state.users.completed = true;
    adapter.state.users.total = 50;

    prepareStateForExtraction(adapter);

    expect(adapter.state.users.completed).toBe(true);
    expect(adapter.state.users.total).toBe(50);
  });

  it('should log extract_from and extract_to when both are provided', () => {
    const adapter = createMockAdapter({
      extractFrom: '2024-01-01T00:00:00Z',
      extractTo: '2024-06-01T00:00:00Z',
    });

    prepareStateForExtraction(adapter);

    expect(console.log).toHaveBeenCalledWith(
      'Initial sync: extracting from 2024-01-01T00:00:00Z to 2024-06-01T00:00:00Z.'
    );
  });

  it('should log without time bounds when neither is provided', () => {
    const adapter = createMockAdapter({});

    prepareStateForExtraction(adapter);

    expect(console.log).toHaveBeenCalledWith('Initial sync: extracting.');
  });

  it('should log incremental sync with time bounds', () => {
    const adapter = createMockAdapter({
      mode: SyncMode.INCREMENTAL,
      extractFrom: '2024-03-01T00:00:00Z',
      extractTo: '2024-06-01T00:00:00Z',
    });

    prepareStateForExtraction(adapter);

    expect(console.log).toHaveBeenCalledWith(
      'Incremental sync: extracting from 2024-03-01T00:00:00Z to 2024-06-01T00:00:00Z.'
    );
  });
});

describe('extractTaskWithSubtasks', () => {
  function createEmptyBuffer(): TaskExtractionBuffer {
    return { tasks: [], subtasks: [], comments: [], attachments: [], links: [] };
  }

  function createMockAsanaClient(options?: {
    stories?: any[];
    subtasks?: any[];
  }) {
    return {
      getStoriesForTask: jest.fn().mockResolvedValue({
        data: { data: options?.stories ?? [], next_page: null },
      }),
      getSubtasksForTask: jest.fn().mockResolvedValue({
        data: { data: options?.subtasks ?? [], next_page: null },
      }),
    } as any;
  }

  function createMockAdapter() {
    return {
      shouldExtract: jest.fn().mockReturnValue(true),
    } as any;
  }

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should add task to buffer.tasks at depth 0', async () => {
    const task = { gid: 't1', name: 'Task 1' };
    const client = createMockAsanaClient();
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, createMockAdapter(), 0);

    expect(buffer.tasks).toHaveLength(1);
    expect(buffer.tasks[0].gid).toBe('t1');
    expect(buffer.subtasks).toHaveLength(0);
  });

  it('should add task to buffer.subtasks at depth > 0', async () => {
    const task = { gid: 'st1', name: 'Subtask 1' };
    const client = createMockAsanaClient();
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, createMockAdapter(), 1);

    expect(buffer.subtasks).toHaveLength(1);
    expect(buffer.subtasks[0].gid).toBe('st1');
    expect(buffer.tasks).toHaveLength(0);
  });

  it('should extract text comments and skip non-comment stories', async () => {
    const client = createMockAsanaClient({
      stories: [
        { gid: 'c1', type: 'comment', text: 'A real comment', created_at: '2024-01-01T00:00:00Z' },
        { gid: 'c2', type: 'system', text: 'System event' },
      ],
    });
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks({ gid: 't1' } as any, client, 'proj1', buffer, createMockAdapter(), 0);

    expect(buffer.comments).toHaveLength(1);
    expect(buffer.comments[0].gid).toBe('c1');
  });

  it('should skip comments that contain only a non-image attachment URL', async () => {
    const client = createMockAsanaClient({
      stories: [
        {
          gid: 'c1',
          type: 'comment',
          text: 'https://app.asana.com/app/asana/-/get_asset?asset_id=999',
          html_text: '<p>https://app.asana.com/app/asana/-/get_asset?asset_id=999</p>',
        },
      ],
    });
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks({ gid: 't1' } as any, client, 'proj1', buffer, createMockAdapter(), 0);

    expect(buffer.comments).toHaveLength(0);
  });

  it('should extract attachments from task', async () => {
    const task = {
      gid: 't1',
      attachments: [
        { gid: 'att1', name: 'file.pdf', download_url: 'https://example.com/file.pdf' },
      ],
    };
    const client = createMockAsanaClient();
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, createMockAdapter(), 0);

    expect(buffer.attachments).toHaveLength(1);
    expect(buffer.attachments[0].gid).toBe('att1');
  });

  it('should create dependency links from task.dependencies at depth 0', async () => {
    const task = {
      gid: 't1',
      dependencies: [{ gid: 'dep1' }, { gid: 'dep2' }],
    };
    const client = createMockAsanaClient();
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, createMockAdapter(), 0);

    expect(buffer.links).toHaveLength(2);
    expect(buffer.links[0]).toEqual({
      source_gid: 't1',
      target_gid: 'dep1',
      link_type: LinkType.IS_DEPENDENT_ON,
    });
    expect(buffer.links[1]).toEqual({
      source_gid: 't1',
      target_gid: 'dep2',
      link_type: LinkType.IS_DEPENDENT_ON,
    });
  });

  it('should NOT create dependency links at depth > 0', async () => {
    const task = {
      gid: 'st1',
      dependencies: [{ gid: 'dep1' }],
    };
    const client = createMockAsanaClient();
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, createMockAdapter(), 1);

    const dependencyLinks = buffer.links.filter((l) => l.link_type === LinkType.IS_DEPENDENT_ON);
    expect(dependencyLinks).toHaveLength(0);
  });

  it('should recursively extract subtasks and create parent links', async () => {
    const task = { gid: 't1', num_subtasks: 1 };
    const client = createMockAsanaClient({
      subtasks: [{ gid: 'st1', name: 'Sub 1' }],
    });
    // Override getStoriesForTask to always return empty
    client.getStoriesForTask.mockResolvedValue({ data: { data: [], next_page: null } });
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, createMockAdapter(), 0);

    expect(buffer.tasks).toHaveLength(1);
    expect(buffer.subtasks).toHaveLength(1);
    expect(buffer.subtasks[0].gid).toBe('st1');
    expect(buffer.links).toContainEqual({
      source_gid: 't1',
      target_gid: 'st1',
      link_type: LinkType.IS_PARENT_OF,
    });
  });

  it('should skip subtasks at MAX_SUBTASK_DEPTH and log warning', async () => {
    const task = { gid: 't1', num_subtasks: 2 };
    const client = createMockAsanaClient();
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, createMockAdapter(), MAX_SUBTASK_DEPTH);

    // The task itself is added to subtasks (depth > 0), but its children are NOT fetched
    expect(buffer.subtasks).toHaveLength(1);
    expect(client.getSubtasksForTask).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('exceeds max depth')
    );
  });

  it('should filter attachments by extractFrom (lower bound)', async () => {
    const task = {
      gid: 't1',
      attachments: [
        { gid: 'att1', name: 'old.pdf', created_at: '2024-01-01T00:00:00Z', download_url: 'https://example.com/old.pdf' },
        { gid: 'att2', name: 'new.pdf', created_at: '2024-06-15T00:00:00Z', download_url: 'https://example.com/new.pdf' },
      ],
    };
    const client = createMockAsanaClient();
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, createMockAdapter(), 0, '2024-06-01T00:00:00Z');

    expect(buffer.attachments).toHaveLength(1);
    expect(buffer.attachments[0].gid).toBe('att2');
  });

  it('should filter attachments by extractTo (upper bound)', async () => {
    const task = {
      gid: 't1',
      attachments: [
        { gid: 'att1', name: 'old.pdf', created_at: '2024-01-01T00:00:00Z', download_url: 'https://example.com/old.pdf' },
        { gid: 'att2', name: 'new.pdf', created_at: '2024-06-15T00:00:00Z', download_url: 'https://example.com/new.pdf' },
      ],
    };
    const client = createMockAsanaClient();
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, createMockAdapter(), 0, undefined, '2024-03-01T00:00:00Z');

    expect(buffer.attachments).toHaveLength(1);
    expect(buffer.attachments[0].gid).toBe('att1');
  });

  it('should filter subtasks by extractFrom (lower bound)', async () => {
    const task = { gid: 't1', num_subtasks: 2 };
    const client = {
      getStoriesForTask: jest.fn().mockResolvedValue({ data: { data: [], next_page: null } }),
      getSubtasksForTask: jest.fn().mockResolvedValue({
        data: {
          data: [
            { gid: 'st1', created_at: '2024-01-01T00:00:00Z', modified_at: '2024-01-02T00:00:00Z' },
            { gid: 'st2', created_at: '2024-06-15T00:00:00Z', modified_at: '2024-06-15T00:00:00Z' },
          ],
          next_page: null,
        },
      }),
    } as any;
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, createMockAdapter(), 0, '2024-06-01T00:00:00Z');

    expect(buffer.subtasks).toHaveLength(1);
    expect(buffer.subtasks[0].gid).toBe('st2');
  });

  it('should filter subtasks by extractTo (upper bound)', async () => {
    const task = { gid: 't1', num_subtasks: 2 };
    const client = {
      getStoriesForTask: jest.fn().mockResolvedValue({ data: { data: [], next_page: null } }),
      getSubtasksForTask: jest.fn().mockResolvedValue({
        data: {
          data: [
            { gid: 'st1', created_at: '2024-01-01T00:00:00Z', modified_at: '2024-01-02T00:00:00Z' },
            { gid: 'st2', created_at: '2024-06-15T00:00:00Z', modified_at: '2024-06-15T00:00:00Z' },
          ],
          next_page: null,
        },
      }),
    } as any;
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, createMockAdapter(), 0, undefined, '2024-03-01T00:00:00Z');

    expect(buffer.subtasks).toHaveLength(1);
    expect(buffer.subtasks[0].gid).toBe('st1');
  });

  it('should not fetch comments or attachments when both are excluded from extraction scope', async () => {
    const task = {
      gid: 't1',
      attachments: [
        { gid: 'att1', name: 'file.pdf', download_url: 'https://example.com/file.pdf' },
      ],
    };
    const client = createMockAsanaClient({
      stories: [{ gid: 'c1', type: 'comment', text: 'A comment' }],
    });
    const buffer = createEmptyBuffer();
    const adapter = createMockAdapter();
    adapter.shouldExtract.mockImplementation((type: string) => type !== ItemType.COMMENTS && type !== ItemType.ATTACHMENTS);

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, adapter, 0);

    expect(client.getStoriesForTask).not.toHaveBeenCalled();
    expect(buffer.comments).toHaveLength(0);
    expect(buffer.attachments).toHaveLength(0);
  });

  it('should extract comments but not attachments when only attachments are excluded', async () => {
    const task = {
      gid: 't1',
      attachments: [
        { gid: 'att1', name: 'file.pdf', download_url: 'https://example.com/file.pdf' },
      ],
    };
    const client = createMockAsanaClient({
      stories: [{ gid: 'c1', type: 'comment', text: 'A real comment', created_at: '2024-01-01T00:00:00Z' }],
    });
    const buffer = createEmptyBuffer();
    const adapter = createMockAdapter();
    adapter.shouldExtract.mockImplementation((type: string) => type !== ItemType.ATTACHMENTS);

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, adapter, 0);

    expect(buffer.comments).toHaveLength(1);
    expect(buffer.attachments).toHaveLength(0);
  });

  it('should extract attachments but not comments when only comments are excluded', async () => {
    const task = {
      gid: 't1',
      attachments: [
        { gid: 'att1', name: 'file.pdf', download_url: 'https://example.com/file.pdf' },
      ],
    };
    const client = createMockAsanaClient({
      stories: [{ gid: 'c1', type: 'comment', text: 'A real comment' }],
    });
    const buffer = createEmptyBuffer();
    const adapter = createMockAdapter();
    adapter.shouldExtract.mockImplementation((type: string) => type !== ItemType.COMMENTS);

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, adapter, 0);

    expect(buffer.attachments).toHaveLength(1);
    expect(buffer.comments).toHaveLength(0);
  });

  it('should not create dependency links when links are excluded from extraction scope', async () => {
    const task = {
      gid: 't1',
      dependencies: [{ gid: 'dep1' }, { gid: 'dep2' }],
    };
    const client = createMockAsanaClient();
    const buffer = createEmptyBuffer();
    const adapter = createMockAdapter();
    adapter.shouldExtract.mockImplementation((type: string) => type !== ItemType.LINKS);

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, adapter, 0);

    expect(buffer.links).toHaveLength(0);
  });

  it('should not fetch subtasks when subtasks are excluded from extraction scope', async () => {
    const task = { gid: 't1', num_subtasks: 3 };
    const client = createMockAsanaClient({
      subtasks: [{ gid: 'st1', name: 'Sub 1' }],
    });
    const buffer = createEmptyBuffer();
    const adapter = createMockAdapter();
    adapter.shouldExtract.mockImplementation((type: string) => type !== ItemType.SUBTASKS);

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, adapter, 0);

    expect(client.getSubtasksForTask).not.toHaveBeenCalled();
    expect(buffer.subtasks).toHaveLength(0);
  });

  it('should not create parent links for subtasks when links are excluded', async () => {
    const task = { gid: 't1', num_subtasks: 1 };
    const client = createMockAsanaClient({
      subtasks: [{ gid: 'st1', name: 'Sub 1' }],
    });
    client.getStoriesForTask.mockResolvedValue({ data: { data: [], next_page: null } });
    const buffer = createEmptyBuffer();
    const adapter = createMockAdapter();
    adapter.shouldExtract.mockImplementation((type: string) => type !== ItemType.LINKS);

    await extractTaskWithSubtasks(task as any, client, 'proj1', buffer, adapter, 0);

    expect(buffer.subtasks).toHaveLength(1);
    expect(buffer.links).toHaveLength(0);
  });

  it('should filter comments by extractFrom (lower bound)', async () => {
    const client = createMockAsanaClient({
      stories: [
        { gid: 'c1', type: 'comment', text: 'Old comment', created_at: '2024-01-01T00:00:00Z' },
        { gid: 'c2', type: 'comment', text: 'New comment', created_at: '2024-06-15T00:00:00Z' },
      ],
    });
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks({ gid: 't1' } as any, client, 'proj1', buffer, createMockAdapter(), 0, '2024-06-01T00:00:00Z');

    expect(buffer.comments).toHaveLength(1);
    expect(buffer.comments[0].gid).toBe('c2');
  });

  it('should filter comments by extractTo (upper bound)', async () => {
    const client = createMockAsanaClient({
      stories: [
        { gid: 'c1', type: 'comment', text: 'Old comment', created_at: '2024-01-01T00:00:00Z' },
        { gid: 'c2', type: 'comment', text: 'New comment', created_at: '2024-06-15T00:00:00Z' },
      ],
    });
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks({ gid: 't1' } as any, client, 'proj1', buffer, createMockAdapter(), 0, undefined, '2024-03-01T00:00:00Z');

    expect(buffer.comments).toHaveLength(1);
    expect(buffer.comments[0].gid).toBe('c1');
  });

  it('should apply both extractFrom and extractTo together (window filtering)', async () => {
    const task = {
      gid: 't1',
      num_subtasks: 3,
      attachments: [
        { gid: 'att1', name: 'before.pdf', created_at: '2024-01-01T00:00:00Z', download_url: 'https://example.com/1.pdf' },
        { gid: 'att2', name: 'within.pdf', created_at: '2024-04-01T00:00:00Z', download_url: 'https://example.com/2.pdf' },
        { gid: 'att3', name: 'after.pdf', created_at: '2024-08-01T00:00:00Z', download_url: 'https://example.com/3.pdf' },
      ],
    };
    const client = {
      getStoriesForTask: jest.fn().mockImplementation((taskGid: string) => {
        // Only return comments for the main task, not for subtasks
        if (taskGid === 't1') {
          return Promise.resolve({
            data: {
              data: [
                { gid: 'c1', type: 'comment', text: 'Before', created_at: '2024-01-01T00:00:00Z' },
                { gid: 'c2', type: 'comment', text: 'Within', created_at: '2024-04-01T00:00:00Z' },
                { gid: 'c3', type: 'comment', text: 'After', created_at: '2024-08-01T00:00:00Z' },
              ],
              next_page: null,
            },
          });
        }
        return Promise.resolve({ data: { data: [], next_page: null } });
      }),
      getSubtasksForTask: jest.fn().mockResolvedValue({
        data: {
          data: [
            { gid: 'st1', created_at: '2024-01-01T00:00:00Z', modified_at: '2024-01-02T00:00:00Z' },
            { gid: 'st2', created_at: '2024-04-01T00:00:00Z', modified_at: '2024-04-15T00:00:00Z' },
            { gid: 'st3', created_at: '2024-08-01T00:00:00Z', modified_at: '2024-08-15T00:00:00Z' },
          ],
          next_page: null,
        },
      }),
    } as any;
    const buffer = createEmptyBuffer();

    await extractTaskWithSubtasks(
      task as any, client, 'proj1', buffer, createMockAdapter(), 0,
      '2024-03-01T00:00:00Z', '2024-06-01T00:00:00Z'
    );

    expect(buffer.attachments).toHaveLength(1);
    expect(buffer.attachments[0].gid).toBe('att2');
    expect(buffer.comments).toHaveLength(1);
    expect(buffer.comments[0].gid).toBe('c2');
    expect(buffer.subtasks).toHaveLength(1);
    expect(buffer.subtasks[0].gid).toBe('st2');
  });
});

describe('extractUsers', () => {
  const mockPush = jest.fn();

  function createMockAdapter(overrides?: { isTimeout?: boolean; offset?: string; total?: number }) {
    return {
      isTimeout: overrides?.isTimeout ?? false,
      state: {
        users: {
          completed: false,
          offset: overrides?.offset ?? '',
          total: overrides?.total ?? 0,
        },
      },
      getRepo: jest.fn().mockReturnValue({ push: mockPush }),
    } as any;
  }

  function createMockClient(options: { userPages: { users: any[]; nextOffset?: string }[] }) {
    let callIndex = 0;
    return {
      getUsersForWorkspace: jest.fn().mockImplementation(() => {
        const page = options.userPages[callIndex++] || { users: [] };
        return Promise.resolve({
          data: {
            data: page.users,
            next_page: page.nextOffset ? { offset: page.nextOffset } : null,
          },
        });
      }),
    } as any;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should extract all workspace users in a single page', async () => {
    const client = createMockClient({
      userPages: [
        {
          users: [
            { gid: 'u1', name: 'Alice', email: 'alice@example.com' },
            { gid: 'u2', name: 'Bob', email: 'bob@example.com' },
          ],
        },
      ],
    });
    const adapter = createMockAdapter();

    await extractUsers(client, adapter);

    expect(client.getUsersForWorkspace).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith([
      { gid: 'u1', name: 'Alice', email: 'alice@example.com' },
      { gid: 'u2', name: 'Bob', email: 'bob@example.com' },
    ]);
    expect(adapter.state.users.total).toBe(2);
  });

  it('should handle pagination across multiple pages', async () => {
    const client = createMockClient({
      userPages: [
        {
          users: [{ gid: 'u1', name: 'Alice', email: 'alice@example.com' }],
          nextOffset: 'page2',
        },
        {
          users: [{ gid: 'u2', name: 'Bob', email: 'bob@example.com' }],
        },
      ],
    });
    const adapter = createMockAdapter();

    await extractUsers(client, adapter);

    expect(client.getUsersForWorkspace).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(adapter.state.users.total).toBe(2);
    expect(adapter.state.users.offset).toBe('');
  });

  it('should handle empty workspace with no users', async () => {
    const client = createMockClient({
      userPages: [{ users: [] }],
    });
    const adapter = createMockAdapter();

    await extractUsers(client, adapter);

    expect(client.getUsersForWorkspace).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    expect(adapter.state.users.total).toBe(0);
  });

  it('should stop on timeout before any API call', async () => {
    const adapter = createMockAdapter({ isTimeout: true });
    const client = createMockClient({ userPages: [] });

    await extractUsers(client, adapter);

    expect(client.getUsersForWorkspace).not.toHaveBeenCalled();
  });

  it('should stop on timeout between pages and save offset for resumption', async () => {
    const client = createMockClient({
      userPages: [
        {
          users: [{ gid: 'u1', name: 'Alice', email: 'alice@example.com' }],
          nextOffset: 'page2',
        },
        {
          users: [{ gid: 'u2', name: 'Bob', email: 'bob@example.com' }],
        },
      ],
    });

    let callCount = 0;
    const adapter = createMockAdapter();
    Object.defineProperty(adapter, 'isTimeout', {
      get: () => {
        callCount++;
        // First check (before page 1): false
        // Second check (before page 2): true (timeout)
        return callCount > 1;
      },
    });

    await extractUsers(client, adapter);

    expect(client.getUsersForWorkspace).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(adapter.state.users.total).toBe(1);
    expect(adapter.state.users.offset).toBe('page2');
  });

  it('should resume from saved offset', async () => {
    const client = createMockClient({
      userPages: [
        {
          users: [{ gid: 'u3', name: 'Carol', email: 'carol@example.com' }],
        },
      ],
    });
    const adapter = createMockAdapter({ offset: 'page2', total: 2 });

    await extractUsers(client, adapter);

    expect(client.getUsersForWorkspace).toHaveBeenCalledWith({ offset: 'page2' });
    expect(adapter.state.users.total).toBe(3);
  });

  it('should push users to the correct repo', async () => {
    const client = createMockClient({
      userPages: [
        {
          users: [{ gid: 'u1', name: 'Alice', email: 'alice@example.com' }],
        },
      ],
    });
    const adapter = createMockAdapter();

    await extractUsers(client, adapter);

    expect(adapter.getRepo).toHaveBeenCalledWith(ItemType.USERS);
    expect(mockPush).toHaveBeenCalledWith([{ gid: 'u1', name: 'Alice', email: 'alice@example.com' }]);
  });
});

describe('extractTags', () => {
  const mockPush = jest.fn();

  function createMockAdapter(overrides?: { isTimeout?: boolean; offset?: string; total?: number }) {
    return {
      isTimeout: overrides?.isTimeout ?? false,
      state: {
        tags: {
          completed: false,
          offset: overrides?.offset ?? '',
          total: overrides?.total ?? 0,
        },
      },
      getRepo: jest.fn().mockReturnValue({ push: mockPush }),
    } as any;
  }

  function createMockClient(pages: { tags: any[]; nextOffset?: string }[]) {
    let callIndex = 0;
    return {
      getTagsForWorkspace: jest.fn().mockImplementation(() => {
        const page = pages[callIndex++] || { tags: [] };
        return Promise.resolve({
          data: {
            data: page.tags,
            next_page: page.nextOffset ? { offset: page.nextOffset } : null,
          },
        });
      }),
    } as any;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should extract all tags in a single page', async () => {
    const client = createMockClient([
      { tags: [{ gid: 'tag1', name: 'Bug' }, { gid: 'tag2', name: 'Feature' }] },
    ]);
    const adapter = createMockAdapter();

    await extractTags(client, adapter);

    expect(client.getTagsForWorkspace).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(adapter.state.tags.total).toBe(2);
  });

  it('should handle pagination across multiple pages', async () => {
    const client = createMockClient([
      { tags: [{ gid: 'tag1', name: 'Bug' }], nextOffset: 'page2' },
      { tags: [{ gid: 'tag2', name: 'Feature' }] },
    ]);
    const adapter = createMockAdapter();

    await extractTags(client, adapter);

    expect(client.getTagsForWorkspace).toHaveBeenCalledTimes(2);
    expect(adapter.state.tags.total).toBe(2);
  });

  it('should stop on timeout before any API call', async () => {
    const adapter = createMockAdapter({ isTimeout: true });
    const client = createMockClient([]);

    await extractTags(client, adapter);

    expect(client.getTagsForWorkspace).not.toHaveBeenCalled();
  });

  it('should stop on timeout between pages', async () => {
    const client = createMockClient([
      { tags: [{ gid: 'tag1' }], nextOffset: 'page2' },
      { tags: [{ gid: 'tag2' }] },
    ]);
    let callCount = 0;
    const adapter = createMockAdapter();
    Object.defineProperty(adapter, 'isTimeout', {
      get: () => {
        callCount++;
        return callCount > 1;
      },
    });

    await extractTags(client, adapter);

    expect(client.getTagsForWorkspace).toHaveBeenCalledTimes(1);
    expect(adapter.state.tags.total).toBe(1);
    expect(adapter.state.tags.offset).toBe('page2');
  });

  it('should push tags to the correct repo', async () => {
    const client = createMockClient([
      { tags: [{ gid: 'tag1', name: 'Bug' }] },
    ]);
    const adapter = createMockAdapter();

    await extractTags(client, adapter);

    expect(adapter.getRepo).toHaveBeenCalledWith(ItemType.TAGS);
  });

  it('should handle empty tag list', async () => {
    const client = createMockClient([{ tags: [] }]);
    const adapter = createMockAdapter();

    await extractTags(client, adapter);

    expect(adapter.state.tags.total).toBe(0);
  });
});

describe('prepareStateForExtraction - incremental resets all state', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation();
    initialState.users = { completed: false, offset: '', total: 0 };
    initialState.tasks = { completed: false, offset: '', total: 0, lastExtractedTaskIndex: -1 };
    initialState.attachments = { completed: false, total: 0 };
    initialState.comments = { completed: false, total: 0 };
    initialState.tags = { completed: false, offset: '', total: 0 };
    initialState.subtasks = { completed: false, total: 0 };
    initialState.links = { completed: false, total: 0 };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should reset all entity state on incremental sync', () => {
    const adapter = {
      event: {
        payload: {
          event_type: EventType.StartExtractingData,
          event_context: {
            mode: SyncMode.INCREMENTAL,
          },
        },
      },
      state: {
        users: { completed: true, offset: 'old', total: 50 },
        tasks: { completed: true, offset: 'old', total: 100, lastExtractedTaskIndex: 5 },
        attachments: { completed: true, total: 10 },
        comments: { completed: true, total: 20 },
        tags: { completed: true, offset: 'old', total: 5 },
        subtasks: { completed: true, total: 15 },
        links: { completed: true, total: 8 },
      },
    } as any;

    prepareStateForExtraction(adapter);

    expect(adapter.state.users.total).toBe(0);
    expect(adapter.state.tasks.total).toBe(0);
    expect(adapter.state.attachments.total).toBe(0);
    expect(adapter.state.comments.total).toBe(0);
  });
});

describe('fetchTeamMemberUserGids', () => {
  function createMockClient(pages: { memberships: any[]; nextOffset?: string }[]) {
    let callIndex = 0;
    return {
      getTeamMembershipsForTeam: jest.fn().mockImplementation(() => {
        const page = pages[callIndex++] || { memberships: [] };
        return Promise.resolve({
          data: {
            data: page.memberships,
            next_page: page.nextOffset ? { offset: page.nextOffset } : null,
          },
        });
      }),
    } as any;
  }

  it('should return user GIDs from team memberships', async () => {
    const client = createMockClient([
      { memberships: [{ user: { gid: 'u1' } }, { user: { gid: 'u2' } }] },
    ]);

    const result = await fetchTeamMemberUserGids('team1', client);

    expect(result).toEqual(['u1', 'u2']);
  });

  it('should paginate through multiple pages', async () => {
    const client = createMockClient([
      { memberships: [{ user: { gid: 'u1' } }], nextOffset: 'page2' },
      { memberships: [{ user: { gid: 'u2' } }] },
    ]);

    const result = await fetchTeamMemberUserGids('team1', client);

    expect(result).toEqual(['u1', 'u2']);
    expect(client.getTeamMembershipsForTeam).toHaveBeenCalledTimes(2);
  });

  it('should skip memberships without user GID', async () => {
    const client = createMockClient([
      { memberships: [{ user: { gid: 'u1' } }, { user: {} }, { user: null }] },
    ]);

    const result = await fetchTeamMemberUserGids('team1', client);

    expect(result).toEqual(['u1']);
  });

  it('should return empty array for team with no members', async () => {
    const client = createMockClient([{ memberships: [] }]);

    const result = await fetchTeamMemberUserGids('team1', client);

    expect(result).toEqual([]);
  });
});

describe('extractGroups', () => {
  const mockGroupPush = jest.fn();
  const mockMembershipPush = jest.fn();

  function createMockAdapter(overrides?: { isTimeout?: boolean }) {
    return {
      isTimeout: overrides?.isTimeout ?? false,
      shouldExtract: jest.fn().mockReturnValue(true),
      state: {
        groups: { completed: false, offset: '', total: 0 },
        group_memberships: { completed: false, total: 0 },
      },
      getRepo: jest.fn().mockImplementation((itemType: string) => {
        if (itemType === 'groups') return { push: mockGroupPush };
        if (itemType === 'group_memberships') return { push: mockMembershipPush };
        return null;
      }),
    } as any;
  }

  function createMockClient(options: {
    teamPages: { teams: any[]; nextOffset?: string }[];
    membershipPages?: { memberships: any[]; nextOffset?: string }[];
  }) {
    let teamCallIndex = 0;
    let memberCallIndex = 0;
    return {
      getTeamsForWorkspace: jest.fn().mockImplementation(() => {
        const page = options.teamPages[teamCallIndex++] || { teams: [] };
        return Promise.resolve({
          data: {
            data: page.teams,
            next_page: page.nextOffset ? { offset: page.nextOffset } : null,
          },
        });
      }),
      getTeamMembershipsForTeam: jest.fn().mockImplementation(() => {
        const pages = options.membershipPages || [{ memberships: [] }];
        const page = pages[memberCallIndex++] || { memberships: [] };
        return Promise.resolve({
          data: {
            data: page.memberships,
            next_page: page.nextOffset ? { offset: page.nextOffset } : null,
          },
        });
      }),
    } as any;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should extract groups and their memberships', async () => {
    const client = createMockClient({
      teamPages: [{ teams: [{ gid: 'team1', name: 'Engineering' }] }],
      membershipPages: [{ memberships: [{ user: { gid: 'u1' } }, { user: { gid: 'u2' } }] }],
    });
    const adapter = createMockAdapter();

    await extractGroups(client, adapter);

    expect(mockGroupPush).toHaveBeenCalledTimes(1);
    expect(mockMembershipPush).toHaveBeenCalledTimes(1);
    expect(adapter.state.groups.total).toBe(1);
    expect(adapter.state.group_memberships.total).toBe(1);
  });

  it('should skip teams without GID', async () => {
    const client = createMockClient({
      teamPages: [{ teams: [{ name: 'No GID Team' }] }],
    });
    const adapter = createMockAdapter();

    await extractGroups(client, adapter);

    expect(mockGroupPush).not.toHaveBeenCalled();
    expect(adapter.state.groups.total).toBe(0);
  });

  it('should not push membership when team has no members', async () => {
    const client = createMockClient({
      teamPages: [{ teams: [{ gid: 'team1', name: 'Empty Team' }] }],
      membershipPages: [{ memberships: [] }],
    });
    const adapter = createMockAdapter();

    await extractGroups(client, adapter);

    expect(mockGroupPush).toHaveBeenCalledTimes(1);
    expect(mockMembershipPush).not.toHaveBeenCalled();
    expect(adapter.state.groups.total).toBe(1);
    expect(adapter.state.group_memberships.total).toBe(0);
  });

  it('should stop on timeout before API call', async () => {
    const adapter = createMockAdapter({ isTimeout: true });
    const client = createMockClient({ teamPages: [] });

    await extractGroups(client, adapter);

    expect(client.getTeamsForWorkspace).not.toHaveBeenCalled();
  });

  it('should stop on timeout between teams', async () => {
    const client = createMockClient({
      teamPages: [{ teams: [{ gid: 'team1', name: 'Team 1' }, { gid: 'team2', name: 'Team 2' }] }],
      membershipPages: [{ memberships: [{ user: { gid: 'u1' } }] }],
    });
    let callCount = 0;
    const adapter = createMockAdapter();
    Object.defineProperty(adapter, 'isTimeout', {
      get: () => {
        callCount++;
        // First check (outer loop): false, Second check (inner loop after first team): true
        return callCount > 2;
      },
    });

    await extractGroups(client, adapter);

    expect(adapter.state.groups.total).toBe(1);
  });

  it('should use fallback name for team without a name', async () => {
    const client = createMockClient({
      teamPages: [{ teams: [{ gid: 'team1' }] }],
      membershipPages: [{ memberships: [] }],
    });
    const adapter = createMockAdapter();

    await extractGroups(client, adapter);

    expect(mockGroupPush).toHaveBeenCalledTimes(1);
    const pushedItem = mockGroupPush.mock.calls[0][0][0];
    expect(pushedItem.id).toBe('team1');
  });

  it('should skip group memberships when group_memberships is excluded from extraction scope', async () => {
    const client = createMockClient({
      teamPages: [{ teams: [{ gid: 'team1', name: 'Engineering' }] }],
      membershipPages: [{ memberships: [{ user: { gid: 'u1' } }, { user: { gid: 'u2' } }] }],
    });
    const adapter = createMockAdapter();
    adapter.shouldExtract.mockImplementation((type: string) => type !== ItemType.GROUP_MEMBERSHIPS);

    await extractGroups(client, adapter);

    expect(mockGroupPush).toHaveBeenCalledTimes(1);
    expect(mockMembershipPush).not.toHaveBeenCalled();
    expect(client.getTeamMembershipsForTeam).not.toHaveBeenCalled();
    expect(adapter.state.groups.total).toBe(1);
    expect(adapter.state.group_memberships.total).toBe(0);
  });

  it('should paginate through multiple pages of teams', async () => {
    const client = createMockClient({
      teamPages: [
        { teams: [{ gid: 'team1', name: 'Team 1' }], nextOffset: 'page2' },
        { teams: [{ gid: 'team2', name: 'Team 2' }] },
      ],
      membershipPages: [
        { memberships: [] },
        { memberships: [] },
      ],
    });
    const adapter = createMockAdapter();

    await extractGroups(client, adapter);

    expect(client.getTeamsForWorkspace).toHaveBeenCalledTimes(2);
    expect(adapter.state.groups.total).toBe(2);
  });
});

describe('extractTasks', () => {
  const mockPush = jest.fn();

  function createMockAdapter(overrides?: {
    isTimeout?: boolean;
    offset?: string;
    total?: number;
    extractFrom?: string;
    extractTo?: string;
    lastExtractedTaskIndex?: number;
  }) {
    return {
      isTimeout: overrides?.isTimeout ?? false,
      shouldExtract: jest.fn().mockReturnValue(true),
      event: {
        payload: {
          event_context: {
            extract_from: overrides?.extractFrom,
            extract_to: overrides?.extractTo,
          },
        },
      },
      state: {
        tasks: {
          completed: false,
          offset: overrides?.offset ?? '',
          total: overrides?.total ?? 0,
          lastExtractedTaskIndex: overrides?.lastExtractedTaskIndex ?? -1,
        },
        subtasks: { completed: false, total: 0 },
        comments: { completed: false, total: 0 },
        attachments: { completed: false, total: 0 },
        links: { completed: false, total: 0 },
      },
      getRepo: jest.fn().mockReturnValue({ push: mockPush }),
    } as any;
  }

  function createMockClient(options: {
    taskPages: { tasks: any[]; nextOffset?: string }[];
    stories?: any[];
    subtasks?: any[];
  }) {
    let taskCallIndex = 0;
    return {
      projectId: 'proj1',
      getTasks: jest.fn().mockImplementation(() => {
        const page = options.taskPages[taskCallIndex++] || { tasks: [] };
        return Promise.resolve({
          data: {
            data: page.tasks,
            next_page: page.nextOffset ? { offset: page.nextOffset } : null,
          },
        });
      }),
      getStoriesForTask: jest.fn().mockResolvedValue({
        data: { data: options?.stories ?? [], next_page: null },
      }),
      getSubtasksForTask: jest.fn().mockResolvedValue({
        data: { data: options?.subtasks ?? [], next_page: null },
      }),
    } as any;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should extract tasks from a single page', async () => {
    const client = createMockClient({
      taskPages: [{ tasks: [{ gid: 't1', name: 'Task 1' }, { gid: 't2', name: 'Task 2' }] }],
    });
    const adapter = createMockAdapter();

    await extractTasks(client, adapter);

    expect(adapter.state.tasks.total).toBe(2);
    expect(adapter.state.tasks.offset).toBe('');
  });

  it('should paginate through multiple pages', async () => {
    const client = createMockClient({
      taskPages: [
        { tasks: [{ gid: 't1', name: 'Task 1' }], nextOffset: 'page2' },
        { tasks: [{ gid: 't2', name: 'Task 2' }] },
      ],
    });
    const adapter = createMockAdapter();

    await extractTasks(client, adapter);

    expect(client.getTasks).toHaveBeenCalledTimes(2);
    expect(adapter.state.tasks.total).toBe(2);
  });

  it('should stop on timeout before any API call', async () => {
    const adapter = createMockAdapter({ isTimeout: true });
    const client = createMockClient({ taskPages: [] });

    await extractTasks(client, adapter);

    expect(client.getTasks).not.toHaveBeenCalled();
  });

  it('should stop on timeout between tasks and save index', async () => {
    const client = createMockClient({
      taskPages: [{ tasks: [{ gid: 't1' }, { gid: 't2' }, { gid: 't3' }] }],
    });
    let callCount = 0;
    const adapter = createMockAdapter();
    Object.defineProperty(adapter, 'isTimeout', {
      get: () => {
        callCount++;
        // Becomes true after processing first task
        return callCount > 3;
      },
    });

    await extractTasks(client, adapter);

    expect(adapter.state.tasks.lastExtractedTaskIndex).toBeGreaterThanOrEqual(0);
  });

  it('should resume from saved lastExtractedTaskIndex', async () => {
    const client = createMockClient({
      taskPages: [{ tasks: [{ gid: 't1' }, { gid: 't2' }, { gid: 't3' }] }],
    });
    const adapter = createMockAdapter({ lastExtractedTaskIndex: 0 });

    await extractTasks(client, adapter);

    // Should start from index 1 (skipping index 0)
    expect(adapter.state.tasks.total).toBe(2);
  });

  it('should handle empty task list', async () => {
    const client = createMockClient({
      taskPages: [{ tasks: [] }],
    });
    const adapter = createMockAdapter();

    await extractTasks(client, adapter);

    expect(adapter.state.tasks.total).toBe(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('should pass extract_from as modified_since to API', async () => {
    const client = createMockClient({
      taskPages: [{ tasks: [] }],
    });
    const adapter = createMockAdapter({ extractFrom: '2024-06-01T00:00:00Z' });

    await extractTasks(client, adapter);

    expect(client.getTasks).toHaveBeenCalledWith(
      expect.objectContaining({ modified_since: '2024-06-01T00:00:00Z' })
    );
  });

  it('should skip tasks where all timestamps exceed extractTo', async () => {
    const client = createMockClient({
      taskPages: [{
        tasks: [
          { gid: 't1', created_at: '2024-01-01T00:00:00Z', modified_at: '2024-02-01T00:00:00Z' },
          { gid: 't2', created_at: '2024-07-01T00:00:00Z', modified_at: '2024-08-01T00:00:00Z' },
        ],
      }],
    });
    const adapter = createMockAdapter({ extractTo: '2024-06-01T00:00:00Z' });

    await extractTasks(client, adapter);

    expect(adapter.state.tasks.total).toBe(1);
  });

  it('should include tasks where created_at is within window even if modified_at exceeds extractTo', async () => {
    const client = createMockClient({
      taskPages: [{
        tasks: [
          { gid: 't1', created_at: '2024-04-01T00:00:00Z', modified_at: '2024-08-01T00:00:00Z' },
        ],
      }],
    });
    const adapter = createMockAdapter({ extractTo: '2024-06-01T00:00:00Z' });

    await extractTasks(client, adapter);

    // created_at is before extractTo, so task is included despite modified_at being after
    expect(adapter.state.tasks.total).toBe(1);
  });

  it('should reset lastExtractedTaskIndex after completing a page', async () => {
    const client = createMockClient({
      taskPages: [{ tasks: [{ gid: 't1' }] }],
    });
    const adapter = createMockAdapter();

    await extractTasks(client, adapter);

    expect(adapter.state.tasks.lastExtractedTaskIndex).toBe(-1);
  });
});
