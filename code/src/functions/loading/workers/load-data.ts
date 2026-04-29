import type {
  AirdropEvent,
  ExternalSystemItem,
  ExternalSystemItemLoadingParams,
  ExternalSystemItemLoadingResponse,
} from '@devrev/ts-adaas';
import { LoaderEventType, processTask } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { ItemType, LinkType } from '@asana/constants';
import { denormalizeComment, denormalizeLink, denormalizeTask } from '@asana/data-denormalization';
import { handleLoadingError, resolveExternalId, resolveRef } from '@utils/loading-helpers';
import { serializeError } from '@utils/serialize-error';

import type { LoaderState } from '../index';

function buildResolver(mappers: ExternalSystemItemLoadingParams<ExternalSystemItem>['mappers'], event: AirdropEvent) {
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

    if (!taskGid) return { error: `Failed to create task — no GID returned. taskDevrevId=${item.id.devrev}` };

    if (sectionGid) {
      try {
        await asanaClient.addTaskToSection(sectionGid, { data: { task: taskGid } });
      } catch (error) {
        console.warn(`Task ${taskGid} (devrevId=${item.id.devrev}) created but section assignment to ${sectionGid} failed: ${serializeError(error)}`);
      }
    }

    if (tagGids?.length) {
      const failedTags: string[] = [];
      for (const tagGid of tagGids) {
        try {
          await asanaClient.addTagToTask(taskGid, { data: { tag: tagGid } });
        } catch {
          failedTags.push(tagGid);
        }
      }
      if (failedTags.length > 0) {
        console.warn(`Task ${taskGid} (devrevId=${item.id.devrev}): ${failedTags.length} tag assignments failed: ${failedTags.join(', ')}`);
      }
    }

    return { id: taskGid, modifiedDate: modifiedAt };
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
    if (!externalId) return { error: `No external ID for task update. taskDevrevId=${item.id.devrev}` };

    const asanaClient = new AsanaClient(event);
    const { updateRequest, sectionGid, tagGids } = await denormalizeTask(item.data, resolveId);

    const response = await asanaClient.updateTask(externalId, updateRequest);
    const modifiedAt = response.data?.data?.modified_at;

    if (sectionGid) {
      try {
        await asanaClient.addTaskToSection(sectionGid, { data: { task: externalId } });
      } catch (error) {
        console.warn(`Task ${externalId} (devrevId=${item.id.devrev}) updated but section move to ${sectionGid} failed: ${serializeError(error)}`);
      }
    }

    if (tagGids?.length) {
      const failedTags: string[] = [];
      for (const tagGid of tagGids) {
        try {
          await asanaClient.addTagToTask(externalId, { data: { tag: tagGid } });
        } catch {
          failedTags.push(tagGid);
        }
      }
      if (failedTags.length > 0) {
        console.warn(`Task ${externalId} (devrevId=${item.id.devrev}): ${failedTags.length} tag assignments failed: ${failedTags.join(', ')}`);
      }
    }

    return { id: externalId, modifiedDate: modifiedAt };
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

    if (!subtaskGid) return { error: `Failed to create subtask — no GID returned. subtaskDevrevId=${item.id.devrev}` };

    if (tagGids?.length) {
      const failedTags: string[] = [];
      for (const tagGid of tagGids) {
        try {
          await asanaClient.addTagToTask(subtaskGid, { data: { tag: tagGid } });
        } catch {
          failedTags.push(tagGid);
        }
      }
      if (failedTags.length > 0) {
        console.warn(`Subtask ${subtaskGid} (devrevId=${item.id.devrev}): ${failedTags.length} tag assignments failed: ${failedTags.join(', ')}`);
      }
    }

    return { id: subtaskGid, modifiedDate: modifiedAt };
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

    if (!parentGid) return { error: `Cannot resolve parent task for comment. commentDevrevId=${item.id.devrev}, parentId=${String(item.data.parent_id)}` };

    const response = await asanaClient.createTaskComment(parentGid, request);
    const commentGid = response.data?.data?.gid;

    return { id: commentGid };
  } catch (error) {
    return handleLoadingError(error);
  }
}

async function updateComment({
  item,
}: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
  // Asana does not support comment updates — return existing external ID as a no-op
  return { id: item.id.external };
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

    if (!linkAction) return { error: `Cannot resolve link endpoints. linkDevrevId=${item.id.devrev}, source=${String(item.data.source)}, target=${String(item.data.target)}, linkType=${String(item.data.link_type)}` };

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
        return { id: syntheticId };
      default:
        console.warn(`Unknown link type '${linkAction.linkType}'. Skipping.`);
        return { id: syntheticId };
    }

    return { id: syntheticId };
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

processTask<LoaderState>({
  task: async ({ adapter }) => {
    try {
      console.log('Starting data loading.');
      await adapter.loadItemTypes({ itemTypesToLoad });
      console.log('Data loading completed.');
      await adapter.emit(LoaderEventType.DataLoadingDone);
    } catch (error) {
      const result = handleLoadingError(error);
      if (result.delay) {
        console.warn(`Rate limited during data loading. Delaying for ${result.delay}s.`);
        await adapter.emit(LoaderEventType.DataLoadingDelayed, { delay: result.delay });
      } else {
        console.error(`Data loading failed: ${result.error}`);
        await adapter.emit(LoaderEventType.DataLoadingError, {
          error: { message: result.error ?? 'Unknown error during data loading' },
        });
      }
    }
  },
  onTimeout: async ({ adapter }) => {
    await adapter.emit(LoaderEventType.DataLoadingProgress);
  },
});
