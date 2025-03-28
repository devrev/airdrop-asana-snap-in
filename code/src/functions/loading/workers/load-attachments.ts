import { AsanaClient } from '../../asana/client';

import {
  axios,
  axiosClient,
  ExternalSystemAttachment,
  ExternalSystemItemLoadingParams,
  LoaderEventType,
  processTask,
  serializeAxiosError,
} from '@devrev/ts-adaas';

const create = async ({ item, mappers, event }: ExternalSystemItemLoadingParams<ExternalSystemAttachment>) => {
  const asanaClient = new AsanaClient(event);

  try {
    const asanaTask = await mappers.getByTargetId({
      sync_unit: event.payload.event_context.sync_unit,
      target: item.parent_reference_id,
    });

    const asanaTaskId = asanaTask.data.sync_mapper_record?.external_ids?.[0];

    if (asanaTaskId) {
      await asanaClient.createAttachment(item, asanaTaskId);
    } else {
      console.warn('Attachment has no parent_id:', item);
      return {
        error: 'Attachment has no parent_id.',
      };
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 429) {
        console.log(`Rate limit hit. Retrying after ${error.response.headers['Retry-After']} seconds.`);
        return { delay: Number(error.response.headers['Retry-After']) };
      } else {
        console.error('Error while creating attachment', serializeAxiosError(error));
        return { error: JSON.stringify(error) };
      }
    } else {
      console.error('Unexpected error while creating attachment', error);
      return { error: JSON.stringify(error) };
    }
  }

  return {
    id: item.reference_id,
  };
};

processTask({
  task: async ({ adapter }) => {
    const { reports, processed_files } = await adapter.loadAttachments({
      create,
    });

    await adapter.emit(LoaderEventType.AttachmentLoadingDone, {
      reports,
      processed_files,
    });
  },
  onTimeout: async ({ adapter }) => {
    await adapter.postState();
    await adapter.emit(LoaderEventType.AttachmentLoadingProgress, {
      reports: adapter.reports,
      processed_files: adapter.processedFiles,
    });
  },
});
