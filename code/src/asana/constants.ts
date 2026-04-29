export const ItemType = {
  TASKS: 'tasks',
  USERS: 'users',
  ATTACHMENTS: 'attachments',
  COMMENTS: 'comments',
  TAGS: 'tags',
  SUBTASKS: 'subtasks',
  LINKS: 'links',
  GROUPS: 'groups',
  GROUP_MEMBERSHIPS: 'group_memberships',
  ACCESS_RULES: 'access_rules',
  EXTERNAL_DOMAIN_METADATA: 'external_domain_metadata',
} as const;

export type ItemTypeValue = (typeof ItemType)[keyof typeof ItemType];

export const LinkType = {
  IS_DEPENDENT_ON: 'is_dependent_on',
  IS_PARENT_OF: 'is_parent_of',
} as const;

export type LinkTypeValue = (typeof LinkType)[keyof typeof LinkType];

export const StoryType = {
  COMMENT: 'comment',
} as const;

export const CustomFieldType = {
  TEXT: 'text',
  NUMBER: 'number',
  ENUM: 'enum',
  MULTI_ENUM: 'multi_enum',
  DATE: 'date',
  PEOPLE: 'people',
} as const;

export const StageState = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  CLOSED: 'closed',
} as const;

/**
 * Maximum depth for subtask extraction.
 * 0 = project task, 1 = subtask, 2 = sub-subtask
 * DevRev platform limitation: Links only support 2 levels deep (parent->child->child).
 */
export const MAX_SUBTASK_DEPTH = 2;

export const AccessLevel = {
  ADMIN: 'admin',
  EDITOR: 'editor',
  COMMENTER: 'commenter',
  VIEWER: 'viewer',
} as const;
