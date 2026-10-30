import { AsanaClient } from '@asana/api-client';
import { ItemType, LinkType } from '@asana/constants';
import { AsanaTask } from '@asana/types';
import { ExtractorState, initialState } from '@functions/extraction';
import { extractTasks } from '@utils/data-helpers';

const before = '2024-01-01T00:00:00Z';
const from = '2024-06-01T00:00:00Z';
const within = '2024-06-02T00:00:00Z';
const to = '2024-06-03T00:00:00Z';
const after = '2024-06-04T00:00:00Z';

function fixture(options?: { rootTime?: string; intermediateTime?: string; leafTime?: string; excludeSubtasks?: boolean }) {
  const root = { gid: 'root', created_at: before, modified_at: options?.rootTime ?? before, num_subtasks: 1 };
  const intermediate = { gid: 'intermediate', created_at: before, modified_at: options?.intermediateTime ?? before, num_subtasks: 1 };
  const leaf = { gid: 'leaf', created_at: before, modified_at: options?.leafTime ?? within, num_subtasks: 0 };
  const records = new Map<string, any[]>();
  const state: ExtractorState = JSON.parse(JSON.stringify(initialState));
  const adapter = {
    isTimeout: false,
    state,
    event: { payload: { event_context: { extract_from: from, extract_to: to } } },
    shouldExtract: (type: string) => !(options?.excludeSubtasks && type === ItemType.SUBTASKS),
    getRepo: (type: string) => ({ push: async (items: any[]) => records.set(type, [...(records.get(type) ?? []), ...items]) }),
    mappers: { getByExternalId: jest.fn().mockResolvedValue(null) },
  };
  const client = {
    projectId: 'project',
    getTasks: jest.fn().mockImplementation(({ modified_since }: { modified_since?: string }) => Promise.resolve({
      data: { data: modified_since && root.modified_at < modified_since ? [] : [root], next_page: null },
    })),
    getSubtasksForTask: jest.fn().mockImplementation((gid: string) => Promise.resolve({
      data: { data: gid === 'root' ? [intermediate] : [leaf], next_page: null },
    })),
    getStoriesForTask: jest.fn().mockImplementation((gid: string) => Promise.resolve({
      data: { data: gid === 'leaf' ? [{ gid: 'comment', type: 'comment', text: 'Nested comment', created_at: options?.leafTime ?? within }] : [], next_page: null },
    })),
  };
  return { client, adapter, records, root, intermediate, leaf };
}

describe('incremental descendant discovery', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it.each([before, within])('finds a changed depth-two child through unchanged ancestors (root %s)', async (rootTime) => {
    const { client, adapter, records } = fixture({ rootTime });
    await extractTasks(client as unknown as AsanaClient, adapter as any);
    expect(records.get(ItemType.SUBTASKS)?.map((task) => task.gid)).toEqual(['leaf']);
    expect(records.get(ItemType.COMMENTS)?.map((comment) => comment.gid)).toEqual(['comment']);
    expect(records.get(ItemType.LINKS)).toEqual([{ source_gid: 'intermediate', target_gid: 'leaf', link_type: LinkType.IS_PARENT_OF }]);
    expect(records.get(ItemType.TASKS)?.map((task) => task.gid) ?? []).toEqual(rootTime === within ? ['root'] : []);
    expect(client.getTasks).toHaveBeenCalledWith({});
  });

  it('emits no repeated records when the entire traversed tree is unchanged', async () => {
    const { client, adapter, records, leaf } = fixture({ leafTime: before });
    (leaf as AsanaTask).attachments = [{ gid: 'old-file', created_at: before, download_url: 'https://example.com/file' }];
    await extractTasks(client as unknown as AsanaClient, adapter as any);
    expect(client.getSubtasksForTask.mock.calls).toEqual([['root', {}], ['intermediate', {}]]);
    expect([...records.values()].flat()).toEqual([]);
    expect(adapter.mappers.getByExternalId).not.toHaveBeenCalled();
    expect(adapter.state.tasks.lastExtractedTaskIndex).toBe(-1);
  });

  it('traverses root and subtask pages without repeating unchanged ancestors', async () => {
    const { client, adapter, records, root, intermediate, leaf } = fixture();
    client.getTasks.mockImplementation(({ offset }: any) => Promise.resolve({ data: {
      data: offset ? [root] : [{ gid: 'other', created_at: before, modified_at: before }],
      next_page: offset ? null : { offset: 'roots-2' },
    } }));
    client.getSubtasksForTask.mockImplementation((gid: string, { offset }: any = {}) => Promise.resolve({ data: {
      data: gid === 'root' ? offset ? [intermediate] : [{ gid: 'unchanged', created_at: before, modified_at: before }] : [leaf],
      next_page: gid === 'root' && !offset ? { offset: 'children-2' } : null,
    } }));
    await extractTasks(client as unknown as AsanaClient, adapter as any);
    expect(client.getTasks.mock.calls).toEqual([[{ modified_since: from }], [{ modified_since: from, offset: 'roots-2' }], [{}], [{ offset: 'roots-2' }]]);
    expect(records.get(ItemType.SUBTASKS)?.map((task) => task.gid)).toEqual(['leaf']);
    expect(records.get(ItemType.COMMENTS)?.map((comment) => comment.gid)).toEqual(['comment']);
    expect(adapter.state.tasks.offset).toBe('');
  });

  it.each(['root', 'intermediate'] as const)('traverses %s beyond the upper window while filtering its own record', async (ancestor) => {
    const scenario = fixture();
    const { client, adapter, records } = scenario;
    scenario[ancestor].created_at = after;
    scenario[ancestor].modified_at = after;
    await extractTasks(client as unknown as AsanaClient, adapter as any);
    expect(records.get(ItemType.SUBTASKS)?.map((task) => task.gid)).toEqual(['leaf']);
  });

  it('filters a changed descendant outside the upper bound', async () => {
    const { client, adapter, records, leaf } = fixture({ leafTime: after });
    leaf.created_at = after;
    await extractTasks(client as unknown as AsanaClient, adapter as any);
    expect([...records.values()].flat()).toEqual([]);
    expect(client.getSubtasksForTask).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('emits an old task newly associated with the project (subtasks excluded: %s)', async (excludeSubtasks) => {
    const { client, adapter, records, root } = fixture({ excludeSubtasks });
    client.getTasks.mockResolvedValue({ data: { data: [root], next_page: null } });
    await extractTasks(client as unknown as AsanaClient, adapter as any);
    expect(records.get(ItemType.TASKS)?.map((task) => task.gid)).toEqual(['root']);
    expect(client.getTasks).toHaveBeenCalledWith({ modified_since: from });
  });

  it.each([before, within])('stops a 3,000-child traversal at timeout and resumes without replay (child timestamp %s)', async (modifiedAt) => {
    const { client, adapter, records, root } = fixture();
    root.num_subtasks = 3000;
    const children = Array.from({ length: 3000 }, (_, index) => ({
      gid: `child-${index}`, created_at: before, modified_at: modifiedAt, num_subtasks: 0,
    }));
    client.getSubtasksForTask.mockImplementation((_gid: string, { offset }: any = {}) => {
      const start = Number(offset ?? 0);
      return Promise.resolve({ data: { data: children.slice(start, start + 100),
        next_page: start + 100 < children.length ? { offset: String(start + 100) } : null } });
    });
    client.getStoriesForTask.mockImplementation((gid: string) => {
      if (gid === 'child-149') adapter.isTimeout = true;
      return Promise.resolve({ data: { data: [], next_page: null } });
    });
    await extractTasks(client as unknown as AsanaClient, adapter as any);
    expect(client.getStoriesForTask).toHaveBeenCalledTimes(151);
    expect(records.get(ItemType.SUBTASKS) ?? []).toHaveLength(modifiedAt === within ? 150 : 0);
    expect(adapter.state.tasks.completed).toBe(false);
    const saved = JSON.parse(JSON.stringify(adapter.state));
    expect(JSON.stringify(saved).length).toBeLessThan(3000);
    adapter.state = saved;
    adapter.isTimeout = false;
    client.getStoriesForTask.mockClear();
    await extractTasks(client as unknown as AsanaClient, adapter as any);
    expect(client.getStoriesForTask).toHaveBeenCalledTimes(2850);
    const ids = records.get(ItemType.SUBTASKS)?.map((task) => task.gid) ?? [];
    expect(ids).toHaveLength(modifiedAt === within ? 3000 : 0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(records.get(ItemType.LINKS) ?? []).toHaveLength(ids.length);
  });

  it('resumes paginated association changes after a 429 without emitting previous pages twice', async () => {
    const { client, adapter, records, root } = fixture();
    const moved = { ...root, gid: 'moved-1', dependencies: [{ gid: 'dependency' }], memberships: [
      { project: { gid: 'project' } }, { project: { gid: 'other' } },
    ] };
    let limited = true;
    client.getTasks.mockImplementation(({ modified_since, offset }: any) => {
      if (!modified_since) return Promise.resolve({ data: { data: [root] } });
      if (offset && limited) return Promise.reject({ isAxiosError: true, response: { status: 429 } });
      return Promise.resolve({ data: { data: [{ ...moved, gid: offset ? 'moved-2' : 'moved-1' }],
        next_page: offset ? null : { offset: 'moves-2' } } });
    });
    await expect(extractTasks(client as unknown as AsanaClient, adapter as any)).rejects.toMatchObject({ response: { status: 429 } });
    expect(records.get(ItemType.TASKS)?.map((task) => task.gid)).toEqual(['moved-1']);
    adapter.state = JSON.parse(JSON.stringify(adapter.state));
    client.getTasks.mockClear();
    limited = false;
    await extractTasks(client as unknown as AsanaClient, adapter as any);
    expect(client.getTasks.mock.calls[0]).toEqual([{ modified_since: from, offset: 'moves-2' }]);
    expect(records.get(ItemType.TASKS)?.map((task) => task.gid)).toEqual(['moved-1', 'moved-2']);
    expect(records.get(ItemType.TASKS)?.map((task) => task.memberships)).toEqual([
      [{ project: { gid: 'project' } }], [{ project: { gid: 'project' } }],
    ]);
    expect(records.get(ItemType.LINKS)?.filter((link) => link.link_type === LinkType.IS_DEPENDENT_ON)).toHaveLength(2);
  });

  it.each([false, true])('resumes a partially emitted subtree after a child 429 (initial: %s)', async (initial) => {
    const { client, adapter, records } = fixture();
    if (initial) delete (adapter.event.payload.event_context as { extract_from?: string }).extract_from;
    const children = ['first', 'second'].map((gid) => ({ gid, created_at: before, modified_at: within }));
    client.getSubtasksForTask.mockResolvedValue({ data: { data: children, next_page: null } });
    let limited = true;
    client.getStoriesForTask.mockImplementation((gid: string) => {
      if (gid === 'second' && limited) return Promise.reject({ isAxiosError: true, response: { status: 429 } });
      return Promise.resolve({ data: { data: [], next_page: null } });
    });
    await expect(extractTasks(client as unknown as AsanaClient, adapter as any)).rejects.toMatchObject({ response: { status: 429 } });
    expect(records.get(ItemType.SUBTASKS)?.map((task) => task.gid)).toEqual(['first']);
    adapter.state = JSON.parse(JSON.stringify(adapter.state));
    client.getStoriesForTask.mockClear();
    limited = false;
    await extractTasks(client as unknown as AsanaClient, adapter as any);
    expect(client.getStoriesForTask.mock.calls).toEqual([['second', {}]]);
    expect(records.get(ItemType.SUBTASKS)?.map((task) => task.gid)).toEqual(['first', 'second']);
    expect(records.get(ItemType.LINKS)).toHaveLength(2);
  });

  it('retains the API lower-bound optimization when subtasks are excluded', async () => {
    const { client, adapter, records } = fixture({ excludeSubtasks: true });
    await extractTasks(client as unknown as AsanaClient, adapter as any);
    expect(client.getTasks).toHaveBeenCalledWith({ modified_since: from });
    expect(client.getSubtasksForTask).not.toHaveBeenCalled();
    expect([...records.values()].flat()).toEqual([]);
  });

  it.each(['created_at', 'modified_at', 'both'])('keeps records with missing %s rather than assuming they are unchanged', async (missing) => {
    const { client, adapter, records, root, intermediate, leaf } = fixture({ leafTime: before });
    for (const task of [root, intermediate, leaf]) {
      if (missing !== 'modified_at') delete (task as AsanaTask).created_at;
      if (missing !== 'created_at') delete (task as AsanaTask).modified_at;
    }
    await extractTasks(client as unknown as AsanaClient, adapter as any);
    expect(records.get(ItemType.TASKS)?.map((task) => task.gid)).toEqual(['root']);
    expect(records.get(ItemType.SUBTASKS)?.map((task) => task.gid)).toEqual(['intermediate', 'leaf']);
  });

  it.each([from, to])('includes descendant changes exactly on the inclusive boundary %s', async (leafTime) => {
    const { client, adapter, records } = fixture({ leafTime });
    await extractTasks(client as unknown as AsanaClient, adapter as any);
    expect(records.get(ItemType.SUBTASKS)?.map((task) => task.gid)).toEqual(['leaf']);
    expect(records.get(ItemType.COMMENTS)?.map((comment) => comment.gid)).toEqual(['comment']);
  });
});
