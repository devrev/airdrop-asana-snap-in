import { LoaderEventType, processTask } from '@devrev/ts-adaas';

import {
  ExternalSystemItem,
  ExternalSystemItemLoadingParams,
  ExternalSystemItemLoadingResponse,
} from '@devrev/ts-adaas';

import { AsanaClient } from '../../asana/client';
import { denormalizeTask } from '../../asana/data-denormalization';

async function createTask({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
  const client = new AsanaClient(event);
  const projectId = event.payload.event_context.external_sync_unit_id;

  const task = denormalizeTask(item, projectId);

  try {
    const response = await client.createTask(task);

    return { id: response.data.data.gid };
  } catch (error: any) {
    console.log('Could not create a task in Asana.', error);
    return { error: 'Could not create a task in Asana.' };
  }
}

async function updateTask({
  item,
  mappers,
  event,
}: ExternalSystemItemLoadingParams<ExternalSystemItem>): Promise<ExternalSystemItemLoadingResponse> {
  const client = new AsanaClient(event);
  const taskId = item.id.external as string;

  const task = denormalizeTask(item);

  try {
    const response = await client.updateTask(taskId, task);

    return { id: response.data.data.gid };
  } catch (error: any) {
    console.log('Could not update a task in Asana.', error);
    return { error: 'Could not update a task in Asana.' };
  }
}

processTask({
  task: async ({ adapter }) => {
    // This section is responsible for loading data into an external system.
    // It involves both creating and updating data. The process is abstracted
    // such that the user only needs to provide specific functions for these operations.
    //
    // Key components include:
    // - `itemTypesToLoad`: An array specifying the types of items to be loaded.
    //     - Each entry includes:
    //         - `itemType`: A string indicating the type of item, e.g., 'tasks'.
    //         - `create`: A function to be called to create new items in the external system.
    //         - `update`: A function to be called to update existing items in the external system.
    //
    // The `loadItemTypes` method of the adapter is used to streamline and manage
    // these operations. It returns `reports` and `processed_files`, which provide
    // feedback on the data loading process.
    const { reports, processed_files } = await adapter.loadItemTypes({
      itemTypesToLoad: [
        {
          itemType: 'tasks',
          create: createTask,
          update: updateTask,
        },
      ],
    });

    // After loading, an event is emitted to indicate that the data loading process
    // has been completed, including any reports and processed file information.
    await adapter.emit(LoaderEventType.DataLoadingDone, {
      reports,
      processed_files,
    });
  },
  onTimeout: async ({ adapter }) => {
    // In case of a timeout, maintain the current state and progress by
    // posting the state and emitting a progress event with current reports and processed files.
    await adapter.postState();
    await adapter.emit(LoaderEventType.DataLoadingProgress, {
      reports: adapter.reports,
      processed_files: adapter.processedFiles,
    });
  },
});
