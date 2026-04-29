import {
  normalizeAsanaAttachment,
  normalizeAsanaComment,
  normalizeAsanaLink,
  normalizeAsanaSubtask,
  normalizeAsanaTag,
  normalizeAsanaTask,
  normalizeAsanaUser,
} from './data-normalization';
import type { AsanaAttachment, AsanaLink, AsanaStory, AsanaTag, AsanaTask, AsanaUser } from './types';

beforeAll(() => {
  jest.useFakeTimers({ now: new Date('2025-06-15T12:00:00.000Z') });
});

afterAll(() => {
  jest.useRealTimers();
});

// NormalizedItem.data is typed as `object`, so we cast to Record for property access in tests.
type Data = Record<string, unknown>;

describe('normalizeAsanaUser', () => {
  it('should normalize a user with all fields', () => {
    const user: AsanaUser = {
      gid: 'u1',
      name: 'Alice Smith',
      email: 'alice@example.com',
    };

    const result = normalizeAsanaUser(user);
    const data = result.data as Data;

    expect(result.id).toBe('u1');
    expect(data.display_name).toBe('Alice Smith');
    expect(data.email).toBe('alice@example.com');
    expect(data.full_name).toBe('Alice Smith');
  });

  it('should handle missing name and email', () => {
    const user: AsanaUser = { gid: 'u2' };

    const result = normalizeAsanaUser(user);
    const data = result.data as Data;

    expect(result.id).toBe('u2');
    expect(data.display_name).toBeNull();
    expect(data.email).toBeNull();
    expect(data.full_name).toBeNull();
  });

  it('should set created_date and modified_date to current time', () => {
    const user: AsanaUser = { gid: 'u3', name: 'Bob' };

    const result = normalizeAsanaUser(user);

    expect(result.created_date).toBe('2025-06-15T12:00:00.000Z');
    expect(result.modified_date).toBe('2025-06-15T12:00:00.000Z');
  });
});

describe('normalizeAsanaTag', () => {
  it('should normalize a tag with all fields', () => {
    const tag: AsanaTag = {
      gid: 't1',
      name: 'Bug',
      color: 'dark-red' as AsanaTag['color'],
      notes: 'Indicates a bug report',
      created_at: '2025-01-10T09:00:00.000Z',
    };

    const result = normalizeAsanaTag(tag);
    const data = result.data as Data;

    expect(result.id).toBe('t1');
    expect(result.created_date).toBe('2025-01-10T09:00:00.000Z');
    expect(result.modified_date).toBe('2025-01-10T09:00:00.000Z');
    expect(data.name).toBe('Bug');
    expect(data.color).toBe('dark-red');
    expect(data.description).toBe('Indicates a bug report');
  });

  it('should handle missing optional fields', () => {
    const tag: AsanaTag = { gid: 't2', name: 'Feature' };

    const result = normalizeAsanaTag(tag);
    const data = result.data as Data;

    expect(data.color).toBeNull();
    expect(data.description).toBeNull();
  });

  it('should fall back to current time when created_at is missing', () => {
    const tag: AsanaTag = { gid: 't3', name: 'Docs' };

    const result = normalizeAsanaTag(tag);

    expect(result.created_date).toBe('2025-06-15T12:00:00.000Z');
  });
});

describe('normalizeAsanaTask', () => {
  const fullTask: AsanaTask = {
    gid: 'task1',
    name: 'Implement feature',
    html_notes: '<body>Description here</body>',
    assignee: { gid: 'u1', name: 'Alice' },
    created_by: { gid: 'u2' },
    completed: false,
    completed_at: undefined,
    completed_by: undefined,
    created_at: '2025-03-01T10:00:00.000Z',
    modified_at: '2025-03-05T14:00:00.000Z',
    due_on: '2025-04-01',
    start_on: '2025-03-10',
    permalink_url: 'https://app.asana.com/0/project/task1',
    actual_time_minutes: 120,
    resource_subtype: 'default_task',
    tags: [{ gid: 'tag1', name: 'Bug' }],
    followers: [{ gid: 'u3', name: 'Carol' }],
    parent: undefined,
    memberships: [
      { project: { gid: 'proj1', name: 'Project' }, section: { gid: 'sec2', name: 'In Progress' } },
    ],
    custom_fields: [
      { gid: 'cf1', name: 'Priority', type: 'text', text_value: 'High' },
    ],
  };

  it('should normalize a full task with all fields', () => {
    const result = normalizeAsanaTask(fullTask);
    const data = result.data as Data;

    expect(result.id).toBe('task1');
    expect(result.created_date).toBe('2025-03-01T10:00:00.000Z');
    expect(result.modified_date).toBe('2025-03-05T14:00:00.000Z');
    expect(data.name).toBe('Implement feature');
    expect(data.assignee).toBe('u1');
    expect(data.created_by).toBe('u2');
    expect(data.completed).toBe(false);
    expect(data.item_url_field).toBe('https://app.asana.com/0/project/task1');
    expect(data.actual_effort).toBe(120);
    expect(data.resource_subtype).toBe('default_task');
    expect(data.tags).toEqual(['tag1']);
    expect(data.followers).toEqual(['u3']);
  });

  it('should extract section from memberships', () => {
    const result = normalizeAsanaTask(fullTask);
    const data = result.data as Data;

    expect(data.section).toBe('sec2');
  });

  it('should convert due_on date-only string to ISO timestamp', () => {
    const result = normalizeAsanaTask(fullTask);
    const data = result.data as Data;

    expect(data.due_date).toBe('2025-04-01T00:00:00.000Z');
  });

  it('should convert start_on date-only string to ISO timestamp', () => {
    const result = normalizeAsanaTask(fullTask);
    const data = result.data as Data;

    expect(data.start_date).toBe('2025-03-10T00:00:00.000Z');
  });

  it('should prefer due_at over due_on when both exist', () => {
    const task: AsanaTask = {
      ...fullTask,
      due_at: '2025-04-01T17:00:00.000Z',
      due_on: '2025-04-01',
    };

    const result = normalizeAsanaTask(task);
    const data = result.data as Data;

    expect(data.due_date).toBe('2025-04-01T17:00:00.000Z');
  });

  it('should extract custom fields by GID', () => {
    const result = normalizeAsanaTask(fullTask);
    const data = result.data as Data;

    expect(data['cf1']).toBe('High');
  });

  it('should parse HTML description into rich text', () => {
    const result = normalizeAsanaTask(fullTask);
    const data = result.data as Data;

    expect(data.description).toEqual(['Description here']);
  });

  it('should handle null assignee', () => {
    const task: AsanaTask = { ...fullTask, assignee: undefined };

    const result = normalizeAsanaTask(task);
    const data = result.data as Data;

    expect(data.assignee).toBeNull();
  });

  it('should handle task with no memberships', () => {
    const task: AsanaTask = { ...fullTask, memberships: undefined };

    const result = normalizeAsanaTask(task);
    const data = result.data as Data;

    expect(data.section).toBeNull();
  });

  it('should handle completed task with completed_at and completed_by', () => {
    const task: AsanaTask = {
      ...fullTask,
      completed: true,
      completed_at: '2025-03-20T16:00:00.000Z',
      completed_by: { gid: 'u4' },
    };

    const result = normalizeAsanaTask(task);
    const data = result.data as Data;

    expect(data.completed).toBe(true);
    expect(data.completed_at).toBe('2025-03-20T16:00:00.000Z');
    expect(data.completed_by).toBe('u4');
  });

  it('should handle task with parent reference', () => {
    const task: AsanaTask = {
      ...fullTask,
      parent: { gid: 'parent1', name: 'Parent Task' },
    };

    const result = normalizeAsanaTask(task);
    const data = result.data as Data;

    expect(data.parent_task).toBe('parent1');
  });

  it('should map reported_by to created_by gid', () => {
    const result = normalizeAsanaTask(fullTask);
    const data = result.data as Data;

    expect(data.reported_by).toBe('u2');
  });

  it('should handle task with no tags or followers', () => {
    const task: AsanaTask = {
      ...fullTask,
      tags: undefined,
      followers: undefined,
    };

    const result = normalizeAsanaTask(task);
    const data = result.data as Data;

    expect(data.tags).toBeNull();
    expect(data.followers).toBeNull();
  });

  it('should handle null html_notes', () => {
    const task: AsanaTask = { ...fullTask, html_notes: undefined };

    const result = normalizeAsanaTask(task);
    const data = result.data as Data;

    expect(data.description).toBeNull();
  });

  it('should fall back to current time when created_at is missing', () => {
    const task: AsanaTask = { ...fullTask, created_at: undefined };

    const result = normalizeAsanaTask(task);

    expect(result.created_date).toBe('2025-06-15T12:00:00.000Z');
  });
});

describe('normalizeAsanaSubtask', () => {
  const baseSubtask: AsanaTask = {
    gid: 'sub1',
    name: 'Subtask 1',
    html_notes: '<body>Sub description</body>',
    assignee: { gid: 'u1' },
    created_by: { gid: 'u2' },
    completed: false,
    created_at: '2025-03-02T10:00:00.000Z',
    modified_at: '2025-03-06T14:00:00.000Z',
    permalink_url: 'https://app.asana.com/0/project/sub1',
    tags: [],
    followers: [],
  };

  it('should set completed_stage to open for incomplete subtask', () => {
    const result = normalizeAsanaSubtask(baseSubtask);
    const data = result.data as Data;

    expect(data.completed_stage).toBe('open');
  });

  it('should set completed_stage to completed for completed subtask', () => {
    const subtask: AsanaTask = { ...baseSubtask, completed: true };

    const result = normalizeAsanaSubtask(subtask);
    const data = result.data as Data;

    expect(data.completed_stage).toBe('completed');
  });

  it('should not include section field (subtasks use completed_stage instead)', () => {
    const result = normalizeAsanaSubtask(baseSubtask);
    const data = result.data as Data;

    expect(data).not.toHaveProperty('section');
  });

  it('should normalize basic fields like a task', () => {
    const result = normalizeAsanaSubtask(baseSubtask);
    const data = result.data as Data;

    expect(result.id).toBe('sub1');
    expect(data.name).toBe('Subtask 1');
    expect(data.assignee).toBe('u1');
    expect(data.created_by).toBe('u2');
  });

  it('should extract custom fields for subtasks', () => {
    const subtask: AsanaTask = {
      ...baseSubtask,
      custom_fields: [
        { gid: 'cf1', name: 'Points', type: 'number', number_value: 5 },
      ],
    };

    const result = normalizeAsanaSubtask(subtask);
    const data = result.data as Data;

    expect(data['cf1']).toBe(5);
  });
});

describe('normalizeAsanaAttachment', () => {
  it('should normalize an attachment with all fields', () => {
    const attachment: AsanaAttachment = {
      gid: 'att1',
      download_url: 'https://example.com/file.pdf',
      name: 'report.pdf',
      parent_id: 'task1',
      inline: false,
    };

    const result = normalizeAsanaAttachment(attachment);

    expect(result.id).toBe('att1');
    expect(result.url).toBe('https://example.com/file.pdf');
    expect(result.file_name).toBe('report.pdf');
    expect(result.parent_id).toBe('task1');
    expect(result.inline).toBe(false);
  });

  it('should handle inline attachment', () => {
    const attachment: AsanaAttachment = {
      gid: 'att2',
      download_url: 'https://example.com/image.png',
      name: 'screenshot.png',
      parent_id: 'task1',
      inline: true,
    };

    const result = normalizeAsanaAttachment(attachment);

    expect(result.inline).toBe(true);
  });

  it('should default missing fields to empty strings/false', () => {
    const attachment: AsanaAttachment = { gid: 'att3' };

    const result = normalizeAsanaAttachment(attachment);

    expect(result.url).toBe('');
    expect(result.file_name).toBe('');
    expect(result.parent_id).toBe('');
    expect(result.inline).toBe(false);
  });
});

describe('normalizeAsanaComment', () => {
  it('should normalize a comment with html_text', () => {
    const comment: AsanaStory = {
      gid: 'c1',
      html_text: '<body>This is a comment</body>',
      text: 'This is a comment',
      created_at: '2025-03-10T08:00:00.000Z',
      created_by: { gid: 'u1', name: 'Alice' },
      target: { gid: 'task1' },
      type: 'comment',
    };

    const result = normalizeAsanaComment(comment);
    const data = result.data as Data;

    expect(result.id).toBe('c1');
    expect(result.created_date).toBe('2025-03-10T08:00:00.000Z');
    expect(data.parent_id).toBe('task1');
    expect(data.author).toBe('u1');
    expect(data.body).toEqual(['This is a comment']);
  });

  it('should fall back to text when html_text is missing', () => {
    const comment: AsanaStory = {
      gid: 'c2',
      text: 'Plain text comment',
      created_at: '2025-03-10T08:00:00.000Z',
      created_by: { gid: 'u1' },
      target: { gid: 'task1' },
      type: 'comment',
    };

    const result = normalizeAsanaComment(comment);
    const data = result.data as Data;

    expect(data.body).toEqual(['Plain text comment']);
  });

  it('should handle missing author and target', () => {
    const comment: AsanaStory = {
      gid: 'c3',
      html_text: '<body>Orphan comment</body>',
      type: 'comment',
    };

    const result = normalizeAsanaComment(comment);
    const data = result.data as Data;

    expect(data.parent_id).toBeNull();
    expect(data.author).toBeNull();
  });

  it('should use same timestamp for created and modified dates', () => {
    const comment: AsanaStory = {
      gid: 'c4',
      html_text: '<body>Test</body>',
      created_at: '2025-05-01T12:00:00.000Z',
      type: 'comment',
    };

    const result = normalizeAsanaComment(comment);

    expect(result.created_date).toBe('2025-05-01T12:00:00.000Z');
    expect(result.modified_date).toBe('2025-05-01T12:00:00.000Z');
  });

  it('should fall back to current time when created_at is missing', () => {
    const comment: AsanaStory = {
      gid: 'c5',
      html_text: '<body>No date</body>',
      type: 'comment',
    };

    const result = normalizeAsanaComment(comment);

    expect(result.created_date).toBe('2025-06-15T12:00:00.000Z');
  });
});

describe('normalizeAsanaLink', () => {
  it('should normalize a parent-child link', () => {
    const link: AsanaLink = {
      link_type: 'is_parent_of',
      source_gid: 'task1',
      target_gid: 'sub1',
    };

    const result = normalizeAsanaLink(link);
    const data = result.data as Data;

    expect(result.id).toBe('is_parent_of_task1_sub1');
    expect(data.source).toBe('task1');
    expect(data.target).toBe('sub1');
    expect(data.link_type).toBe('is_parent_of');
  });

  it('should normalize a dependency link', () => {
    const link: AsanaLink = {
      link_type: 'is_dependent_on',
      source_gid: 'task2',
      target_gid: 'task3',
    };

    const result = normalizeAsanaLink(link);
    const data = result.data as Data;

    expect(result.id).toBe('is_dependent_on_task2_task3');
    expect(data.source).toBe('task2');
    expect(data.target).toBe('task3');
    expect(data.link_type).toBe('is_dependent_on');
  });

  it('should generate deterministic IDs from link type and GIDs', () => {
    const link: AsanaLink = {
      link_type: 'is_parent_of',
      source_gid: 'a',
      target_gid: 'b',
    };

    const result1 = normalizeAsanaLink(link);
    const result2 = normalizeAsanaLink(link);

    expect(result1.id).toBe(result2.id);
  });

  it('should generate different IDs for different links', () => {
    const link1: AsanaLink = { link_type: 'is_parent_of', source_gid: 'a', target_gid: 'b' };
    const link2: AsanaLink = { link_type: 'is_dependent_on', source_gid: 'a', target_gid: 'b' };

    expect(normalizeAsanaLink(link1).id).not.toBe(normalizeAsanaLink(link2).id);
  });
});

