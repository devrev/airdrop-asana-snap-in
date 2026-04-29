import type {
  CustomStage,
  ExternalDomainMetadata,
  Field,
  FieldType,
  StageDiagram,
} from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { CustomFieldType, StageState } from '@asana/constants';
import type { AsanaCustomField, AsanaSection } from '@asana/types';
import { serializeError } from '@utils/serialize-error';

function mapAsanaTypeToMetadataType(asanaType: string): FieldType {
  const typeMap: Record<string, FieldType> = {
    [CustomFieldType.TEXT]: 'text',
    [CustomFieldType.NUMBER]: 'float',
    [CustomFieldType.ENUM]: 'enum',
    [CustomFieldType.MULTI_ENUM]: 'enum',
    [CustomFieldType.DATE]: 'timestamp',
    [CustomFieldType.PEOPLE]: 'reference',
  };
  return typeMap[asanaType] || 'text';
}

/** Build a DevRev field definition from an Asana custom field. */
export function buildCustomFieldDefinition(customField: AsanaCustomField): Field {
  const fieldType = mapAsanaTypeToMetadataType(customField.type || 'text');

  const fieldDef: Field = {
    name: customField.name || `Custom Field ${customField.gid}`,
    description: customField.description || `Asana custom field: ${customField.name}`,
    type: fieldType,
  };

  if (customField.type === CustomFieldType.ENUM || customField.type === CustomFieldType.MULTI_ENUM) {
    const enumOptions = customField.enum_options ?? [];
    fieldDef.enum = {
      values: enumOptions
        .filter((opt) => opt.enabled !== false)
        .map((opt) => ({ key: opt.gid!, name: opt.name })),
    };

    if (customField.type === CustomFieldType.MULTI_ENUM) {
      fieldDef.collection = {};
    }
  }

  if (customField.type === CustomFieldType.PEOPLE) {
    fieldDef.reference = { refers_to: { '#record:users': {} } };
    fieldDef.collection = {};
  }

  return fieldDef;
}

/** Build a DevRev enum field definition from Asana project sections. */
export function buildSectionFieldDefinition(sections: AsanaSection[]): Field {
  return {
    name: 'Section',
    description: 'The section/stage of the task in the project',
    type: 'enum',
    enum: {
      values: sections.map((section) => ({
        key: section.gid!,
        name: section.name ?? `Section ${section.gid}`,
      })),
    },
  };
}

/** Build a stage diagram from Asana sections, or null if fewer than 2 sections. */
export function buildTaskStageDiagram(sections: AsanaSection[]): StageDiagram | null {
  // A stage diagram requires at least 2 sections (start + end states)
  if (sections.length < 2) {
    console.log('Less than 2 sections found in Asana project. Skipping stage diagram.');
    return null;
  }

  const stages: Record<string, CustomStage> = {};

  sections.forEach((section, index) => {
    const gid = section.gid!;
    const state: string =
      index === 0 ? StageState.OPEN : index === sections.length - 1 ? StageState.CLOSED : StageState.IN_PROGRESS;
    const transitionsTo = sections.filter((s) => s.gid !== gid).map((s) => s.gid!);

    stages[gid] = { transitions_to: transitionsTo, state };
  });

  return {
    controlling_field: 'section',
    starting_stage: sections[0].gid!,
    all_transitions_allowed: true,
    stages,
    states: {
      [StageState.OPEN]: { name: 'Open' },
      [StageState.IN_PROGRESS]: { name: 'In Progress' },
      [StageState.CLOSED]: { name: 'Closed', is_end_state: true },
    },
  };
}

/** Build the completed stage enum field definition for subtasks (open/completed). */
export function buildSubtaskCompletedStageFieldDefinition(): Field {
  return {
    name: 'Completed Stage',
    description: 'Stage derived from the completed status of the subtask',
    type: 'enum',
    enum: {
      values: [
        { key: 'open', name: 'Open' },
        { key: 'completed', name: 'Completed' },
      ],
    },
  };
}

/** Build the stage diagram for subtasks based on completion status. */
export function buildSubtaskStageDiagram(): StageDiagram {
  return {
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
  };
}

async function fetchCustomFields(asanaClient: AsanaClient): Promise<AsanaCustomField[]> {
  const customFields: AsanaCustomField[] = [];
  let offset: string | undefined;

  do {
    const response = await asanaClient.getCustomFieldSettingsForProject({
      ...(offset && { offset }),
    });

    if (response.data?.data) {
      const fields = response.data.data
        .map((setting) => setting.custom_field)
        .filter((cf): cf is NonNullable<typeof cf> => !!cf);
      customFields.push(...(fields as AsanaCustomField[]));
    }

    offset = response.data?.next_page?.offset;
  } while (offset);

  return customFields;
}

async function fetchSections(asanaClient: AsanaClient): Promise<AsanaSection[]> {
  const sections: AsanaSection[] = [];
  let offset: string | undefined;

  do {
    const response = await asanaClient.getSectionsForProject({
      ...(offset && { offset }),
    });

    if (response.data?.data) {
      sections.push(...response.data.data);
    }

    offset = response.data?.next_page?.offset;
  } while (offset);

  return sections;
}

/** Fetch custom fields from Asana and add them to the metadata record types. */
export async function enrichMetadataWithCustomFields(
  metadata: ExternalDomainMetadata,
  asanaClient: AsanaClient
): Promise<string | void> {
  let customFields: AsanaCustomField[];

  try {
    customFields = await fetchCustomFields(asanaClient);
  } catch (error) {
    const errorMessage = `Error fetching custom fields from Asana: ${serializeError(error)}`;
    console.error(errorMessage);
    return errorMessage;
  }

  const validFields = customFields.filter((cf) => !!cf.name);
  if (validFields.length === 0) {
    console.log('No custom fields found in Asana project.');
    return;
  }

  validFields.forEach((cf) => {
    const fieldDef = buildCustomFieldDefinition(cf);
    metadata.record_types.tasks.fields[cf.gid!] = fieldDef;
    if (metadata.record_types.subtasks) {
      metadata.record_types.subtasks.fields[cf.gid!] = fieldDef;
    }
  });
  const fieldsSummary = validFields.map((cf) => `${cf.name} (${cf.gid})`).join(', ');
  console.log(`Added ${validFields.length} custom fields to tasks and subtasks: ${fieldsSummary}`);
}

/** Fetch sections from Asana and add them as a stage diagram to task metadata. */
export async function enrichMetadataWithSections(
  metadata: ExternalDomainMetadata,
  asanaClient: AsanaClient
): Promise<string | void> {
  let sections: AsanaSection[];

  try {
    sections = await fetchSections(asanaClient);
  } catch (error) {
    const errorMessage = `Error fetching sections from Asana: ${serializeError(error)}`;
    console.error(errorMessage);
    return errorMessage;
  }

  if (sections.length === 0) {
    console.log('No sections found in project.');
    return;
  }

  metadata.record_types.tasks.fields.section = buildSectionFieldDefinition(sections);

  const stageDiagram = buildTaskStageDiagram(sections);
  if (stageDiagram) {
    metadata.record_types.tasks.stage_diagram = stageDiagram;
  }

  const sectionNames = sections.map((s) => s.name || s.gid).join(', ');
  console.log(`Added ${sections.length} sections as stage diagram: ${sectionNames}.`);
}

/** Add the subtask completion stage diagram to metadata if subtasks record type exists. */
export function enrichMetadataWithSubtaskStages(metadata: ExternalDomainMetadata): void {
  if (!metadata.record_types.subtasks) return;

  metadata.record_types.subtasks.fields.completed_stage = buildSubtaskCompletedStageFieldDefinition();
  metadata.record_types.subtasks.stage_diagram = buildSubtaskStageDiagram();

  console.log('Added subtask stage diagram: Open, Completed');
}
