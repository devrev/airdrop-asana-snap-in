import { AirSyncErrorCode } from '@devrev/airsync-sdk';

import { ItemType } from '@asana/constants';
import { normalizeAsanaComment, normalizeAsanaTask } from '@asana/data-normalization';

import { extractGroups, extractTaskWithSubtasks, filterAlreadyMappedAttachments, handleExtractionError } from './data-helpers';
import { buildExternalSyncUnits } from './external-sync-units-helpers';
import { buildCustomFieldDefinition } from './metadata-helpers';

const page = (data: unknown[], offset?: string) => ({ data: { data, next_page: offset ? { offset } : null } });
const httpError = (status: number, retryAfter = '10') => ({
  isAxiosError: true, response: { status, headers: { 'retry-after': retryAfter } },
});

describe('production error regressions', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('retains every discovered project without requesting or reporting task counts', () => {
    const projects = Array.from({ length: 1000 }, (_, i) => ({ gid: `p${i}`, name: `Project ${i}` }));
    const units = buildExternalSyncUnits(projects);
    expect(units).toHaveLength(1000);
    expect(units.map((unit) => unit.id)).toEqual(projects.map((project) => project.gid));
    expect(units.every((unit) => !Object.prototype.hasOwnProperty.call(unit, 'item_count'))).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });

  function groupFixture() {
    const groups = jest.fn();
    const memberships = jest.fn();
    const adapter = {
      isTimeout: false, shouldExtract: () => true,
      state: { groups: { offset: '', total: 0 }, group_memberships: { total: 0 } },
      getRepo: (type: string) => ({ push: type === ItemType.GROUPS ? groups : memberships }),
    } as any;
    const client = {
      getTeamsForWorkspace: jest.fn().mockResolvedValue(page([{ gid: 't1' }, { gid: 't2' }], 'page2')),
      getTeamMembershipsForTeam: jest.fn().mockResolvedValue(page([{ user: { gid: 'u1' } }])),
    } as any;
    return { adapter, client, groups, memberships };
  }

  it('resumes at the failed team after 429 without replaying completed teams', async () => {
    const { adapter, client, groups, memberships } = groupFixture();
    client.getTeamMembershipsForTeam.mockResolvedValueOnce(page([{ user: { gid: 'u1' } }]))
      .mockRejectedValueOnce(httpError(429));
    await expect(extractGroups(client, adapter)).rejects.toEqual(httpError(429));
    const resumed = JSON.parse(JSON.stringify(adapter.state));
    adapter.state = resumed;
    client.getTeamsForWorkspace.mockResolvedValueOnce(page([{ gid: 't1' }, { gid: 't2' }], 'page2'))
      .mockResolvedValueOnce(page([{ gid: 't3' }]));
    await extractGroups(client, adapter);
    expect(client.getTeamMembershipsForTeam.mock.calls.map(([gid]: [string]) => gid)).toEqual(['t1', 't2', 't2', 't3']);
    expect(groups.mock.calls.map(([items]: [any[]]) => items[0].id)).toEqual(['t1', 't2', 't3']);
    expect(memberships).toHaveBeenCalledTimes(3);
    expect(adapter.state.groups.total).toBe(3);
  });

  it('resumes completed teams after a soft timeout', async () => {
    const { adapter, client, groups } = groupFixture();
    client.getTeamMembershipsForTeam.mockImplementationOnce(async () => {
      adapter.isTimeout = true;
      return page([{ user: { gid: 'u1' } }]);
    });
    await extractGroups(client, adapter);
    adapter.isTimeout = false;
    client.getTeamsForWorkspace.mockResolvedValue(page([{ gid: 't1' }, { gid: 't2' }]));
    await extractGroups(client, adapter);
    expect(groups.mock.calls.map(([items]: [any[]]) => items[0].id)).toEqual(['t1', 't2']);
  });

  it('restarts team indexes when a saved team-page token expires', async () => {
    const { adapter, client, groups } = groupFixture();
    adapter.state.groups = { offset: 'expired', total: 20, lastExtractedTeamIndex: 4 };
    client.getTeamsForWorkspace.mockRejectedValueOnce({ isAxiosError: true,
      response: { status: 400, data: { errors: [{ message: 'Your pagination token has expired' }] } } })
      .mockResolvedValueOnce(page([{ gid: 'fresh' }]));
    await extractGroups(client, adapter);
    expect(groups.mock.calls[0][0][0].id).toBe('fresh');
  });

  it('fails safely when the attachment deduplication mapper is unavailable', async () => {
    const error = new Error('mapper unavailable');
    const adapter = { event: { payload: { event_context: { sync_unit: 'unit' } } },
      mappers: { getByExternalId: jest.fn().mockRejectedValue(error) } };
    await expect(filterAlreadyMappedAttachments([{ gid: 'attachment' }], adapter as any)).rejects.toThrow('mapper unavailable');
  });

  it.each([[401, AirSyncErrorCode.EXTERNAL_SYSTEM_NO_ACCESS], [402, AirSyncErrorCode.EXTERNAL_SYSTEM_NO_PERMISSION],
    [403, AirSyncErrorCode.EXTERNAL_SYSTEM_NO_PERMISSION]])('uses common errors for required API HTTP %i', (status, code) => {
    expect(handleExtractionError(httpError(status as number)).error?.code).toBe(code);
  });

  it.each(['-1', 'Infinity', 'NaN', '1.5'])('uses a valid delay when Retry-After is %s', (header) => {
    expect(handleExtractionError(httpError(429, header)).delay).toBe(60);
  });

  it('preserves zero-second Retry-After', () => {
    expect(handleExtractionError(httpError(429, '0')).delay).toBe(0);
  });

  it('keeps the selected project section and only custom fields declared by its metadata', async () => {
    const task = { gid: 'task', memberships: [
      { project: { gid: 'other' }, section: { gid: 'other-section' } },
      { project: { gid: 'selected' }, section: { gid: 'selected-section' } },
    ], custom_fields: [
      { gid: 'known', name: 'Known', type: 'text', text_value: 'keep' },
      { gid: 'foreign', name: 'Foreign', type: 'text', text_value: 'omit' },
    ] };
    const buffer = { tasks: [], subtasks: [], comments: [], attachments: [], links: [] } as any;
    const adapter = { shouldExtract: () => false, state: { taskFieldIds: ['known'] } };
    await extractTaskWithSubtasks(task as any, {} as any, 'selected', buffer, adapter as any);
    const normalized = normalizeAsanaTask(buffer.tasks[0]);
    expect(normalized.data).toMatchObject({ section: 'selected-section', known: 'keep' });
    expect(normalized.data).not.toHaveProperty('foreign');
    expect(task.memberships).toHaveLength(2);
    expect(task.custom_fields).toHaveLength(2);
  });

  it('does not import another project section when the selected project has none', async () => {
    const task = { gid: 'task', memberships: [{ project: { gid: 'other' }, section: { gid: 'other-section' } }] };
    const buffer = { tasks: [], subtasks: [], comments: [], attachments: [], links: [] } as any;
    const adapter = { shouldExtract: () => false, state: {} };
    await extractTaskWithSubtasks(task as any, {} as any, 'selected', buffer, adapter as any);
    expect(normalizeAsanaTask(buffer.tasks[0]).data).toHaveProperty('section', null);
  });

  it('declares disabled enum options that remain valid on historical tasks', () => {
    const field = buildCustomFieldDefinition({ gid: 'enum', type: 'enum', enum_options: [
      { gid: 'active', name: 'Active', enabled: true }, { gid: 'legacy', name: 'Legacy', enabled: false },
    ] } as any);
    expect(field.enum?.values).toContainEqual({ key: 'legacy', name: 'Legacy', is_deprecated: true });
  });

  it('preserves an attachment-only comment with a usable body', () => {
    const normalized = normalizeAsanaComment({ gid: 'comment', text: '',
      html_text: '<body><img data-asana-type="attachment" data-asana-gid="file" /></body>',
      attachments: [{ gid: 'file', name: 'diagram.png' }], target: { gid: 'task' },
    } as any);
    expect(normalized.data).toMatchObject({ body: ['diagram.png'], parent_id: 'task' });
  });
});
