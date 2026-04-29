import { axios, ErrorRecord, EventType, SyncMode, WorkerAdapter } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { ItemType, LinkType, MAX_SUBTASK_DEPTH, StoryType } from '@asana/constants';
import {
  normalizeAsanaGroup,
  normalizeAsanaGroupMembership,
} from '@asana/data-normalization';
import type { AsanaAttachment, AsanaLink, AsanaStory, AsanaTask } from '@asana/types';
import {
  extractAttachmentGidFromCommentText,
  extractAttachmentsFromTask,
  extractInlineAttachmentGids,
  stripAssetUrlsFromText,
} from '@utils/attachment-helpers';
import { serializeError } from '@utils/serialize-error';

import { ExtractorState, initialState } from '../functions/extraction/index';

export interface ExtractListResponse {
  delay?: number;
  error?: ErrorRecord;
}

export interface TaskExtractionBuffer {
  tasks: AsanaTask[];
  subtasks: AsanaTask[];
  comments: AsanaStory[];
  attachments: AsanaAttachment[];
  links: AsanaLink[];
}

/** Initialize extraction state based on sync mode (initial vs incremental). */
export function prepareStateForExtraction(adapter: WorkerAdapter<ExtractorState>): void {
  if (adapter.event.payload.event_type !== EventType.StartExtractingData) {
    return;
  }

  const { extract_from, extract_to, mode } = adapter.event.payload.event_context;

  if (mode === SyncMode.INCREMENTAL) {
    adapter.state.users = { ...initialState.users };
    adapter.state.tasks = { ...initialState.tasks };
    adapter.state.attachments = { ...initialState.attachments };
    adapter.state.comments = { ...initialState.comments };
    adapter.state.tags = { ...initialState.tags };
    adapter.state.subtasks = { ...initialState.subtasks };
    adapter.state.links = { ...initialState.links };
    adapter.state.groups = { ...initialState.groups };
    adapter.state.group_memberships = { ...initialState.group_memberships };
    adapter.state.access_rules = { ...initialState.access_rules };
  }

  console.log(
    `${mode === SyncMode.INCREMENTAL ? 'Incremental' : 'Initial'} sync: ` +
      `extracting${extract_from ? ` from ${extract_from}` : ''}${extract_to ? ` to ${extract_to}` : ''}.`
  );
}

/** Handle extraction errors, returning a delay for 429s or an error record otherwise. */
export function handleExtractionError(error: unknown): ExtractListResponse {
  if (axios.isAxiosError(error) && error.response?.status === 429) {
    // Fall back to 60s if Retry-After header is missing or non-numeric
    const retryAfter = Number(error.response.headers['retry-after']) || 60;
    return { delay: retryAfter };
  }

  const errorMessage = `Error while extracting data: ${serializeError(error)}`;
  return { error: { message: errorMessage } };
}

/** Extract all workspace users from Asana with pagination and timeout support. */
export async function extractUsers(asanaClient: AsanaClient, adapter: WorkerAdapter<ExtractorState>): Promise<void> {
  let offset = adapter.state.users.offset;

  do {
    if (adapter.isTimeout) {
      console.log('Timeout detected, stopping users extraction.');
      return;
    }

    const response = await asanaClient.getUsersForWorkspace({
      ...(offset ? { offset } : {}),
    });

    const users = response.data?.data || [];
    if (users.length > 0) {
      await adapter.getRepo(ItemType.USERS)?.push(users);
      adapter.state.users.total += users.length;
    }

    offset = response.data?.next_page?.offset || '';
    adapter.state.users.offset = offset;
  } while (offset);

  console.log(`Users extraction: completed. Extracted ${adapter.state.users.total} workspace users.`);
}

/** Extract all workspace tags from Asana with pagination and timeout support. */
export async function extractTags(asanaClient: AsanaClient, adapter: WorkerAdapter<ExtractorState>): Promise<void> {
  do {
    if (adapter.isTimeout) {
      console.log('Timeout detected, stopping tags extraction.');
      return;
    }

    const response = await asanaClient.getTagsForWorkspace({
      ...(adapter.state.tags.offset && { offset: adapter.state.tags.offset }),
    });
    const tags = response.data?.data || [];
    await adapter.getRepo(ItemType.TAGS)?.push(tags);
    adapter.state.tags.total += tags.length;
    adapter.state.tags.offset = response.data?.next_page?.offset || '';

  } while (adapter.state.tags.offset);

  console.log(`Tags extraction: completed. Extracted ${adapter.state.tags.total} workspace tags.`);
}

/** Extract all workspace teams as DevRev groups, and their memberships. */
export async function extractGroups(
  asanaClient: AsanaClient,
  adapter: WorkerAdapter<ExtractorState>
): Promise<void> {
  let offset = adapter.state.groups.offset;

  do {
    if (adapter.isTimeout) {
      console.log('Timeout detected, stopping groups extraction.');
      return;
    }

    const response = await asanaClient.getTeamsForWorkspace({
      ...(offset ? { offset } : {}),
    });

    const teams = response.data?.data || [];
    for (const team of teams) {
      if (adapter.isTimeout) {
        console.log('Timeout detected during team processing.');
        return;
      }

      if (!team.gid) continue;

      const groupItem = normalizeAsanaGroup(team.gid, team.name ?? `Team ${team.gid}`, (team as unknown as { description?: string }).description);
      await adapter.getRepo(ItemType.GROUPS)?.push([groupItem]);
      adapter.state.groups.total += 1;

      if (adapter.shouldExtract(ItemType.GROUP_MEMBERSHIPS)) {
        const teamUserGids = await fetchTeamMemberUserGids(team.gid, asanaClient);
        if (teamUserGids.length > 0) {
          const groupMembershipItem = normalizeAsanaGroupMembership(team.gid, teamUserGids);
          await adapter.getRepo(ItemType.GROUP_MEMBERSHIPS)?.push([groupMembershipItem]);
          adapter.state.group_memberships.total += 1;
        }
      }
    }

    offset = response.data?.next_page?.offset || '';
    adapter.state.groups.offset = offset;

    console.log(`Groups extraction: page completed. Extracted ${teams.length} teams.`);
  } while (offset);

  console.log(
    `Groups extraction: completed. Extracted ${adapter.state.groups.total} groups, ${adapter.state.group_memberships.total} group memberships.`
  );
}

/**
 * Fetch all team memberships for a given team with pagination.
 * Returns the list of user GIDs in the team.
 */
export async function fetchTeamMemberUserGids(teamGid: string, asanaClient: AsanaClient): Promise<string[]> {
  const userGids: string[] = [];
  let offset = '';

  do {
    const response = await asanaClient.getTeamMembershipsForTeam(teamGid, {
      ...(offset ? { offset } : {}),
    });
    const page = response.data?.data || [];
    for (const membership of page) {
      if (membership.user?.gid) {
        userGids.push(membership.user.gid);
      }
    }
    offset = response.data?.next_page?.offset || '';
  } while (offset);

  return userGids;
}

/** Fetch all comments for a given task, filtering to comment-type stories. */
export async function fetchCommentsForTask(taskGid: string, asanaClient: AsanaClient): Promise<AsanaStory[]> {
  const comments: AsanaStory[] = [];
  let storiesOffset = '';

  do {
    const storiesResponse = await asanaClient.getStoriesForTask(taskGid, {
      ...(storiesOffset && { offset: storiesOffset }),
    });
    const stories = storiesResponse.data?.data || [];

    for (const story of stories) {
      if (story.type === StoryType.COMMENT) {
        comments.push(story);
      }
    }

    storiesOffset = storiesResponse.data?.next_page?.offset || '';
  } while (storiesOffset);

  return comments;
}

/** Fetch all subtasks for a given task with pagination. */
export async function fetchAllSubtasks(taskGid: string, asanaClient: AsanaClient): Promise<AsanaTask[]> {
  const subtasks: AsanaTask[] = [];
  let offset = '';

  do {
    const response = await asanaClient.getSubtasksForTask(taskGid, {
      ...(offset && { offset }),
    });
    const fetchedSubtasks = response.data?.data || [];
    subtasks.push(...fetchedSubtasks);
    offset = response.data?.next_page?.offset || '';
  } while (offset);

  return subtasks;
}

/**
 * Recursively extract a task and its subtasks (up to MAX_SUBTASK_DEPTH levels).
 * All extracted data is accumulated into the provided buffer rather than pushed
 * directly to repos, so the caller can flush atomically after the entire task
 * tree is processed. This prevents duplicate data if a timeout interrupts extraction.
 */
export async function extractTaskWithSubtasks(
  task: AsanaTask,
  asanaClient: AsanaClient,
  projectId: string,
  buffer: TaskExtractionBuffer,
  adapter: WorkerAdapter<ExtractorState>,
  depth: number = 0,
  extractFrom?: string,
  extractTo?: string
): Promise<void> {
  if (depth === 0) {
    buffer.tasks.push(task);
  } else {
    buffer.subtasks.push(task);
  }

  // Fetch comments when comments or attachments are in scope (attachments need
  // comment text for inline attachment GID discovery).
  if (adapter.shouldExtract(ItemType.COMMENTS) || adapter.shouldExtract(ItemType.ATTACHMENTS)) {
    const comments = await fetchCommentsForTask(task.gid ?? '', asanaClient);
    const inlineAttachmentGids = extractInlineAttachmentGids(task.html_notes);

    // Build a map of attachment GIDs to comment GIDs for image attachments posted via comments
    // Also track which comments are image-only (should be extracted)
    const attachmentToCommentMap = new Map<string, string>();
    const imageOnlyCommentGids = new Set<string>();

    for (const comment of comments) {
      const commentInlineGids = extractInlineAttachmentGids(comment.html_text);
      for (const gid of commentInlineGids) {
        inlineAttachmentGids.add(gid);
      }

      if (!comment.gid) continue;

      const attachmentGid = extractAttachmentGidFromCommentText(comment.text);
      if (attachmentGid && commentInlineGids.has(attachmentGid)) {
        attachmentToCommentMap.set(attachmentGid, comment.gid);
        imageOnlyCommentGids.add(comment.gid);
      }
    }

    if (adapter.shouldExtract(ItemType.ATTACHMENTS)) {
      const attachments = extractAttachmentsFromTask(task, inlineAttachmentGids, attachmentToCommentMap).filter(
        (attachment) => !!attachment.download_url
      );

      const filteredAttachments = attachments.filter((attachment) => {
        const createdAt = attachment.created_at;
        if (extractFrom && !(createdAt && createdAt >= extractFrom)) return false;
        if (extractTo && createdAt && createdAt > extractTo) return false;
        return true;
      });

      if (filteredAttachments.length > 0) {
        buffer.attachments.push(...filteredAttachments);
      }
    }

    if (adapter.shouldExtract(ItemType.COMMENTS)) {
      const filteredComments = comments.filter((comment) => {
        if (comment.gid && imageOnlyCommentGids.has(comment.gid)) {
          const createdAt = comment.created_at;
          if (extractFrom && !(createdAt && createdAt >= extractFrom)) return false;
          if (extractTo && createdAt && createdAt > extractTo) return false;
          return true;
        }

        if (extractAttachmentGidFromCommentText(comment.text)) {
          return false;
        }

        // Skip comments where stripping asset URLs leaves no text content
        const strippedText = stripAssetUrlsFromText(comment.text);
        if (!strippedText) {
          return false;
        }

        const createdAt = comment.created_at;
        if (extractFrom && !(createdAt && createdAt >= extractFrom)) return false;
        if (extractTo && createdAt && createdAt > extractTo) return false;
        return true;
      });

      if (filteredComments.length > 0) {
        buffer.comments.push(...filteredComments);
      }
    }
  }

  if (adapter.shouldExtract(ItemType.LINKS) && depth === 0 && task.dependencies && Array.isArray(task.dependencies)) {
    const dependencyLinks: AsanaLink[] = task.dependencies
      .filter((dependency) => dependency.gid)
      .map((dependency) => ({
        source_gid: task.gid ?? '',
        target_gid: dependency.gid ?? '',
        link_type: LinkType.IS_DEPENDENT_ON,
      }));

    if (dependencyLinks.length > 0) {
      buffer.links.push(...dependencyLinks);
    }
  }

  if (adapter.shouldExtract(ItemType.SUBTASKS) && task.num_subtasks && task.num_subtasks > 0) {
    if (depth < MAX_SUBTASK_DEPTH) {
      const subtasks = await fetchAllSubtasks(task.gid ?? '', asanaClient);

      for (const subtask of subtasks) {
        if (extractFrom) {
          const createdAt = subtask.created_at;
          const modifiedAt = subtask.modified_at;
          const isNew = createdAt && createdAt >= extractFrom;
          const isModified = modifiedAt && modifiedAt >= extractFrom;

          if (!isNew && !isModified) {
            continue;
          }
        }

        if (extractTo) {
          const createdAt = subtask.created_at;
          const modifiedAt = subtask.modified_at;
          const createdBeforeEnd = !createdAt || createdAt <= extractTo;
          const modifiedBeforeEnd = !modifiedAt || modifiedAt <= extractTo;

          if (!createdBeforeEnd && !modifiedBeforeEnd) {
            continue;
          }
        }

        if (adapter.shouldExtract(ItemType.LINKS)) {
          buffer.links.push({
            source_gid: task.gid ?? '',
            target_gid: subtask.gid ?? '',
            link_type: LinkType.IS_PARENT_OF,
          });
        }

        await extractTaskWithSubtasks(subtask, asanaClient, projectId, buffer, adapter, depth + 1, extractFrom, extractTo);
      }
    } else {
      console.warn(
        `Subtask extraction: Task ${task.gid} has ${task.num_subtasks} subtasks at depth ${depth + 1} ` +
          `which exceeds max depth of ${MAX_SUBTASK_DEPTH}. Skipping deeper subtasks.`
      );
    }
  }
}

/** Extract all project tasks and their subtrees (subtasks, comments, attachments, links). */
export async function extractTasks(asanaClient: AsanaClient, adapter: WorkerAdapter<ExtractorState>): Promise<void> {
  const { extract_from: extractFrom, extract_to: extractTo } = adapter.event.payload.event_context;

  do {
    if (adapter.isTimeout) {
      console.log('Timeout detected, stopping tasks extraction.');
      return;
    }

    const beforeTasks = adapter.state.tasks.total;
    const beforeSubtasks = adapter.state.subtasks.total;
    const beforeLinks = adapter.state.links.total;
    const beforeAttachments = adapter.state.attachments.total;
    const beforeComments = adapter.state.comments.total;

    const response = await asanaClient.getTasks({
      ...(adapter.state.tasks.offset && { offset: adapter.state.tasks.offset }),
      ...(extractFrom && { modified_since: extractFrom }),
    });

    const projectTasks: AsanaTask[] = (response.data?.data || []).map((task) => ({
      ...task,
      item_url_field: `https://app.asana.com/0/${asanaClient.projectId}/${task.gid}`,
    }));

    const startIndex = adapter.state.tasks.lastExtractedTaskIndex + 1;

    for (let i = startIndex; i < projectTasks.length; i++) {
      // Upper bound filter — Asana API only supports lower bound via modified_since
      if (extractTo) {
        const task = projectTasks[i];
        const createdAfterEnd = task.created_at && task.created_at > extractTo;
        const modifiedAfterEnd = task.modified_at && task.modified_at > extractTo;
        if (createdAfterEnd && modifiedAfterEnd) {
          adapter.state.tasks.lastExtractedTaskIndex = i;
          continue;
        }
      }

      const buffer: TaskExtractionBuffer = {
        tasks: [],
        subtasks: [],
        comments: [],
        attachments: [],
        links: [],
      };

      await extractTaskWithSubtasks(
        projectTasks[i],
        asanaClient,
        asanaClient.projectId,
        buffer,
        adapter,
        0,
        extractFrom,
        extractTo
      );

      if (buffer.tasks.length > 0) {
        await adapter.getRepo(ItemType.TASKS)?.push(buffer.tasks);
        adapter.state.tasks.total += buffer.tasks.length;
      }
      if (buffer.subtasks.length > 0) {
        await adapter.getRepo(ItemType.SUBTASKS)?.push(buffer.subtasks);
        adapter.state.subtasks.total += buffer.subtasks.length;
      }
      if (buffer.comments.length > 0) {
        await adapter.getRepo(ItemType.COMMENTS)?.push(buffer.comments);
        adapter.state.comments.total += buffer.comments.length;
      }
      if (buffer.attachments.length > 0) {
        await adapter.getRepo(ItemType.ATTACHMENTS)?.push(buffer.attachments);
        adapter.state.attachments.total += buffer.attachments.length;
      }
      if (buffer.links.length > 0) {
        await adapter.getRepo(ItemType.LINKS)?.push(buffer.links);
        adapter.state.links.total += buffer.links.length;
      }

      adapter.state.tasks.lastExtractedTaskIndex = i;

      if (adapter.isTimeout) {
        console.log('Timeout detected after completing task, stopping extraction.');
        return;
      }
    }

    console.log(
      `Tasks extraction: page completed. ` +
        `Extracted ${adapter.state.tasks.total - beforeTasks} tasks, ` +
        `${adapter.state.subtasks.total - beforeSubtasks} subtasks, ` +
        `${adapter.state.links.total - beforeLinks} links, ` +
        `${adapter.state.attachments.total - beforeAttachments} attachments, ` +
        `${adapter.state.comments.total - beforeComments} comments.`
    );

    adapter.state.tasks.lastExtractedTaskIndex = -1;
    adapter.state.tasks.offset = response.data?.next_page?.offset || '';
  } while (adapter.state.tasks.offset);
}
