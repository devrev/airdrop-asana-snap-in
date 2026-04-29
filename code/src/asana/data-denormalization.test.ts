import { denormalizeComment, denormalizeLink, denormalizeTask } from './data-denormalization';

const mockResolveId = (mapping: Record<string, string>) => {
  return async (id: string): Promise<string | null> => mapping[id] ?? null;
};

describe('denormalizeTask', () => {
  const resolveId = mockResolveId({
    'devrev-user-1': 'asana-user-1',
    'devrev-section-1': 'asana-section-1',
    'devrev-tag-1': 'asana-tag-1',
    'devrev-tag-2': 'asana-tag-2',
  });

  it('should denormalize a full task with all fields', async () => {
    const data = {
      name: 'My Task',
      assignee: 'devrev-user-1',
      description: ['Hello world'],
      due_date: '2024-06-15T00:00:00Z',
      start_date: '2024-06-01',
      completed: true,
      section: 'devrev-section-1',
      tags: ['devrev-tag-1', 'devrev-tag-2'],
    };

    const result = await denormalizeTask(data, resolveId);

    expect(result.createRequest.data).toMatchObject({
      name: 'My Task',
      assignee: 'asana-user-1',
      notes: 'Hello world',
      due_on: '2024-06-15',
      start_on: '2024-06-01',
      completed: true,
    });
    expect(result.sectionGid).toBe('asana-section-1');
    expect(result.tagGids).toEqual(['asana-tag-1', 'asana-tag-2']);
  });

  it('should use first element when assignee is an array', async () => {
    const data = { assignee: ['devrev-user-1', 'devrev-user-2'] };
    const result = await denormalizeTask(data, resolveId);
    expect(result.createRequest.data?.assignee).toBe('asana-user-1');
  });

  it('should handle string assignee', async () => {
    const data = { assignee: 'devrev-user-1' };
    const result = await denormalizeTask(data, resolveId);
    expect(result.createRequest.data?.assignee).toBe('asana-user-1');
  });

  it('should set assignee to null when unresolvable', async () => {
    const data = { assignee: 'unknown-user' };
    const result = await denormalizeTask(data, resolveId);
    expect(result.createRequest.data?.assignee).toBeNull();
  });

  it('should convert ISO timestamp to YYYY-MM-DD for dates', async () => {
    const data = { due_date: '2024-12-31T23:59:59.000Z', start_date: '2024-01-01T00:00:00Z' };
    const result = await denormalizeTask(data, resolveId);
    expect(result.createRequest.data?.due_on).toBe('2024-12-31');
    expect(result.createRequest.data?.start_on).toBe('2024-01-01');
  });

  it('should pass through YYYY-MM-DD dates as-is', async () => {
    const data = { due_date: '2024-06-15', start_date: '2024-01-01' };
    const result = await denormalizeTask(data, resolveId);
    expect(result.createRequest.data?.due_on).toBe('2024-06-15');
    expect(result.createRequest.data?.start_on).toBe('2024-01-01');
  });

  it('should handle null dates', async () => {
    const data = { due_date: null, start_date: null };
    const result = await denormalizeTask(data, resolveId);
    expect(result.createRequest.data?.due_on).toBeNull();
    expect(result.createRequest.data?.start_on).toBeNull();
  });

  it('should skip unresolvable tags', async () => {
    const data = { tags: ['devrev-tag-1', 'unknown-tag'] };
    const result = await denormalizeTask(data, resolveId);
    expect(result.tagGids).toEqual(['asana-tag-1']);
  });

  it('should handle null section', async () => {
    const data = { section: null };
    const result = await denormalizeTask(data, resolveId);
    expect(result.sectionGid).toBeNull();
  });

  it('should handle empty data', async () => {
    const result = await denormalizeTask({}, resolveId);
    expect(result.createRequest.data?.assignee).toBeNull();
    expect(result.sectionGid).toBeNull();
    expect(result.tagGids).toEqual([]);
  });

  it('should produce identical createRequest and updateRequest', async () => {
    const data = { name: 'Test', assignee: 'devrev-user-1' };
    const result = await denormalizeTask(data, resolveId);
    expect(result.createRequest).toEqual(result.updateRequest);
  });
});

describe('denormalizeComment', () => {
  const resolveId = mockResolveId({
    'devrev-task-1': 'asana-task-1',
  });

  it('should denormalize a comment with parent and body', async () => {
    const data = {
      parent_id: 'devrev-task-1',
      body: ['Check this out'],
    };

    const result = await denormalizeComment(data, resolveId);

    expect(result.parentGid).toBe('asana-task-1');
    expect(result.request.data?.html_text).toBe('<body>Check this out</body>');
  });

  it('should return null parentGid when parent is unresolvable', async () => {
    const data = { parent_id: 'unknown-task', body: ['text'] };
    const result = await denormalizeComment(data, resolveId);
    expect(result.parentGid).toBeNull();
  });

  it('should return null parentGid when parent_id is null', async () => {
    const data = { parent_id: null, body: ['text'] };
    const result = await denormalizeComment(data, resolveId);
    expect(result.parentGid).toBeNull();
  });

  it('should handle null body', async () => {
    const data = { parent_id: 'devrev-task-1', body: null };
    const result = await denormalizeComment(data, resolveId);
    expect(result.request.data?.html_text).toBe('');
  });

  it('should handle rich text with mentions', async () => {
    const data = {
      parent_id: 'devrev-task-1',
      body: ['Hello ', { ref_type: 'users', id: '123', fallback_record_name: 'John' }],
    };

    const result = await denormalizeComment(data, resolveId);
    expect(result.request.data?.html_text).toContain('Hello');
    expect(result.request.data?.html_text).toContain('data-asana-gid="123"');
  });
});

describe('denormalizeLink', () => {
  const resolveId = mockResolveId({
    'devrev-task-1': 'asana-task-1',
    'devrev-task-2': 'asana-task-2',
  });

  it('should denormalize a valid link', async () => {
    const data = {
      link_type: 'is_dependent_on',
      source: 'devrev-task-1',
      target: 'devrev-task-2',
    };

    const result = await denormalizeLink(data, resolveId);

    expect(result).toEqual({
      linkType: 'is_dependent_on',
      sourceGid: 'asana-task-1',
      targetGid: 'asana-task-2',
    });
  });

  it('should return null when link_type is missing', async () => {
    const data = { source: 'devrev-task-1', target: 'devrev-task-2' };
    const result = await denormalizeLink(data, resolveId);
    expect(result).toBeNull();
  });

  it('should return null when source is missing', async () => {
    const data = { link_type: 'is_dependent_on', target: 'devrev-task-2' };
    const result = await denormalizeLink(data, resolveId);
    expect(result).toBeNull();
  });

  it('should return null when target is missing', async () => {
    const data = { link_type: 'is_dependent_on', source: 'devrev-task-1' };
    const result = await denormalizeLink(data, resolveId);
    expect(result).toBeNull();
  });

  it('should return null when source GID is unresolvable', async () => {
    const data = { link_type: 'is_dependent_on', source: 'unknown', target: 'devrev-task-2' };
    const result = await denormalizeLink(data, resolveId);
    expect(result).toBeNull();
  });

  it('should return null when target GID is unresolvable', async () => {
    const data = { link_type: 'is_dependent_on', source: 'devrev-task-1', target: 'unknown' };
    const result = await denormalizeLink(data, resolveId);
    expect(result).toBeNull();
  });

  it('should handle is_parent_of link type', async () => {
    const data = { link_type: 'is_parent_of', source: 'devrev-task-1', target: 'devrev-task-2' };
    const result = await denormalizeLink(data, resolveId);
    expect(result?.linkType).toBe('is_parent_of');
  });
});
