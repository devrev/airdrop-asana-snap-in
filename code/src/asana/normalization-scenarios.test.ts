import { CustomFieldType, ItemType } from '@asana/constants';
import type { AsanaCustomField, AsanaStory, AsanaTask } from '@asana/types';
import { extractCustomFields, toTimestamp } from '@utils/field-extraction-helpers';
import { parseAsanaRichText } from '@utils/rich-text-helpers';

import { normalizeAsanaAttachment, normalizeAsanaComment, normalizeAsanaGroup, normalizeAsanaGroupMembership, normalizeAsanaLink, normalizeAsanaSubtask, normalizeAsanaTag, normalizeAsanaTask, normalizeAsanaUser } from './data-normalization';

type Data = Record<string, unknown>;

describe('normalization unit scenarios', () => {
  // Asana task GIDs are the source identity; the connector's IDM maps them as item IDs.
  it('keeps a task ID stable across title and field changes and page reordering', () => {
    const original: AsanaTask = {
      gid: 'task-17',
      name: 'Initial title',
      created_at: '2025-05-01T08:00:00Z',
      modified_at: '2025-05-02T08:00:00Z',
    };
    const changed: AsanaTask = {
      ...original,
      name: 'Renamed task',
      modified_at: '2025-05-04T08:00:00Z',
      completed: true,
    };

    const normalizedPage = [changed, { ...original, gid: 'task-18' }, original].map(normalizeAsanaTask);

    expect(normalizedPage[0].id).toBe('task-17');
    expect(normalizedPage[1].id).toBe('task-18');
    expect(normalizedPage[2].id).toBe('task-17');
    expect((normalizedPage[0].data as Data).name).toBe('Renamed task');
    expect((normalizedPage[2].data as Data).name).toBe('Initial title');
  });

  it('rejects a task without the stable Asana GID required for normalization', () => {
    expect(() =>
      normalizeAsanaTask({
        name: 'No source identifier',
        created_at: '2025-05-01T08:00:00Z',
        modified_at: '2025-05-01T08:00:00Z',
      })
    ).toThrow('Cannot normalize task: missing GID');
  });

  // The task EDM declares these fields as timestamps; equivalent ISO-8601 offsets preserve instants.
  it('normalizes equivalent timestamp offsets to the same instant', () => {
    expect(toTimestamp('2025-05-01T11:30:00+02:00')).toBe('2025-05-01T09:30:00.000Z');
    expect(toTimestamp('2025-05-01T09:30:00Z')).toBe('2025-05-01T09:30:00.000Z');

    const task = normalizeAsanaTask({
      gid: 'task-time',
      created_at: '2025-05-01T11:30:00+02:00',
      modified_at: '2025-05-01T12:30:00+02:00',
      due_at: '2025-05-03T18:00:00-04:00',
    });

    expect(task.created_date).toBe('2025-05-01T09:30:00.000Z');
    expect(task.modified_date).toBe('2025-05-01T10:30:00.000Z');
    expect((task.data as Data).due_date).toBe('2025-05-03T22:00:00.000Z');
  });

  // Asana OpenAPI CustomFieldResponse allows nullable text/number values and explicit arrays;
  // TDD §2.5/§2.6.5 maps formula fields to text using display_value.
  it('preserves false, zero, empty strings, and explicit empty collections in custom fields', () => {
    const fields = [
      { gid: 'text-empty', name: 'Empty text', type: CustomFieldType.TEXT, text_value: '' },
      { gid: 'text-null', name: 'Unset text', type: CustomFieldType.TEXT, text_value: null },
      { gid: 'number-zero', name: 'Zero', type: CustomFieldType.NUMBER, number_value: 0 },
      { gid: 'multi-empty', name: 'No options', type: CustomFieldType.MULTI_ENUM, multi_enum_values: [] },
      {
        gid: 'formula',
        name: 'Formula',
        type: CustomFieldType.NUMBER,
        number_value: 5,
        display_value: 'Five hours',
        representation_type: 'formula',
        is_formula_field: true,
      },
      {
        gid: 'formula-empty',
        name: 'Formula empty',
        type: CustomFieldType.NUMBER,
        number_value: 0,
        display_value: '',
        representation_type: 'formula',
        is_formula_field: true,
      },
    ] as AsanaCustomField[];

    const extracted = extractCustomFields(fields);
    const task = normalizeAsanaTask({
      gid: 'task-empty-values',
      created_at: '2025-05-01T08:00:00Z',
      modified_at: '2025-05-01T08:00:00Z',
      completed: false,
      actual_time_minutes: 0,
      custom_fields: fields,
    });
    const data = task.data as Data;

    expect(extracted).toEqual({
      'text-empty': '',
      'number-zero': 0,
      'multi-empty': [],
      formula: 'Five hours',
      'formula-empty': '',
    });
    expect(data.completed).toBe(false);
    expect(data.actual_effort).toBe(0);
    expect(data['text-empty']).toBe('');
  });

  // TDD §2.8 declares Asana HTML to AirSync rich text conversion and inline-image removal.
  it('preserves Unicode and line breaks while keeping escaped angle brackets inert', () => {
    expect(parseAsanaRichText('<body>Grüße 東京 &amp; team<br/>Literal &lt;tag&gt;</body>')).toEqual([
      'Grüße 東京 & team\nLiteral &lt;tag&gt;',
    ]);
  });

  // TDD §2.8 converts Asana mention GIDs to typed AirSync references with fallback display text.
  it('keeps an Asana mention source ID and fallback name without substituting another identity', () => {
    expect(parseAsanaRichText('<body>Hello <a data-asana-gid="user-404" data-asana-type="user">@Ada</a></body>')).toEqual([
      'Hello ',
      { ref_type: ItemType.USERS, id: 'user-404', fallback_record_name: 'Ada' },
    ]);
  });

  // A missing source GID cannot form the reference required by the AirSync rich-text contract.
  it('treats a mention without a source GID as text instead of creating a reference', () => {
    expect(parseAsanaRichText('<body><a data-asana-gid="" data-asana-type="user">@Former User</a></body>')).toEqual([
      '@Former User',
    ]);
  });

  // TDD §2.6 filtering removes attachment-only comment bodies; §2.7 parents streamed files separately.
  it('normalizes an attachment-only comment body as empty while retaining its references', () => {
    const story: AsanaStory = {
      gid: 'story-4',
      created_at: '2025-05-01T08:00:00Z',
      target: { gid: 'task-17' },
      created_by: { gid: 'user-9' },
      html_text: '<body><img data-asana-type="attachment" data-asana-gid="attachment-2" /></body>',
    } as AsanaStory;

    const normalized = normalizeAsanaComment(story);
    const data = normalized.data as Data;

    expect(normalized.id).toBe('story-4');
    expect(data.parent_id).toBe('task-17');
    expect(data.author).toBe('user-9');
    expect(data.body).toBeNull();
  });
});

// EDM/IDM references use source GIDs; synthetic membership/link IDs include their relationship scope.
describe('record identity and reference scenarios', () => {
  it('keeps users, tags, teams, and memberships stable across label changes', () => {
    const user = normalizeAsanaUser({ gid: '101', name: 'Ada', email: 'ada@example.test' });
    const renamedUser = normalizeAsanaUser({ gid: '101', name: 'Ada Lovelace', email: 'ada@example.test' });
    expect([user.id, renamedUser.id]).toEqual(['101', '101']);
    expect(renamedUser.data).toEqual({ display_name: 'Ada Lovelace', full_name: 'Ada Lovelace', email: 'ada@example.test' });
    const tag = normalizeAsanaTag({ gid: '201', name: 'Release', created_at: '2026-10-19T15:00:00Z', notes: 'Résumé' });
    const renamedTag = normalizeAsanaTag({ gid: '201', name: 'Launch', created_at: '2026-10-19T15:00:00Z' });
    expect([tag.id, renamedTag.id]).toEqual(['201', '201']);
    expect(tag.created_date).toBe('2026-10-19T15:00:00.000Z');
    expect(tag.data).toEqual({ name: 'Release', color: null, description: 'Résumé' });
    expect(normalizeAsanaGroup('301', 'Before').id).toBe(normalizeAsanaGroup('301', 'After').id);
    const membership = normalizeAsanaGroupMembership('301', ['101', '102']);
    const revised = normalizeAsanaGroupMembership('301', ['102']);
    expect([membership.id, revised.id]).toEqual(['gm_301', 'gm_301']);
    expect(membership.data).toEqual({ group_id: '301', member_ids: ['101', '102'] });
    expect(revised.data).toEqual({ group_id: '301', member_ids: ['102'] });
  });

  it('preserves task references and completed subtask stage without positional identities', () => {
    const task = normalizeAsanaSubtask({
      gid: '501', name: 'Nested', created_at: '2026-10-19T15:00:00Z', modified_at: '2026-10-19T15:01:00Z',
      parent: { gid: '500' }, assignee: { gid: '101' }, created_by: { gid: '102' }, completed_by: { gid: '103' },
      tags: [{ gid: '201' }, { gid: '202' }], followers: [{ gid: '104' }], completed: true,
    });
    expect(task.id).toBe('501');
    expect(task.data).toMatchObject({ parent_task: '500', assignee: '101', created_by: '102', reported_by: '102', completed_by: '103', tags: ['201', '202'], followers: ['104'], completed_stage: 'completed' });
    expect(normalizeAsanaSubtask({ gid: '502', created_at: '2026-10-19T15:00:00Z', completed: false }).data).toMatchObject({ completed_stage: 'open' });
  });

  it('preserves attachment identity, filename, URL, inline status, and comment parent', () => {
    expect(normalizeAsanaAttachment({ gid: '601', name: 'Résumé.pdf', download_url: 'https://files.example.test/601', parent_id: '701', inline: true })).toEqual({
      id: '601', file_name: 'Résumé.pdf', url: 'https://files.example.test/601', parent_id: '701', inline: true,
    });
    expect(normalizeAsanaAttachment({ gid: '601', name: 'Renamed.pdf', parent_id: '701' }).id).toBe('601');
    expect(() => normalizeAsanaAttachment({ parent_id: '701' })).toThrow('Cannot normalize attachment: missing GID');
  });

  it('distinguishes relationship identity by direction and link type', () => {
    const dependency = normalizeAsanaLink({ source_gid: '501', target_gid: '502', link_type: 'is_dependent_on' });
    const reversed = normalizeAsanaLink({ source_gid: '502', target_gid: '501', link_type: 'is_dependent_on' });
    const parent = normalizeAsanaLink({ source_gid: '501', target_gid: '502', link_type: 'is_parent_of' });
    expect([dependency.id, reversed.id, parent.id]).toEqual(['is_dependent_on_501_502', 'is_dependent_on_502_501', 'is_parent_of_501_502']);
    expect(parent.data).toEqual({ source: '501', target: '502', link_type: 'is_parent_of' });
  });
});
