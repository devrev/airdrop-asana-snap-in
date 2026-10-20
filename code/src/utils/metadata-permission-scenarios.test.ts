import { AxiosError, type AxiosResponse } from 'axios';

import { normalizeAsanaAccessRule } from '@asana/data-normalization';
import type { AsanaCustomField, AsanaSection } from '@asana/types';

import {
  buildCustomFieldDefinition,
  buildSectionFieldDefinition,
  buildTaskStageDiagram,
  describeMetadataError,
} from './metadata-helpers';

describe('metadata scenario builders', () => {
  it('maps supported Asana custom field types and keeps source enum keys stable across label changes', () => {
    const fields: AsanaCustomField[] = [
      { gid: 'cf-text', name: 'Notes', type: 'text' },
      { gid: 'cf-number', name: 'Points', type: 'number' },
      {
        gid: 'cf-enum',
        name: 'Priority',
        type: 'enum',
        enum_options: [
          { gid: 'opt-high', name: 'Urgent', enabled: true },
          { gid: 'opt-old', name: 'Old value', enabled: false },
        ],
      },
      {
        gid: 'cf-multi',
        name: 'Areas',
        type: 'multi_enum',
        enum_options: [{ gid: 'area-one', name: 'Area One', enabled: true }],
      },
      { gid: 'cf-date', name: 'Target date', type: 'date' },
      { gid: 'cf-people', name: 'Reviewers', type: 'people' },
    ];

    const definitions = fields.map(buildCustomFieldDefinition);

    expect(definitions.map(({ type }) => type)).toEqual([
      'text',
      'float',
      'enum',
      'enum',
      'timestamp',
      'reference',
    ]);
    expect(definitions[2].enum?.values).toEqual([{ key: 'opt-high', name: 'Urgent' }]);
    expect(definitions[3].enum?.values).toEqual([{ key: 'area-one', name: 'Area One' }]);
    expect(definitions[3].collection).toEqual({});
    expect(definitions[5]).toMatchObject({
      reference: { refers_to: { '#record:users': {} } },
      collection: {},
    });

    const renamedEnum = buildCustomFieldDefinition({
      ...fields[2],
      enum_options: [{ gid: 'opt-high', name: 'Critical', enabled: true }],
    });
    expect(renamedEnum.enum?.values).toEqual([{ key: 'opt-high', name: 'Critical' }]);
  });

  it('maps formula fields to read-only text even when their base Asana type is number', () => {
    const field = buildCustomFieldDefinition({
      gid: 'cf-formula',
      name: 'Days remaining',
      type: 'number',
      representation_type: 'formula',
      is_formula_field: true,
    });

    expect(field).toMatchObject({
      name: 'Days remaining',
      type: 'text',
      is_read_only: true,
    });
    expect(field.float).toBeUndefined();
  });

  it('preserves a valid zero-second Retry-After while converting metadata errors', () => {
    const rateLimitError = new AxiosError('Too Many Requests', '429', undefined, undefined, {
      status: 429,
      headers: { 'retry-after': '0' },
    } as unknown as AxiosResponse);

    expect(describeMetadataError('fetching sections', rateLimitError)).toEqual({ delay: 0 });
  });

  it('uses source section GIDs as stable stage keys and preserves section labels', () => {
    const sections: AsanaSection[] = [
      { gid: 'section-1', name: 'Planning' },
      { gid: 'section-2', name: 'Doing' },
      { gid: 'section-3', name: 'Complete' },
    ];

    const field = buildSectionFieldDefinition(sections);
    const diagram = buildTaskStageDiagram(sections);

    expect(field.enum?.values).toEqual([
      { key: 'section-1', name: 'Planning' },
      { key: 'section-2', name: 'Doing' },
      { key: 'section-3', name: 'Complete' },
    ]);
    expect(diagram).toMatchObject({
      controlling_field: 'section',
      starting_stage: 'section-1',
      stages: {
        'section-1': { transitions_to: ['section-2', 'section-3'], state: 'open' },
        'section-2': { transitions_to: ['section-1', 'section-3'], state: 'in_progress' },
        'section-3': { transitions_to: ['section-1', 'section-2'], state: 'closed' },
      },
    });
  });
});

describe('Asana permission normalization scenarios', () => {
  it('preserves distinct object privileges and target record types', () => {
    const rule = normalizeAsanaAccessRule({
      accessLevel: 'editor',
      userIds: ['user-1'],
      groupIds: ['team-1'],
      privileges: ['create', 'read', 'update', 'delete'],
      recordTypes: ['tasks', 'subtasks'],
    });

    expect(rule.id).toBe('access_rule_editor');
    expect(rule.data).toEqual({
      permission_users: ['user-1'],
      permission_groups: ['team-1'],
      object_access: [
        {
          record_types: ['tasks', 'subtasks'],
          privileges: ['create', 'read', 'update', 'delete'],
        },
      ],
    });
  });

  it('keeps user and group principals distinct when their source IDs match', () => {
    const rule = normalizeAsanaAccessRule({
      accessLevel: 'viewer',
      userIds: ['same-gid'],
      groupIds: ['same-gid'],
      privileges: ['read'],
      recordTypes: ['tasks', 'subtasks'],
    });

    const data = rule.data as { permission_users: string[]; permission_groups: string[] };
    expect(data.permission_users).toEqual(['same-gid']);
    expect(data.permission_groups).toEqual(['same-gid']);
  });

  it('reflects revised full permission input without retaining removed principals', () => {
    const first = normalizeAsanaAccessRule({
      accessLevel: 'viewer',
      userIds: ['user-1', 'user-2'],
      groupIds: ['team-1'],
      privileges: ['read'],
      recordTypes: ['tasks', 'subtasks'],
    });
    const revised = normalizeAsanaAccessRule({
      accessLevel: 'viewer',
      userIds: ['user-2'],
      groupIds: [],
      privileges: ['read'],
      recordTypes: ['tasks', 'subtasks'],
    });

    const firstData = first.data as { permission_users: string[] };
    const revisedData = revised.data as { permission_users: string[]; permission_groups: string[] };
    expect(firstData.permission_users).toEqual(['user-1', 'user-2']);
    expect(revisedData.permission_users).toEqual(['user-2']);
    expect(revisedData.permission_groups).toEqual([]);
  });

  it('preserves an explicit empty permission result without inventing principals', () => {
    const rule = normalizeAsanaAccessRule({
      accessLevel: 'viewer',
      userIds: [],
      groupIds: [],
      privileges: ['read'],
      recordTypes: ['tasks', 'subtasks'],
    });

    expect(rule.data).toEqual({
      permission_users: [],
      permission_groups: [],
      object_access: [{ record_types: ['tasks', 'subtasks'], privileges: ['read'] }],
    });
  });
});
