import type { ExternalSystemAttachment, ExternalSystemItemLoadingParams, ExternalSystemItemLoadingResponse } from '@devrev/ts-adaas';
import { LoaderEventType, processTask } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { handleLoadingError, resolveExternalId } from '@utils/loading-helpers';
import { serializeError } from '@utils/serialize-error';

import type { LoaderState } from '../index';

async function createAttachment({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemAttachment>): Promise<ExternalSystemItemLoadingResponse> {
  try {
    const asanaClient = new AsanaClient(event);
    const syncUnit = event.payload.event_context.sync_unit;

    const parentDevrevId = item.parent_reference_id || item.parent_id;
    let parentGid = parentDevrevId
      ? await resolveExternalId(mappers, syncUnit, parentDevrevId)
      : null;

    // Asana only accepts task GIDs as attachment parents.
    // If parent is a comment, resolve to the parent task instead.
    if (parentGid && parentDevrevId?.includes(':comment/')) {
      const taskDevrevId = parentDevrevId.replace(/:comment\/.*$/, '');
      parentGid = await resolveExternalId(mappers, syncUnit, taskDevrevId);
    }

    if (!parentGid) {
      console.warn(`Cannot resolve parent for attachment "${item.file_name}". parentReferenceId=${item.parent_reference_id}, parentId=${item.parent_id}`);
      return { error: `Cannot resolve parent for attachment ${item.file_name}, parentReferenceId=${item.parent_reference_id}, parentId=${item.parent_id}` };
    }

    const { default: axios } = await import('axios');
    const fileResponse = await axios.get(item.url, { responseType: 'arraybuffer' });
    const fileBuffer = Buffer.from(fileResponse.data);

    const response = await asanaClient.createTaskAttachment(parentGid, fileBuffer, item.file_name);
    const attachmentGid = response.data?.data?.gid;

    return { id: attachmentGid };
  } catch (error) {
    console.error(`Failed to load attachment "${item.file_name}" to parent ${item.parent_reference_id || item.parent_id}: ${serializeError(error)}`);
    return handleLoadingError(error);
  }
}

processTask<LoaderState>({
  task: async ({ adapter }) => {
    try {
      console.log('Starting attachment loading.');
      await adapter.loadAttachments({ create: createAttachment });
      console.log('Attachment loading completed.');
      await adapter.emit(LoaderEventType.AttachmentLoadingDone);
    } catch (error) {
      const result = handleLoadingError(error);
      if (result.delay) {
        console.warn(`Rate limited during attachment loading. Delaying for ${result.delay}s.`);
        await adapter.emit(LoaderEventType.AttachmentLoadingDelayed, { delay: result.delay });
      } else {
        console.error(`Attachment loading failed: ${result.error}`);
        await adapter.emit(LoaderEventType.AttachmentLoadingError, {
          error: { message: result.error ?? 'Unknown error during attachment loading' },
        });
      }
    }
  },
  onTimeout: async ({ adapter }) => {
    await adapter.emit(LoaderEventType.AttachmentLoadingProgress);
  },
});
