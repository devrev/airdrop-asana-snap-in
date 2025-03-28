import { NormalizedAttachment, NormalizedItem } from '@devrev/ts-adaas';

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
