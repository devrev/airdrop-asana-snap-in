import type { ExternalDomainMetadata } from '@devrev/ts-adaas';

import type { AsanaCustomField, AsanaEnumOption, AsanaSection } from '@asana/types';

import {
  buildCustomFieldDefinition,
  buildSectionFieldDefinition,
  buildSubtaskCompletedStageFieldDefinition,
  buildSubtaskStageDiagram,
  buildTaskStageDiagram,
  enrichMetadataWithCustomFields,
  enrichMetadataWithSections,
  enrichMetadataWithSubtaskStages,
} from './metadata-helpers';

describe('buildCustomFieldDefinition', () => {
  describe('text fields', () => {
    it('should build a text custom field definition', () => {
      const customField: AsanaCustomField = {
        gid: '12345',
        name: 'Notes',
        type: 'text',
      };

      const result = buildCustomFieldDefinition(customField);

      expect(result).toEqual({
        name: 'Notes',
        description: 'Asana custom field: Notes',
        type: 'text',
      });
    });

    it('should use custom description if provided', () => {
      const customField: AsanaCustomField = {
        gid: '12345',
        name: 'Notes',
        type: 'text',
        description: 'Custom description for notes',
      };

      const result = buildCustomFieldDefinition(customField);

      expect(result.description).toBe('Custom description for notes');
    });
  });

  describe('number fields', () => {
    it('should build a number custom field definition with float type', () => {
      const customField: AsanaCustomField = {
        gid: '12345',
        name: 'Story Points',
        type: 'number',
      };

      const result = buildCustomFieldDefinition(customField);

      expect(result).toEqual({
        name: 'Story Points',
        description: 'Asana custom field: Story Points',
        type: 'float',
      });
    });
  });

  describe('enum fields', () => {
    it('should build an enum custom field definition with values', () => {
      const customField: AsanaCustomField & { enum_options: AsanaEnumOption[] } = {
        gid: '12345',
        name: 'Priority',
        type: 'enum',
        enum_options: [
          { gid: 'opt1', name: 'High', enabled: true },
          { gid: 'opt2', name: 'Medium', enabled: true },
          { gid: 'opt3', name: 'Low', enabled: true },
        ],
      };

      const result = buildCustomFieldDefinition(customField);

      expect(result).toEqual({
        name: 'Priority',
        description: 'Asana custom field: Priority',
        type: 'enum',
        enum: {
          values: [
            { key: 'opt1', name: 'High' },
            { key: 'opt2', name: 'Medium' },
            { key: 'opt3', name: 'Low' },
          ],
        },
      });
    });

    it('should filter out disabled enum options', () => {
      const customField: AsanaCustomField & { enum_options: AsanaEnumOption[] } = {
        gid: '12345',
        name: 'Status',
        type: 'enum',
        enum_options: [
          { gid: 'opt1', name: 'Active', enabled: true },
          { gid: 'opt2', name: 'Archived', enabled: false },
          { gid: 'opt3', name: 'Pending', enabled: true },
        ],
      };

      const result = buildCustomFieldDefinition(customField);

      expect(result.enum?.values).toHaveLength(2);
      expect(result.enum?.values).toEqual([
        { key: 'opt1', name: 'Active' },
        { key: 'opt3', name: 'Pending' },
      ]);
    });
  });

  describe('multi_enum fields', () => {
    it('should build a multi_enum custom field definition with collection marker', () => {
      const customField: AsanaCustomField & { enum_options: AsanaEnumOption[] } = {
        gid: '12345',
        name: 'Tags',
        type: 'multi_enum',
        enum_options: [
          { gid: 'tag1', name: 'Frontend', enabled: true },
          { gid: 'tag2', name: 'Backend', enabled: true },
        ],
      };

      const result = buildCustomFieldDefinition(customField);

      expect(result.type).toBe('enum');
      expect(result.collection).toEqual({});
      expect(result.enum?.values).toEqual([
        { key: 'tag1', name: 'Frontend' },
        { key: 'tag2', name: 'Backend' },
      ]);
    });
  });

  describe('date fields', () => {
    it('should build a date custom field definition with timestamp type', () => {
      const customField: AsanaCustomField = {
        gid: '12345',
        name: 'Due Date',
        type: 'date',
      };

      const result = buildCustomFieldDefinition(customField);

      expect(result).toEqual({
        name: 'Due Date',
        description: 'Asana custom field: Due Date',
        type: 'timestamp',
      });
    });
  });

  describe('people fields', () => {
    it('should build a people custom field definition with reference type', () => {
      const customField: AsanaCustomField = {
        gid: '12345',
        name: 'Reviewer',
        type: 'people',
      };

      const result = buildCustomFieldDefinition(customField);

      expect(result).toEqual({
        name: 'Reviewer',
        description: 'Asana custom field: Reviewer',
        type: 'reference',
        reference: { refers_to: { '#record:users': {} } },
        collection: {},
      });
    });
  });

  describe('edge cases', () => {
    it('should default to text type for unknown field types', () => {
      const customField: AsanaCustomField = {
        gid: '12345',
        name: 'Unknown Field',
        type: 'formula' as AsanaCustomField['type'],
      };

      const result = buildCustomFieldDefinition(customField);

      expect(result.type).toBe('text');
    });

    it('should handle missing type with text default', () => {
      const customField: AsanaCustomField = {
        gid: '12345',
        name: 'No Type Field',
      };

      const result = buildCustomFieldDefinition(customField);

      expect(result.type).toBe('text');
    });

    it('should generate fallback name when name is missing', () => {
      const customField: AsanaCustomField = {
        gid: '12345',
        type: 'text',
      };

      const result = buildCustomFieldDefinition(customField);

      expect(result.name).toBe('Custom Field 12345');
    });
  });
});

describe('buildSectionFieldDefinition', () => {
  it('should build section field definition from sections array', () => {
    const sections: AsanaSection[] = [
      { gid: 'sec1', name: 'To Do' },
      { gid: 'sec2', name: 'In Progress' },
      { gid: 'sec3', name: 'Done' },
    ];

    const result = buildSectionFieldDefinition(sections);

    expect(result).toEqual({
      name: 'Section',
      description: 'The section/stage of the task in the project',
      type: 'enum',
      enum: {
        values: [
          { key: 'sec1', name: 'To Do' },
          { key: 'sec2', name: 'In Progress' },
          { key: 'sec3', name: 'Done' },
        ],
      },
    });
  });

  it('should handle sections without names using GID as fallback', () => {
    const sections: AsanaSection[] = [
      { gid: 'sec1', name: 'To Do' },
      { gid: 'sec2' },
    ];

    const result = buildSectionFieldDefinition(sections);

    expect(result?.enum?.values).toEqual([
      { key: 'sec1', name: 'To Do' },
      { key: 'sec2', name: 'Section sec2' },
    ]);
  });

  it('should handle empty sections array', () => {
    const sections: AsanaSection[] = [];

    const result = buildSectionFieldDefinition(sections);

    expect(result).toEqual({
      name: 'Section',
      description: 'The section/stage of the task in the project',
      type: 'enum',
      enum: { values: [] },
    });
  });
});

describe('buildTaskStageDiagram', () => {
  it('should build stage diagram with transitions for 3 sections', () => {
    const sections: AsanaSection[] = [
      { gid: 'sec1', name: 'To Do' },
      { gid: 'sec2', name: 'In Progress' },
      { gid: 'sec3', name: 'Done' },
    ];

    const result = buildTaskStageDiagram(sections);

    expect(result).toEqual({
      controlling_field: 'section',
      starting_stage: 'sec1',
      all_transitions_allowed: true,
      stages: {
        sec1: { transitions_to: ['sec2', 'sec3'], state: 'open' },
        sec2: { transitions_to: ['sec1', 'sec3'], state: 'in_progress' },
        sec3: { transitions_to: ['sec1', 'sec2'], state: 'closed' },
      },
      states: {
        open: { name: 'Open' },
        in_progress: { name: 'In Progress' },
        closed: { name: 'Closed', is_end_state: true },
      },
    });
  });

  it('should build stage diagram with 2 sections (minimum)', () => {
    const sections: AsanaSection[] = [
      { gid: 'sec1', name: 'Open' },
      { gid: 'sec2', name: 'Closed' },
    ];

    const result = buildTaskStageDiagram(sections);

    expect(result).not.toBeNull();
    expect(result?.stages.sec1.state).toBe('open');
    expect(result?.stages.sec2.state).toBe('closed');
  });

  it('should return null for less than 2 sections', () => {
    const sections: AsanaSection[] = [{ gid: 'sec1', name: 'Only Section' }];

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = buildTaskStageDiagram(sections);
    consoleSpy.mockRestore();

    expect(result).toBeNull();
  });

  it('should return null for empty sections array', () => {
    const sections: AsanaSection[] = [];

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = buildTaskStageDiagram(sections);
    consoleSpy.mockRestore();

    expect(result).toBeNull();
  });

  it('should assign in_progress state to middle sections', () => {
    const sections: AsanaSection[] = [
      { gid: 'sec1', name: 'Backlog' },
      { gid: 'sec2', name: 'Development' },
      { gid: 'sec3', name: 'Review' },
      { gid: 'sec4', name: 'Testing' },
      { gid: 'sec5', name: 'Done' },
    ];

    const result = buildTaskStageDiagram(sections);

    expect(result?.stages.sec1.state).toBe('open');
    expect(result?.stages.sec2.state).toBe('in_progress');
    expect(result?.stages.sec3.state).toBe('in_progress');
    expect(result?.stages.sec4.state).toBe('in_progress');
    expect(result?.stages.sec5.state).toBe('closed');
  });
});

describe('buildSubtaskCompletedStageFieldDefinition', () => {
  it('should build completed stage field with open and completed values', () => {
    const result = buildSubtaskCompletedStageFieldDefinition();

    expect(result).toEqual({
      name: 'Completed Stage',
      description: 'Stage derived from the completed status of the subtask',
      type: 'enum',
      enum: {
        values: [
          { key: 'open', name: 'Open' },
          { key: 'completed', name: 'Completed' },
        ],
      },
    });
  });
});

describe('buildSubtaskStageDiagram', () => {
  it('should build subtask stage diagram with open and completed stages', () => {
    const result = buildSubtaskStageDiagram();

    expect(result).toEqual({
      controlling_field: 'completed_stage',
      starting_stage: 'open',
      all_transitions_allowed: true,
      stages: {
        open: { transitions_to: ['completed'], state: 'open' },
        completed: { transitions_to: ['open'], state: 'closed' },
      },
      states: {
        open: { name: 'Open' },
        closed: { name: 'Closed', is_end_state: true },
      },
    });
  });

  it('should have bidirectional transitions between open and completed', () => {
    const result = buildSubtaskStageDiagram();

    expect(result.stages.open.transitions_to).toContain('completed');
    expect(result.stages.completed.transitions_to).toContain('open');
  });
});

describe('enrichMetadataWithCustomFields', () => {
  function createMockAsanaClient(customFields: AsanaCustomField[]) {
    const settings = customFields.map((cf) => ({ custom_field: cf }));
    return {
      getCustomFieldSettingsForProject: jest.fn().mockResolvedValue({
        data: { data: settings, next_page: null },
      }),
    } as any;
  }

  function createBaseMetadata(): ExternalDomainMetadata {
    return {
      schema_version: 'v0.2.0',
      record_types: {
        tasks: { name: 'Task', fields: {} },
        subtasks: { name: 'Subtask', fields: {} },
      },
    } as ExternalDomainMetadata;
  }

  it('should add custom fields to both tasks and subtasks', async () => {
    const customFields: AsanaCustomField[] = [
      { gid: 'cf1', name: 'Priority', type: 'text' },
      { gid: 'cf2', name: 'Points', type: 'number' },
    ];
    const client = createMockAsanaClient(customFields);
    const metadata = createBaseMetadata();

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await enrichMetadataWithCustomFields(metadata, client);
    consoleSpy.mockRestore();

    expect(metadata.record_types.tasks.fields['cf1']).toBeDefined();
    expect(metadata.record_types.tasks.fields['cf2']).toBeDefined();
    expect(metadata.record_types.subtasks.fields['cf1']).toBeDefined();
    expect(metadata.record_types.subtasks.fields['cf2']).toBeDefined();
    expect(metadata.record_types.tasks.fields['cf1']).toEqual(metadata.record_types.subtasks.fields['cf1']);
  });

  it('should skip fields without a name', async () => {
    const customFields: AsanaCustomField[] = [
      { gid: 'cf1', name: 'Valid', type: 'text' },
      { gid: 'cf2', type: 'text' },
    ];
    const client = createMockAsanaClient(customFields);
    const metadata = createBaseMetadata();

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await enrichMetadataWithCustomFields(metadata, client);
    consoleSpy.mockRestore();

    expect(metadata.record_types.tasks.fields['cf1']).toBeDefined();
    expect(metadata.record_types.tasks.fields['cf2']).toBeUndefined();
  });

  it('should return error message when API call fails', async () => {
    const client = {
      getCustomFieldSettingsForProject: jest.fn().mockRejectedValue(new Error('API error')),
    } as any;
    const metadata = createBaseMetadata();

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const result = await enrichMetadataWithCustomFields(metadata, client);
    consoleSpy.mockRestore();

    expect(result).toContain('Error fetching custom fields from Asana:');
  });

  it('should handle empty custom fields gracefully', async () => {
    const client = createMockAsanaClient([]);
    const metadata = createBaseMetadata();

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = await enrichMetadataWithCustomFields(metadata, client);
    consoleSpy.mockRestore();

    expect(result).toBeUndefined();
    expect(Object.keys(metadata.record_types.tasks.fields)).toHaveLength(0);
  });
});

describe('enrichMetadataWithSections', () => {
  function createBaseMetadata(): ExternalDomainMetadata {
    return {
      schema_version: 'v0.2.0',
      record_types: {
        tasks: { name: 'Task', fields: {} },
        subtasks: { name: 'Subtask', fields: {} },
      },
    } as ExternalDomainMetadata;
  }

  function createMockSectionsClient(sections: AsanaSection[]) {
    return {
      getSectionsForProject: jest.fn().mockResolvedValue({
        data: { data: sections, next_page: null },
      }),
    } as any;
  }

  it('should add section field and stage diagram to task metadata', async () => {
    const sections: AsanaSection[] = [
      { gid: 'sec1', name: 'To Do' },
      { gid: 'sec2', name: 'In Progress' },
      { gid: 'sec3', name: 'Done' },
    ];
    const client = createMockSectionsClient(sections);
    const metadata = createBaseMetadata();

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = await enrichMetadataWithSections(metadata, client);
    consoleSpy.mockRestore();

    expect(result).toBeUndefined();
    expect(metadata.record_types.tasks.fields.section).toBeDefined();
    expect(metadata.record_types.tasks.stage_diagram).toBeDefined();
    expect(metadata.record_types.tasks.stage_diagram?.starting_stage).toBe('sec1');
  });

  it('should return error message when API call fails', async () => {
    const client = {
      getSectionsForProject: jest.fn().mockRejectedValue(new Error('Sections API error')),
    } as any;
    const metadata = createBaseMetadata();

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    const result = await enrichMetadataWithSections(metadata, client);
    consoleSpy.mockRestore();

    expect(result).toContain('Error fetching sections from Asana');
  });

  it('should handle empty sections gracefully', async () => {
    const client = createMockSectionsClient([]);
    const metadata = createBaseMetadata();

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = await enrichMetadataWithSections(metadata, client);
    consoleSpy.mockRestore();

    expect(result).toBeUndefined();
    expect(metadata.record_types.tasks.fields.section).toBeUndefined();
  });

  it('should not add stage diagram when fewer than 2 sections', async () => {
    const client = createMockSectionsClient([{ gid: 'sec1', name: 'Only One' }]);
    const metadata = createBaseMetadata();

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await enrichMetadataWithSections(metadata, client);
    consoleSpy.mockRestore();

    expect(metadata.record_types.tasks.fields.section).toBeDefined();
    expect(metadata.record_types.tasks.stage_diagram).toBeUndefined();
  });
});

describe('enrichMetadataWithSubtaskStages', () => {
  it('should add subtask stage diagram when subtasks record type exists', () => {
    const metadata = {
      schema_version: 'v0.2.0',
      record_types: {
        tasks: { name: 'Task', fields: {} },
        subtasks: { name: 'Subtask', fields: {} },
      },
    } as ExternalDomainMetadata;

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    enrichMetadataWithSubtaskStages(metadata);
    consoleSpy.mockRestore();

    expect(metadata.record_types.subtasks.fields.completed_stage).toBeDefined();
    expect(metadata.record_types.subtasks.stage_diagram).toBeDefined();
    expect(metadata.record_types.subtasks.stage_diagram?.starting_stage).toBe('open');
  });

  it('should be a no-op when subtasks record type does not exist', () => {
    const metadata = {
      schema_version: 'v0.2.0',
      record_types: {
        tasks: { name: 'Task', fields: {} },
      },
    } as ExternalDomainMetadata;

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    enrichMetadataWithSubtaskStages(metadata);
    consoleSpy.mockRestore();

    expect(metadata.record_types.subtasks).toBeUndefined();
  });
});
