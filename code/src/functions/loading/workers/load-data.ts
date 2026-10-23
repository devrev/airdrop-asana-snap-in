import type {
  AirSyncEvent,
  ExternalSystemItem,
  ExternalSystemItemLoadingParams,
  ExternalSystemItemLoadingResponse,
} from '@devrev/airsync-sdk';
import { processLoadingTask } from '@devrev/airsync-sdk';

import { AsanaClient } from '@asana/api-client';
import { ItemType, LinkType } from '@asana/constants';
import { denormalizeComment, denormalizeLink, denormalizeTask } from '@asana/data-denormalization';
import { getAsanaAccessErrorCode } from '@utils/error-helpers';
import { toTimestamp } from '@utils/field-extraction-helpers';
import { handleLoadingError, resolveExternalId, resolveRef } from '@utils/loading-helpers';
import { serializeError } from '@utils/serialize-error';

import type { LoaderState } from '../index';

function buildResolver(mappers: ExternalSystemItemLoadingParams<ExternalSystemItem>['mappers'], event: AirSyncEvent) {
  const syncUnit = event.payload.event_context.sync_unit;
  return (devrevId: string) => resolveExternalId(mappers, syncUnit, devrevId);
}

async function createTask({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
  try {
    const resolveId = buildResolver(mappers, event);
    const asanaClient = new AsanaClient(event);
    const { createRequest, sectionGid, tagGids } = await denormalizeTask(item.data, resolveId);

    if (createRequest.data) {
      createRequest.data.projects = [asanaClient.projectId];
    }
    const response = await asanaClient.createTask(createRequest);
    const taskGid = response.data?.data?.gid;
    const modifiedAt = response.data?.data?.modified_at;

    if (!taskGid) return { status: 'error', error: { message: `Failed to create task — no GID returned. taskDevrevId=${item.id.devrev}` } };

    if (sectionGid) {
      try {
        await asanaClient.addTaskToSection(sectionGid, { data: { task: taskGid } });
      } catch (error) {
        if (getAsanaAccessErrorCode(error)) throw error;
        console.warn(`Task ${taskGid} (devrevId=${item.id.devrev}) created but section assignment to ${sectionGid} failed: ${serializeError(error)}`);
      }
    }

    if (tagGids?.length) {
      const failedTags: string[] = [];
      for (const tagGid of tagGids) {
        try {
          await asanaClient.addTagToTask(taskGid, { data: { tag: tagGid } });
        } catch (error) {
          if (getAsanaAccessErrorCode(error)) throw error;
          failedTags.push(tagGid);
        }
      }
      if (failedTags.length > 0) {
        console.warn(`Task ${taskGid} (devrevId=${item.id.devrev}): ${failedTags.length} tag assignments failed: ${failedTags.join(', ')}`);
      }
    }

    return { status: 'success', id: taskGid, modifiedDate: modifiedAt };
  } catch (error) {
    return handleLoadingError(error);
  }
}

async function updateTask({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
  try {
    const resolveId = buildResolver(mappers, event);
    let externalId = item.id.external;
    if (!externalId) {
      externalId = await resolveId(item.id.devrev) ?? undefined;
    }
    if (!externalId) return { status: 'error', error: { message: `No external ID for task update. taskDevrevId=${item.id.devrev}` } };

    const asanaClient = new AsanaClient(event);
    const { updateRequest, sectionGid, tagGids } = await denormalizeTask(item.data, resolveId);

    const response = await asanaClient.updateTask(externalId, updateRequest);
    const modifiedAt = response.data?.data?.modified_at;

    if (sectionGid) {
      try {
        await asanaClient.addTaskToSection(sectionGid, { data: { task: externalId } });
      } catch (error) {
        if (getAsanaAccessErrorCode(error)) throw error;
        console.warn(`Task ${externalId} (devrevId=${item.id.devrev}) updated but section move to ${sectionGid} failed: ${serializeError(error)}`);
      }
    }

    if (tagGids?.length) {
      const failedTags: string[] = [];
      for (const tagGid of tagGids) {
        try {
          await asanaClient.addTagToTask(externalId, { data: { tag: tagGid } });
        } catch (error) {
          if (getAsanaAccessErrorCode(error)) throw error;
          failedTags.push(tagGid);
        }
      }
      if (failedTags.length > 0) {
        console.warn(`Task ${externalId} (devrevId=${item.id.devrev}): ${failedTags.length} tag assignments failed: ${failedTags.join(', ')}`);
      }
    }

    return { status: 'success', id: externalId, modifiedDate: modifiedAt };
  } catch (error) {
    return handleLoadingError(error);
  }
}

async function createSubtask({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
  try {
    const resolveId = buildResolver(mappers, event);
    const asanaClient = new AsanaClient(event);
    const { createRequest, tagGids } = await denormalizeTask(item.data, resolveId);

    const parentGid = item.data.parent_task ? await resolveRef(item.data.parent_task, resolveId) : null;

    let response;
    if (parentGid) {
      // Create as subtask under the known parent
      response = await asanaClient.createTaskSubtask(parentGid, createRequest);
    } else {
      // Parent not in transformer data (DevRev manages hierarchy via links).
      // Create as a standalone task; link loading will set the parent via setTaskParent.
      if (createRequest.data) {
        createRequest.data.projects = [asanaClient.projectId];
      }
      response = await asanaClient.createTask(createRequest);
    }

    const subtaskGid = response.data?.data?.gid;
    const modifiedAt = response.data?.data?.modified_at;

    if (!subtaskGid) return { status: 'error', error: { message: `Failed to create subtask — no GID returned. subtaskDevrevId=${item.id.devrev}` } };

    if (tagGids?.length) {
      const failedTags: string[] = [];
      for (const tagGid of tagGids) {
        try {
          await asanaClient.addTagToTask(subtaskGid, { data: { tag: tagGid } });
        } catch (error) {
          if (getAsanaAccessErrorCode(error)) throw error;
          failedTags.push(tagGid);
        }
      }
      if (failedTags.length > 0) {
        console.warn(`Subtask ${subtaskGid} (devrevId=${item.id.devrev}): ${failedTags.length} tag assignments failed: ${failedTags.join(', ')}`);
      }
    }

    return { status: 'success', id: subtaskGid, modifiedDate: modifiedAt };
  } catch (error) {
    return handleLoadingError(error);
  }
}

async function updateSubtask({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
  return updateTask({ item, mappers, event });
}

async function createComment({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
  try {
    const resolveId = buildResolver(mappers, event);
    const asanaClient = new AsanaClient(event);
    const { parentGid, request } = await denormalizeComment(item.data, resolveId);

    if (!parentGid) return { status: 'error', error: { message: `Cannot resolve parent task for comment. commentDevrevId=${item.id.devrev}, parentId=${String(item.data.parent_id)}` } };

    const response = await asanaClient.createTaskComment(parentGid, request);
    const commentGid = response.data?.data?.gid;

    // Seeds the external_versions baseline that stops this write from being re-imported, and the
    // comment falsely flagged "edited". Asana stories have no modified_at, so the value must match
    // normalizeAsanaComment, which uses created_at as modified_date.
    const modifiedDate = toTimestamp(response.data?.data?.created_at) ?? undefined;

    if (!commentGid) return { status: 'error', error: { message: `Failed to create comment — no GID returned. commentDevrevId=${item.id.devrev}` } };

    return { status: 'success', id: commentGid, modifiedDate };
  } catch (error) {
    return handleLoadingError(error);
  }
}

async function updateComment({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
  try {
    const resolveId = buildResolver(mappers, event);
    let storyGid = item.id.external;
    if (!storyGid) {
      storyGid = (await resolveId(item.id.devrev)) ?? undefined;
    }
    if (!storyGid) return { status: 'error', error: { message: `No external ID for comment update. commentDevrevId=${item.id.devrev}` } };

    const asanaClient = new AsanaClient(event);
    const { request } = await denormalizeComment(item.data, resolveId);

    const response = await asanaClient.updateTaskComment(storyGid, request);
    const modifiedDate = toTimestamp(response.data?.data?.created_at) ?? undefined;

    return { status: 'success', id: storyGid, modifiedDate };
  } catch (error) {
    return handleLoadingError(error);
  }
}

async function createLink({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
  try {
    const resolveId = buildResolver(mappers, event);
    const asanaClient = new AsanaClient(event);
    const linkAction = await denormalizeLink(item.data, resolveId);

    if (!linkAction) return { status: 'error', error: { message: `Cannot resolve link endpoints. linkDevrevId=${item.id.devrev}, source=${String(item.data.source)}, target=${String(item.data.target)}, linkType=${String(item.data.link_type)}` } };

    const syntheticId = `${linkAction.linkType}_${linkAction.sourceGid}_${linkAction.targetGid}`;

    switch (linkAction.linkType) {
      case LinkType.IS_DEPENDENT_ON:
        await asanaClient.addTaskDependencies(linkAction.sourceGid, { data: { dependencies: [linkAction.targetGid] } });
        break;
      case LinkType.IS_PARENT_OF:
        await asanaClient.setTaskParent(linkAction.targetGid, { data: { parent: linkAction.sourceGid } });
        break;
      case 'is_duplicate_of':
      case 'is_related_to':
        // No direct Asana API equivalent — skip gracefully
        console.warn(`Link type '${linkAction.linkType}' has no Asana API equivalent. Skipping.`);
        return { status: 'success', id: syntheticId };
      default:
        console.warn(`Unknown link type '${linkAction.linkType}'. Skipping.`);
        return { status: 'success', id: syntheticId };
    }

    return { status: 'success', id: syntheticId };
  } catch (error) {
    return handleLoadingError(error);
  }
}

async function updateLink(
  params: ExternalSystemItemLoadingParams<ExternalSystemItem>
): Promise<ExternalSystemItemLoadingResponse> {
  return createLink(params);
}

const itemTypesToLoad = [
  { itemType: ItemType.TASKS, create: createTask, update: updateTask },
  { itemType: ItemType.SUBTASKS, create: createSubtask, update: updateSubtask },
  { itemType: ItemType.COMMENTS, create: createComment, update: updateComment },
  { itemType: ItemType.LINKS, create: createLink, update: updateLink },
];

processLoadingTask<LoaderState>({
  task: async ({ adapter }) => adapter.loadItemTypes({ itemTypesToLoad }),
});
