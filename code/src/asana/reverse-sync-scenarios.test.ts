import { type AirSyncEvent, Mappers } from '@devrev/airsync-sdk';

import { resolveExternalId } from '@utils/loading-helpers';

import { denormalizeComment, denormalizeLink, denormalizeTask } from './data-denormalization';

// Asana GIDs are numeric and resolveRef returns them directly without consulting the mapper.
// Use the real SDK mapper and production resolver so these tests have no dependency doubles.
const mappers = new Mappers({
  event: {
    execution_metadata: { devrev_endpoint: 'https://unused.invalid' },
    context: { secrets: { service_account_token: 'unused' } },
  } as AirSyncEvent,
});
const resolveId = resolveExternalId.bind(undefined, mappers, 'numeric-gid-unit-test');

describe('reverse-sync Asana request scenarios', () => {
  // Sources: Asana OpenAPI TaskRequest/StoryBase, the task and comment IDM reverse mappings,
  // and the connector policy to preserve the supplied Asana GIDs on references.
  it('builds task create and update payloads with mapped fields, dates, false, section, and tags', async () => {
    const result = await denormalizeTask(
      {
        name: 'Review release',
        assignee: ['1001'],
        description: ['Review the launch notes'],
        due_date: '2026-10-25T19:45:00.000Z',
        start_date: '2026-10-19',
        completed: false,
        section: '2001',
        tags: ['3001', '3002'],
      },
      resolveId
    );

    expect(result.createRequest).toEqual({
      data: {
        name: 'Review release',
        notes: 'Review the launch notes',
        assignee: '1001',
        due_on: '2026-10-25',
        start_on: '2026-10-19',
        completed: false,
      },
    });
    expect(result.updateRequest).toEqual(result.createRequest);
    expect(result.sectionGid).toBe('2001');
    expect(result.tagGids).toEqual(['3001', '3002']);
  });

  it('serializes Unicode, escaped prose, and mention GIDs into Asana task HTML', async () => {
    const result = await denormalizeTask(
      {
        description: [
          'Résumé <launch> & ',
          { ref_type: 'users', id: '4001', fallback_record_name: 'Zoë & Co' },
          ' — see ',
          { ref_type: 'tasks', id: '5001', fallback_record_name: 'Prior <task>' },
        ],
      },
      resolveId
    );

    expect(result.createRequest.data).toEqual({
      name: undefined,
      html_notes:
        '<body>Résumé &lt;launch&gt; &amp; <a data-asana-gid="4001" data-asana-type="user">@Zoë &amp; Co</a> — see <a data-asana-gid="5001" data-asana-type="task">@Prior &lt;task&gt;</a></body>',
      assignee: undefined,
      due_on: undefined,
      start_on: undefined,
      completed: undefined,
    });
  });

  it('keeps omitted update fields absent and turns explicit empty description into empty Asana notes', async () => {
    const omitted = await denormalizeTask({ name: 'Title only' }, resolveId);
    expect(JSON.parse(JSON.stringify(omitted.updateRequest))).toEqual({ data: { name: 'Title only' } });

    const cleared = await denormalizeTask({ description: '' }, resolveId);
    expect(cleared.updateRequest.data?.notes).toBe('');
    expect(cleared.updateRequest.data?.html_notes).toBeUndefined();
  });

  it('uses empty Asana notes and null references and dates to clear explicitly null task fields', async () => {
    const result = await denormalizeTask(
      { description: null, assignee: null, due_date: null, start_date: null, section: null },
      resolveId
    );

    expect(result.updateRequest.data).toMatchObject({
      notes: '',
      assignee: null,
      due_on: null,
      start_on: null,
    });
    expect(result.sectionGid).toBeNull();
  });

  it('builds a comment request with its numeric parent GID and rich-text mention', async () => {
    const result = await denormalizeComment(
      {
        parent_id: '6001',
        body: ['Please ask ', { ref_type: 'users', id: '6002', fallback_record_name: 'Mika' }, ' to review.'],
      },
      resolveId
    );

    expect(result.parentGid).toBe('6001');
    expect(result.request).toEqual({
      data: {
        html_text: '<body>Please ask <a data-asana-gid="6002" data-asana-type="user">@Mika</a> to review.</body>',
      },
    });
  });

  it.each(['is_dependent_on', 'is_parent_of'])('preserves %s link type and numeric endpoints', async (linkType) => {
    const result = await denormalizeLink({ link_type: linkType, source: '7001', target: '7002' }, resolveId);

    expect(result).toEqual({ linkType, sourceGid: '7001', targetGid: '7002' });
  });

  it('does not build a link action when either endpoint is absent', async () => {
    const result = await denormalizeLink({ link_type: 'is_parent_of', source: '7001' }, resolveId);
    expect(result).toBeNull();
  });
});
