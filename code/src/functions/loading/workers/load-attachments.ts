import type { ExternalSystemAttachment, ExternalSystemItemLoadingParams, ExternalSystemItemLoadingResponse } from '@devrev/ts-adaas';
import { LoaderEventType, processTask } from '@devrev/ts-adaas';

import { AsanaClient } from '@asana/api-client';
import { handleLoadingError, resolveExternalId } from '@utils/loading-helpers';
import { serializeError } from '@utils/serialize-error';

import type { LoaderState } from '../index';

/**
 * Re-associate a task-uploaded attachment with the comment it belongs to.
 *
 * Asana reparents a file onto a story when the story's `html_text` embeds it as
 * `<img data-asana-gid="...">`; the story then lists it in its own `attachments`, which the next
 * forward sync reads. Best-effort: the file is already on the task, so failing here costs correct
 * parenting, not data.
 */
async function reparentAttachmentToComment(
  asanaClient: AsanaClient,
  commentGid: string,
  attachmentGid: string,
  fileName: string
): Promise<void> {
  try {
    const story = await asanaClient.getStory(commentGid);
    const existingHtml: string | undefined = story.data?.data?.html_text;

    // Already embedded by an earlier partial run.
    if (existingHtml?.includes(`data-asana-gid="${attachmentGid}"`)) {
      return;
    }

    const inner = existingHtml?.match(/^\s*<body>([\s\S]*)<\/body>\s*$/i)?.[1] ?? '';
    const html = `<body>${inner}<img data-asana-gid="${attachmentGid}"/></body>`;

    await asanaClient.updateTaskComment(commentGid, { data: { html_text: html } });
    console.log(`Re-parented attachment ${attachmentGid} ("${fileName}") onto comment ${commentGid}.`);
  } catch (error) {
    console.warn(
      `Could not re-parent attachment ${attachmentGid} ("${fileName}") onto comment ${commentGid}; ` +
        `it stays attached to the task: ${serializeError(error)}`
    );
  }
}

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

    // Asana only accepts task GIDs as attachment parents, so a comment attachment must be
    // uploaded to the owning task and then embedded back into the comment (see below).
    let commentGid: string | null = null;
    if (parentGid && parentDevrevId?.includes(':comment/')) {
      commentGid = parentGid;
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

    if (commentGid && attachmentGid) {
      await reparentAttachmentToComment(asanaClient, commentGid, attachmentGid, item.file_name);
    }

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
