import { NormalizedAttachment, NormalizedItem } from '@devrev/ts-adaas';

// Normalization functions transform data after extraction from an external system.
// Each function receives the originally extracted item as a parameter.
// The function should return a normalized item in the specific format defined by the
// NormalizedItem and NormalizedAttachment types, which need to adhere to the normalization rules.
// Only include the fields that need to be imported into DevRev in the returned object.
// For more details on normalization rules, refer to the documentation here:
// https://github.com/devrev/adaas-chef-cli/blob/main/docs/step_by_step.md#normalize-data

// Timestamps should be formatted as RFC3399
export function formatNormalizeTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toISOString();
}

export function normalizeTask(item: any): NormalizedItem {
  return {
    id: item.gid,
    created_date: formatNormalizeTime(item.created_at),
    modified_date: formatNormalizeTime(item.modified_at),
    data: {
      name: item?.name || null,
      assignee: item?.assignee?.gid || null,
      description: item?.html_notes ? [item?.html_notes] : null,
      item_url_field: item?.item_url_field || null,
    },
  };
}

export function normalizeUser(item: any): NormalizedItem {
  return {
    id: item.gid,
    created_date: new Date().toISOString(),
    modified_date: new Date().toISOString(),
    data: {
      email: item?.email || null,
      name: item?.name || null,
    },
  };
}

export function normalizeAttachment(item: any): NormalizedAttachment {
  return {
    id: item.gid,
    url: item.download_url,
    file_name: item.name,
    parent_id: item.parent_id,
  };
}
