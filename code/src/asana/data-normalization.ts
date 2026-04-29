import { NormalizedAttachment, NormalizedItem } from '@devrev/ts-adaas';

import { CustomFieldValue, extractCustomFields, extractSectionFromMemberships, toTimestamp } from '@utils/field-extraction-helpers';
import { parseAsanaRichText, RichTextContent } from '@utils/rich-text-helpers';

import type {
  AsanaAccessRulePrivilege,
  AsanaAttachment,
  AsanaLink,
  AsanaStory,
  AsanaTag,
  AsanaTask,
  AsanaUser,
} from './types';

function requireGid(item: { gid?: string }, context: string): string {
  if (!item.gid) throw new Error(`Cannot normalize ${context}: missing GID`);
  return item.gid;
}

/** Normalize an Asana user into a DevRev-compatible normalized item. */
export function normalizeAsanaUser(item: AsanaUser): NormalizedItem {
  return {
    id: requireGid(item, 'user'),
    created_date: new Date().toISOString(),
    modified_date: new Date().toISOString(),
    data: {
      display_name: item?.name ?? null,
      email: item?.email ?? null,
      full_name: item?.name ?? null,
    },
  };
}

/** Normalize an Asana tag into a DevRev-compatible normalized item. */
export function normalizeAsanaTag(item: AsanaTag): NormalizedItem {
  const createdDate = toTimestamp(item.created_at) ?? new Date().toISOString();
  return {
    id: requireGid(item, 'tag'),
    created_date: createdDate,
    modified_date: createdDate,
    data: {
      name: item?.name ?? null,
      color: item?.color ?? null,
      description: item?.notes ?? null,
    },
  };
}

interface TaskBaseData {
  id: string;
  createdDate: string;
  modifiedDate: string;
  tagIds: (string | undefined)[] | null;
  followerIds: (string | undefined)[] | null;
  dueDate: string | null;
  startDate: string | null;
  customFields: Record<string, CustomFieldValue>;
}

interface TaskData {
  name: string | null;
  assignee: string | null;
  created_by: string | null;
  description: RichTextContent[] | null;
  item_url_field: string | null;
  due_date: string | null;
  start_date: string | null;
  completed: boolean | null;
  completed_at: string | null;
  followers: (string | undefined)[] | null;
  parent_task: string | null;
  tags: (string | undefined)[] | null;
  actual_effort: number | null;
  completed_by: string | null;
  reported_by: string | null;
  resource_subtype: string | null;
  [key: string]: CustomFieldValue | RichTextContent[] | (string | undefined)[] | boolean | null;
}

function getTaskBaseData(item: AsanaTask): TaskBaseData {
  const createdDate = toTimestamp(item?.created_at) ?? new Date().toISOString();
  return {
    id: requireGid(item, 'task'),
    createdDate,
    modifiedDate: toTimestamp(item?.modified_at) ?? createdDate,
    tagIds: item?.tags?.map((tag) => tag.gid) ?? null,
    followerIds: item?.followers?.map((follower) => follower.gid) ?? null,
    dueDate: toTimestamp(item?.due_at ?? item?.due_on),
    startDate: toTimestamp(item?.start_at ?? item?.start_on),
    customFields: extractCustomFields(item?.custom_fields),
  };
}

function buildTaskData(item: AsanaTask, base: TaskBaseData): TaskData {
  return {
    name: item?.name ?? null,
    assignee: item?.assignee?.gid ?? null,
    created_by: item?.created_by?.gid ?? null,
    description: parseAsanaRichText(item?.html_notes),
    item_url_field: item?.permalink_url ?? null,
    due_date: base.dueDate,
    start_date: base.startDate,
    completed: item?.completed ?? null,
    completed_at: toTimestamp(item?.completed_at),
    followers: base.followerIds,
    parent_task: item?.parent?.gid ?? null,
    tags: base.tagIds,
    actual_effort: item?.actual_time_minutes ?? null,
    completed_by: item?.completed_by?.gid ?? null,
    reported_by: item?.created_by?.gid ?? null,
    resource_subtype: item?.resource_subtype ?? null,
    ...base.customFields,
  };
}

/** Normalize an Asana task into a DevRev-compatible normalized item with section data. */
export function normalizeAsanaTask(item: AsanaTask): NormalizedItem {
  const base = getTaskBaseData(item);
  return {
    id: base.id,
    created_date: base.createdDate,
    modified_date: base.modifiedDate,
    data: {
      ...buildTaskData(item, base),
      section: extractSectionFromMemberships(item?.memberships),
    },
  };
}

/** Normalize an Asana subtask into a DevRev-compatible normalized item with completion stage. */
export function normalizeAsanaSubtask(item: AsanaTask): NormalizedItem {
  const base = getTaskBaseData(item);
  return {
    id: base.id,
    created_date: base.createdDate,
    modified_date: base.modifiedDate,
    data: {
      ...buildTaskData(item, base),
      completed_stage: item?.completed ? 'completed' : 'open',
    },
  };
}

/** Normalize an Asana attachment into a DevRev-compatible normalized attachment. */
export function normalizeAsanaAttachment(item: AsanaAttachment): NormalizedAttachment {
  return {
    id: requireGid(item, 'attachment'),
    url: item.download_url ?? '',
    file_name: item.name ?? '',
    parent_id: item.parent_id ?? '',
    inline: item.inline ?? false,
  };
}

/** Normalize an Asana comment (story) into a DevRev-compatible normalized item. */
export function normalizeAsanaComment(item: AsanaStory): NormalizedItem {
  const htmlContent = item.html_text ?? item.text ?? null;
  const bodyContent = parseAsanaRichText(htmlContent);
  const createdDate = toTimestamp(item?.created_at) ?? new Date().toISOString();

  return {
    id: requireGid(item, 'comment'),
    created_date: createdDate,
    modified_date: createdDate,
    data: {
      parent_id: item.target?.gid ?? null,
      author: item.created_by?.gid ?? null,
      body: bodyContent,
    },
  };
}

/** Normalize an Asana team into a DevRev group item. */
export function normalizeAsanaGroup(teamGid: string, teamName: string, description?: string | null): NormalizedItem {
  return {
    id: teamGid,
    created_date: new Date().toISOString(),
    modified_date: new Date().toISOString(),
    data: {
      name: teamName,
      description: [description || `Asana team: ${teamName}`],
    },
  };
}

/** Normalize team membership into a DevRev group membership item. */
export function normalizeAsanaGroupMembership(teamGid: string, memberUserGids: string[]): NormalizedItem {
  return {
    id: `gm_${teamGid}`,
    created_date: new Date().toISOString(),
    modified_date: new Date().toISOString(),
    data: {
      group_id: teamGid,
      member_ids: memberUserGids,
    },
  };
}

export interface AccessRuleInput {
  accessLevel: string;
  userIds: string[];
  groupIds: string[];
  privileges: AsanaAccessRulePrivilege[];
  recordTypes: string[];
}

/** Normalize an access rule into a DevRev authorization policy item. */
export function normalizeAsanaAccessRule(input: AccessRuleInput): NormalizedItem {
  return {
    id: `access_rule_${input.accessLevel}`,
    created_date: new Date().toISOString(),
    modified_date: new Date().toISOString(),
    data: {
      permission_users: input.userIds,
      permission_groups: input.groupIds,
      object_access: [
        {
          record_types: input.recordTypes,
          privileges: input.privileges,
        },
      ],
    },
  };
}

/** Normalize an Asana link (dependency/parent) into a DevRev-compatible normalized item. */
export function normalizeAsanaLink(item: AsanaLink): NormalizedItem {
  const linkId = `${item.link_type}_${item.source_gid}_${item.target_gid}`;

  return {
    id: linkId,
    created_date: new Date().toISOString(),
    modified_date: new Date().toISOString(),
    data: {
      source: item.source_gid,
      target: item.target_gid,
      link_type: item.link_type,
    },
  };
}

