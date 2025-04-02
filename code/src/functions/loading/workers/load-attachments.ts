import { AsanaClient } from '../../asana/client';

import {
  axios,
  ExternalSystemAttachment,
  ExternalSystemItemLoadingParams,
  LoaderEventType,
  processTask,
  serializeAxiosError,
} from '@devrev/ts-adaas';

const create = async ({ item, mappers, event }: ExternalSystemItemLoadingParams<ExternalSystemAttachment>) => {
  // Initialize the Asana client using information from the event.
  const asanaClient = new AsanaClient(event);

  try {
    // Utilize mappers to retrieve the necessary task data from the DevRev system.
    // The mapper fetches this data based on the `sync_unit` and `parent_reference_id`,
    // allowing us to identify the associated Asana task ID.
    const asanaTask = await mappers.getByTargetId({
      sync_unit: event.payload.event_context.sync_unit,
      target: item.parent_reference_id,
    });

    // Extract the Asana Task ID from the retrieved data.
    const asanaTaskId = asanaTask.data.sync_mapper_record?.external_ids?.[0];

    // Verify that a valid Asana Task ID was obtained.
    if (asanaTaskId) {
      // If a valid Asana Task ID is available, create the attachment in Asana.
      await asanaClient.createAttachment(item, asanaTaskId);
    } else {
      // If no valid Task ID is found, log a warning and return an error.
      console.warn('Attachment has no parent_id:', item);
      return {
        error: 'Attachment has no parent_id.',
      };
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      // Handle Axios-specific errors, including rate limiting.
      if (error.response?.status === 429) {
        // Log and handle rate limit scenarios by returning a delay.
        console.log(`Rate limit hit. Retrying after ${error.response.headers['Retry-After']} seconds.`);
        return { delay: Number(error.response.headers['Retry-After']) };
      } else {
        // Log other Axios errors and serialize them for the return object.
        console.error('Error while creating attachment', serializeAxiosError(error));
        return { error: JSON.stringify(error) };
      }
    } else {
      // Log any unexpected errors that aren't Axios-specific.
      console.error('Unexpected error while creating attachment', error);
      return { error: JSON.stringify(error) };
    }
  }

  // Return a success object containing the reference ID of the created item.
  return {
    id: item.reference_id,
  };
};

processTask({
  task: async ({ adapter }) => {
    // Initiates the loading of attachments into Asana.
    // The adapter provides a method `loadAttachments`, which takes an object containing
    // a `create` function. This function is responsible for defining how each attachment
    // should be created in Asana.
    // `loadAttachments` processes attachments one by one and creates them in DevRev.
    const { reports, processed_files } = await adapter.loadAttachments({
      create,
    });

    // After the attachments are successfully loaded, emit an event to signal completion.
    // This event includes `reports` and `processed_files` which provide details about the
    // loading process, useful for logging or further processing.
    await adapter.emit(LoaderEventType.AttachmentLoadingDone, {
      reports,
      processed_files,
    });
  },
  onTimeout: async ({ adapter }) => {
    // In the case of a timeout during the loading process, preserve the current state
    // by posting it. This helps in maintaining progress information even when the task
    // execution does not complete within expected timeframes.
    await adapter.postState();

    // Emit a progress event to provide an update on how many attachments were processed
    // before timeout. This includes `reports` and `processed_files` to give insights into
    // the state of the process when it was interrupted.
    await adapter.emit(LoaderEventType.AttachmentLoadingProgress, {
      reports: adapter.reports,
      processed_files: adapter.processedFiles,
    });
  },
});
