import { CustomFieldType } from '@asana/constants';
import type { AsanaCustomField, AsanaTaskMembership } from '@asana/types';

export type CustomFieldValue = string | number | string[] | null;

/** Convert a date string to ISO 8601 timestamp, or null if invalid. */
export function toTimestamp(dateStr: string | null | undefined): string | null {
  if (!dateStr) {
    return null;
  }
  try {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00.000Z` : dateStr;

    const date = new Date(normalized);
    if (isNaN(date.getTime())) {
      console.warn(`Invalid date string: ${dateStr}`);
      return null;
    }
    return date.toISOString();
  } catch (error) {
    console.warn(`Failed to parse date: ${dateStr}`, error);
    return null;
  }
}

/** Extract the YYYY-MM-DD portion from a date string, or null if invalid. */
export function toDateOnly(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const match = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/** Extract custom field values from Asana task custom fields into a key-value map. */
export function extractCustomFields(
  customFields: AsanaCustomField[] | null | undefined
): Record<string, CustomFieldValue> {
  const result: Record<string, CustomFieldValue> = {};

  if (!customFields || !Array.isArray(customFields) || customFields.length === 0) {
    return result;
  }

  for (const field of customFields) {
    if (!field?.gid || !field?.name) {
      continue;
    }

    const fieldKey = field.gid;
    let fieldValue: CustomFieldValue = null;

    switch (field.type) {
      case CustomFieldType.TEXT:
        fieldValue = field.text_value || null;
        break;
      case CustomFieldType.NUMBER:
        fieldValue = field.number_value ?? null;
        break;
      case CustomFieldType.ENUM:
        fieldValue = field.enum_value?.gid || null;
        break;
      case CustomFieldType.MULTI_ENUM:
        fieldValue = field.multi_enum_values?.map((v) => v.gid).filter((gid): gid is string => !!gid) || null;
        break;
      case CustomFieldType.DATE:
        if (field.date_value) {
          fieldValue = field.date_value.date_time || field.date_value.date || null;
        }
        break;
      case CustomFieldType.PEOPLE:
        fieldValue = field.people_value?.map((p) => p.gid).filter((gid): gid is string => !!gid) || null;
        break;
      default:
        fieldValue = field.display_value || null;
    }

    if (fieldValue !== null && fieldValue !== undefined) {
      result[fieldKey] = fieldValue;
    }
  }

  return result;
}

/** Get the section GID from a task's project memberships. */
export function extractSectionFromMemberships(
  memberships: AsanaTaskMembership[] | null | undefined,
  projectId?: string
): string | null {
  if (!memberships || !Array.isArray(memberships) || memberships.length === 0) {
    return null;
  }

  if (projectId) {
    const membership = memberships.find((m) => m.project?.gid === projectId);
    if (membership?.section?.gid) {
      return membership.section.gid;
    }
  }

  for (const membership of memberships) {
    if (membership?.section?.gid) {
      return membership.section.gid;
    }
  }

  return null;
}
